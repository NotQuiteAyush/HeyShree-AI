export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private onAnalyserCreated?: (analyser: AnalyserNode) => void;
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onPlaybackStateChange?: (isPlaying: boolean) => void;
  private checkPlaybackInterval: any = null;
  private outputDeviceId: string;
  private volume: number;
  private lastPlaybackState: boolean | null = null;

  constructor(
    onAnalyserCreated?: (analyser: AnalyserNode) => void,
    onPlaybackStateChange?: (isPlaying: boolean) => void,
    outputDeviceId: string = "default",
    volumePercent: number = 100,
  ) {
    this.onAnalyserCreated = onAnalyserCreated;
    this.onPlaybackStateChange = onPlaybackStateChange;
    this.outputDeviceId = outputDeviceId;
    this.volume = Math.max(0, Math.min(1, volumePercent / 100));
  }

  private init() {
    if (this.audioContext) return;

    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    // Gemini Live outputs audio precisely at 24000Hz (24kHz)
    this.audioContext = new AudioCtxClass({
      sampleRate: 24000,
    });
    const selectableContext = this.audioContext as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (selectableContext.setSinkId && this.outputDeviceId !== "default") {
      selectableContext.setSinkId(this.outputDeviceId).catch((error) => console.warn("Could not select the configured speaker", error));
    }

    // Track state change to auto-resume on browser-forced suspend
    this.audioContext.onstatechange = () => {
      if (this.audioContext && this.audioContext.state === "suspended") {
        console.warn("Playback AudioContext was suspended, resuming...");
        this.audioContext.resume().catch(() => {});
      }
    };

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    if (this.onAnalyserCreated && this.analyser) {
      this.onAnalyserCreated(this.analyser);
    }

    this.nextStartTime = 0;
    this.startPlaybackMonitoring();
  }

  playChunk(base64Data: string) {
    this.init();
    if (!this.audioContext || !this.gainNode) return;

    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    try {
      // Base64 decoding
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert 16-bit PCM little-endian buffer into float32 array [-1.0, 1.0]
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      // Natural voice playback rate (1.0 for original organic tone and speed)
      const playbackRateValue = 1.0;
      sourceNode.playbackRate.value = playbackRateValue;
      sourceNode.connect(this.gainNode);

      const currentTime = this.audioContext.currentTime;
      if (this.nextStartTime < currentTime) {
        // A tiny scheduling cushion prevents clicks without making the first
        // response feel buffered.
        this.nextStartTime = currentTime + 0.005;
      }

      sourceNode.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration / playbackRateValue;

      this.activeSources.push(sourceNode);

      // Clean up after specific chunk ends
      sourceNode.onended = () => {
        this.activeSources = this.activeSources.filter((src) => src !== sourceNode);
      };
    } catch (err) {
      console.error("AudioPlayer failed to decode or play chunk:", err);
    }
  }

  stopAll() {
    // Clean, instant stop. Flush scheduled queue on user interruption.
    this.activeSources.forEach((src) => {
      try {
        src.stop();
      } catch (e) {
        // Safe to ignore if source is already terminated
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
  }

  setVolume(volumePercent: number) {
    this.volume = Math.max(0, Math.min(1, volumePercent / 100));
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.015);
    }
  }

  private startPlaybackMonitoring() {
    if (this.checkPlaybackInterval) clearInterval(this.checkPlaybackInterval);

    this.checkPlaybackInterval = setInterval(() => {
      if (!this.audioContext) return;
      const isCurrentlyPlaying =
        this.activeSources.length > 0 && this.audioContext.currentTime < this.nextStartTime;
      if (this.onPlaybackStateChange && isCurrentlyPlaying !== this.lastPlaybackState) {
        this.lastPlaybackState = isCurrentlyPlaying;
        this.onPlaybackStateChange(isCurrentlyPlaying);
      }
    }, 25);
  }

  destroy() {
    if (this.checkPlaybackInterval) {
      clearInterval(this.checkPlaybackInterval);
    }
    this.stopAll();
    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }
    this.gainNode = null;
    this.analyser = null;
    this.lastPlaybackState = null;
  }
}
