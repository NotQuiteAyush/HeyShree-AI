import { VoiceTurnDetector } from "./VoiceTurnDetector";

export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentOutputNode: GainNode | null = null;
  private onAudioData: (base64: string) => void;
  private onAnalyserCreated?: (analyser: AnalyserNode) => void;
  private onMicrophoneProblem?: (message: string | null) => void;
  private onAudioStreamEnd?: () => void;
  private analyser: AnalyserNode | null = null;
  private inputDeviceId: string;
  private zeroSampleCount = 0;
  private microphoneProblemReported = false;
  private preRollBuffers: ArrayBuffer[] = [];
  private voiceTurnDetector = new VoiceTurnDetector();
  private stopped = true;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackActive = false;

  private static readonly PRE_ROLL_CHUNKS = 3;

  constructor(
    onAudioData: (base64: string) => void,
    onAnalyserCreated?: (analyser: AnalyserNode) => void,
    inputDeviceId: string = "default",
    onMicrophoneProblem?: (message: string | null) => void,
    onAudioStreamEnd?: () => void,
  ) {
    this.onAudioData = onAudioData;
    this.onAnalyserCreated = onAnalyserCreated;
    this.inputDeviceId = inputDeviceId;
    this.onMicrophoneProblem = onMicrophoneProblem;
    this.onAudioStreamEnd = onAudioStreamEnd;
  }

  async start(): Promise<void> {
    if (this.audioContext) return;
    this.stopped = false;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.inputDeviceId && this.inputDeviceId !== "default" ? { exact: this.inputDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const track = this.mediaStream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("The selected microphone did not provide a live audio track.");
      }
      track.addEventListener("ended", () => this.handleTrackEnded(track));

      // Match the stable v1.1.20 live-audio path. Gemini receives one continuous
      // 16 kHz PCM stream and its server-side VAD owns utterance boundaries.
      // Local silence gating made later builds hesitate and clipped natural
      // breathing pauses during conversation.
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtxClass({ sampleRate: 16000 });
      await this.audioContext.resume();

      // Track state change to auto-resume on browser-forced suspend
      this.audioContext.onstatechange = () => {
        if (this.audioContext && this.audioContext.state === "suspended") {
          console.warn("Input AudioContext was suspended by browser, resuming...");
          this.audioContext.resume().catch((err) => console.error("Failed to resume input AudioContext:", err));
        }
      };

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create Analyser for input waveform visualization
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.sourceNode.connect(this.analyser);
      if (this.onAnalyserCreated) {
        this.onAnalyserCreated(this.analyser);
      }

      // ScriptProcessor remains supported by the packaged Electron runtime and
      // is used here because AudioWorklet modules cannot be loaded reliably from
      // every packaged file origin. Its output is connected through zero gain
      // so the processor runs without playing the microphone through speakers.
      // 1024 samples is a balanced 64 ms frame at 16 kHz: responsive enough
      // for turn-end detection without returning to the very small frames that
      // previously increased transport overhead on some Windows microphones.
      this.processorNode = this.audioContext.createScriptProcessor(1024, 1, 1);
      this.silentOutputNode = this.audioContext.createGain();
      this.silentOutputNode.gain.value = 0;
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentOutputNode);
      this.silentOutputNode.connect(this.audioContext.destination);

      // CRITICAL: Hold a strong reference in window scope to prevent browser garbage collection
      (window as any)._shreeProcessorNode = this.processorNode;

      this.processorNode.onaudioprocess = (e) => {
        // Double-check and resume if suspended during recording
        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume().catch((err) => console.error("Auto-resume in onprocess failed:", err));
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // Do not feed SHREE's own speaker output back into Gemini as a second
        // user turn. Chromium echo cancellation remains enabled, while this
        // deterministic half-duplex guard prevents the duplicate-assistant
        // behaviour seen on speakers where acoustic cancellation is weak.
        if (this.playbackActive) {
          this.preRollBuffers = [];
          this.voiceTurnDetector.reset();
          return;
        }

        // Convert Float32 [-1.0, 1.0] to standard Int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        let peak = 0;
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          peak = Math.max(peak, Math.abs(s));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        if (peak <= 1 / 32768) {
          this.zeroSampleCount += pcm16.length;
          if (
            !this.microphoneProblemReported
            && this.zeroSampleCount >= this.audioContext.sampleRate * 3
          ) {
            this.microphoneProblemReported = true;
            if (this.usesWindowsDefaultDevice()) {
              this.scheduleDefaultDeviceReconnect("digital silence");
            } else {
              this.onMicrophoneProblem?.(
                "The microphone is connected but is sending digital silence. Check its mute switch and Windows input level.",
              );
            }
          }
        } else {
          this.zeroSampleCount = 0;
          if (this.microphoneProblemReported) {
            this.microphoneProblemReported = false;
            this.onMicrophoneProblem?.(null);
          }
        }

        const pcmBuffer = pcm16.buffer.slice(0) as ArrayBuffer;
        const voiceEvent = this.voiceTurnDetector.update(
          peak,
          this.rms(inputData),
          pcm16.length,
          this.audioContext.sampleRate,
        );

        if (voiceEvent === "idle" || voiceEvent === "start") {
          this.preRollBuffers.push(pcmBuffer);
          if (this.preRollBuffers.length > AudioStreamer.PRE_ROLL_CHUNKS) {
            this.preRollBuffers.shift();
          }
          if (voiceEvent === "start") {
            for (const buffered of this.preRollBuffers) {
              this.onAudioData(this.bufferToBase64(buffered));
            }
            this.preRollBuffers = [];
          }
          return;
        }

        this.onAudioData(this.bufferToBase64(pcmBuffer));
        if (voiceEvent === "end") {
          this.preRollBuffers = [];
          this.onAudioStreamEnd?.();
        }
      };
    } catch (err) {
      this.releaseCapture();
      console.error("AudioStreamer initialization failed:", err);
      throw err;
    }
  }

  private usesWindowsDefaultDevice(): boolean {
    return !this.inputDeviceId || this.inputDeviceId === "default";
  }

  private handleTrackEnded(track: MediaStreamTrack): void {
    if (!this.mediaStream?.getAudioTracks().includes(track)) return;
    if (this.stopped || this.reconnecting) return;
    if (this.usesWindowsDefaultDevice()) {
      this.onMicrophoneProblem?.(null);
      this.scheduleDefaultDeviceReconnect("default device changed");
      return;
    }
    this.onMicrophoneProblem?.(
      "The selected microphone disconnected. Choose an available microphone in Settings.",
    );
  }

  private scheduleDefaultDeviceReconnect(reason: string): void {
    if (
      this.stopped
      || this.reconnecting
      || this.reconnectTimer
      || !this.usesWindowsDefaultDevice()
    ) {
      return;
    }
    const delay = Math.min(250 * (2 ** this.reconnectAttempts), 2_000);
    console.info(`Windows default microphone ${reason}; reconnecting in ${delay} ms.`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.reconnecting = true;
      this.releaseCapture();
      try {
        await this.start();
        this.reconnectAttempts = 0;
        this.onMicrophoneProblem?.(null);
      } catch (error) {
        this.reconnectAttempts += 1;
        console.warn("Could not reacquire the Windows default microphone:", error);
        if (this.reconnectAttempts >= 5) {
          this.onMicrophoneProblem?.(
            "Windows has no available default microphone. Connect one or select a microphone in Settings.",
          );
        }
      } finally {
        this.reconnecting = false;
      }
      if (!this.stopped && !this.audioContext) {
        this.scheduleDefaultDeviceReconnect("is still unavailable");
      }
    }, delay);
  }

  private bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private rms(samples: Float32Array): number {
    if (!samples.length) return 0;
    let sumSquares = 0;
    for (let index = 0; index < samples.length; index++) {
      sumSquares += samples[index] * samples[index];
    }
    return Math.sqrt(sumSquares / samples.length);
  }

  private releaseCapture(): void {
    // Release strong reference to prevent memory leaks
    if ((window as any)._shreeProcessorNode) {
      delete (window as any)._shreeProcessorNode;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.silentOutputNode) {
      this.silentOutputNode.disconnect();
      this.silentOutputNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }
    this.analyser = null;
    this.zeroSampleCount = 0;
    this.microphoneProblemReported = false;
    this.preRollBuffers = [];
    this.voiceTurnDetector.reset();
  }

  setPlaybackActive(active: boolean): void {
    this.playbackActive = active;
    if (active) {
      this.preRollBuffers = [];
      this.voiceTurnDetector.reset();
    }
  }

  stop() {
    this.stopped = true;
    this.playbackActive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.releaseCapture();
  }
}
