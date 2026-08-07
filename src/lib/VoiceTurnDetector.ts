export type VoiceTurnEvent = "idle" | "start" | "active" | "end";

export class VoiceTurnDetector {
  // Preserve a natural breathing pause without returning to the multi-second
  // lag of older builds. Gemini receives the end marker after a genuine pause.
  // At 16 kHz with 1024-sample frames this resolves after seven silent
  // frames (about 448 ms): fast enough to feel conversational while still
  // allowing short natural pauses between words.
  static readonly END_OF_SPEECH_SILENCE_MS = 420;
  static readonly SPEECH_RMS_THRESHOLD = 0.006;
  static readonly SPEECH_PEAK_THRESHOLD = 0.025;

  private active = false;
  private silentSamples = 0;

  update(peak: number, rms: number, sampleCount: number, sampleRate: number): VoiceTurnEvent {
    const speechDetected =
      peak >= VoiceTurnDetector.SPEECH_PEAK_THRESHOLD
      || rms >= VoiceTurnDetector.SPEECH_RMS_THRESHOLD;

    if (!this.active) {
      if (!speechDetected) return "idle";
      this.active = true;
      this.silentSamples = 0;
      return "start";
    }

    if (speechDetected) {
      this.silentSamples = 0;
      return "active";
    }

    this.silentSamples += sampleCount;
    if (this.silentSamples * 1000 / sampleRate < VoiceTurnDetector.END_OF_SPEECH_SILENCE_MS) {
      return "active";
    }

    this.active = false;
    this.silentSamples = 0;
    return "end";
  }

  reset(): void {
    this.active = false;
    this.silentSamples = 0;
  }
}
