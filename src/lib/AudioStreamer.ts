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
  private onGenuineSpeech?: () => void;
  private onPotentialSpeech?: () => void;
  private onSpeechRejected?: () => void;
  private analyser: AnalyserNode | null = null;
  private inputDeviceId: string;
  private zeroSampleCount = 0;
  private microphoneProblemReported = false;
  private voiceTurnDetector = new VoiceTurnDetector();
  private bargeInDetector = new VoiceTurnDetector({
    minimumSpeechMs: 96,
    endOfSpeechSilenceMs: 128,
    speechRmsThreshold: 0.006,
    speechPeakThreshold: 0.02,
  });
  private bargeInPreRoll: ArrayBuffer[] = [];
  private stopped = true;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackActive = false;
  private wakeWordMode = false;
  private playbackReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly BARGE_IN_PRE_ROLL_CHUNKS = 3;

  constructor(
    onAudioData: (base64: string) => void,
    onAnalyserCreated?: (analyser: AnalyserNode) => void,
    inputDeviceId: string = "default",
    onMicrophoneProblem?: (message: string | null) => void,
    onAudioStreamEnd?: () => void,
    onGenuineSpeech?: () => void,
    onPotentialSpeech?: () => void,
    onSpeechRejected?: () => void,
  ) {
    this.onAudioData = onAudioData;
    this.onAnalyserCreated = onAnalyserCreated;
    this.inputDeviceId = inputDeviceId;
    this.onMicrophoneProblem = onMicrophoneProblem;
    this.onAudioStreamEnd = onAudioStreamEnd;
    this.onGenuineSpeech = onGenuineSpeech;
    this.onPotentialSpeech = onPotentialSpeech;
    this.onSpeechRejected = onSpeechRejected;
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

        // A wake phrase is often too short for the conversation VAD to admit
        // reliably, especially when the first consonant is quiet. While Shree
        // is sleeping, forward the complete microphone stream and let
        // Gemini's server-side high-sensitivity VAD identify the utterance.
        // Active conversation also stays continuous so short or quiet replies
        // are never discarded before server-side recognition.
        if (this.wakeWordMode) {
          this.onAudioData(this.bufferToBase64(pcmBuffer));
          return;
        }

        // While Shree speaks, keep a stricter local gate in front of Gemini so
        // Chromium echo cancellation is not the only protection from speaker
        // feedback. Sustained user speech is still forwarded, enabling natural
        // barge-in instead of silently discarding an interruption.
        if (this.playbackActive) {
          const bargeEvent = this.bargeInDetector.update(
            peak,
            this.rms(inputData),
            pcm16.length,
            this.audioContext.sampleRate,
          );
          if (bargeEvent === "idle" || bargeEvent === "rejected") {
            this.bargeInPreRoll = [];
            return;
          }
          if (bargeEvent === "candidate" || bargeEvent === "start") {
            this.bargeInPreRoll.push(pcmBuffer);
            if (this.bargeInPreRoll.length > AudioStreamer.BARGE_IN_PRE_ROLL_CHUNKS) {
              this.bargeInPreRoll.shift();
            }
            if (bargeEvent === "start") {
              this.onGenuineSpeech?.();
              for (const buffered of this.bargeInPreRoll) {
                this.onAudioData(this.bufferToBase64(buffered));
              }
              this.bargeInPreRoll = [];
            }
            return;
          }
          this.onAudioData(this.bufferToBase64(pcmBuffer));
          if (bargeEvent === "end") this.onAudioStreamEnd?.();
          return;
        }

        const voiceEvent = this.voiceTurnDetector.update(
          peak,
          this.rms(inputData),
          pcm16.length,
          this.audioContext.sampleRate,
        );

        // Never discard quiet or short speech in active conversation. The
        // server receives the continuous stream and performs high-sensitivity
        // recognition; this detector only accelerates UI and turn-end signals.
        this.onAudioData(this.bufferToBase64(pcmBuffer));
        if (voiceEvent === "candidate") this.onPotentialSpeech?.();
        if (voiceEvent === "rejected") this.onSpeechRejected?.();
        if (voiceEvent === "start") this.onGenuineSpeech?.();
        if (voiceEvent === "end") this.onAudioStreamEnd?.();
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
    this.bargeInPreRoll = [];
    this.voiceTurnDetector.reset();
    this.bargeInDetector.reset();
  }

  setPlaybackActive(active: boolean): void {
    if (this.playbackReleaseTimer) {
      clearTimeout(this.playbackReleaseTimer);
      this.playbackReleaseTimer = null;
    }
    if (active) {
      this.playbackActive = true;
      this.bargeInPreRoll = [];
      this.voiceTurnDetector.reset();
      this.bargeInDetector.reset();
      return;
    }
    // Keep the gate closed briefly for speaker/room echo after playback ends.
    this.playbackReleaseTimer = setTimeout(() => {
      this.playbackReleaseTimer = null;
      this.playbackActive = false;
      this.voiceTurnDetector.reset();
      this.bargeInDetector.reset();
      this.bargeInPreRoll = [];
    }, 50);
  }

  setWakeWordMode(active: boolean): void {
    if (this.wakeWordMode === active) return;
    this.wakeWordMode = active;
    this.bargeInPreRoll = [];
    this.voiceTurnDetector.reset();
    this.bargeInDetector.reset();
    console.info(`[WakeWord] Microphone wake mode ${active ? "enabled" : "disabled"}`);
  }

  stop() {
    this.stopped = true;
    this.playbackActive = false;
    this.wakeWordMode = false;
    if (this.playbackReleaseTimer) {
      clearTimeout(this.playbackReleaseTimer);
      this.playbackReleaseTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.releaseCapture();
  }
}
