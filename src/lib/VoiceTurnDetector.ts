export type VoiceTurnEvent = "idle" | "candidate" | "rejected" | "start" | "active" | "end";

export class VoiceTurnDetector {
  // A short human breathing pause should not split one sentence. This remains
  // far below the multi-second lag of old builds while allowing natural speech.
  static readonly END_OF_SPEECH_SILENCE_MS = 700;
  static readonly MINIMUM_SPEECH_MS = 150;
  static readonly SPEECH_RMS_THRESHOLD = 0.0045;
  static readonly SPEECH_PEAK_THRESHOLD = 0.018;

  private active = false;
  private silentSamples = 0;
  private candidateSamples = 0;
  private noiseFloorRms = 0.0015;

  update(peak: number, rms: number, sampleCount: number, sampleRate: number): VoiceTurnEvent {
    const rmsThreshold = Math.max(VoiceTurnDetector.SPEECH_RMS_THRESHOLD, this.noiseFloorRms * 1.8);
    const peakThreshold = Math.max(VoiceTurnDetector.SPEECH_PEAK_THRESHOLD, this.noiseFloorRms * 4.5);
    const speechDetected = peak >= peakThreshold && rms >= rmsThreshold;

    if (!this.active) {
      if (!speechDetected) {
        const rejected = this.candidateSamples > 0;
        this.candidateSamples = 0;
        // Slow adaptation follows fans/AC without letting a sudden spike raise
        // the threshold enough to mask the next spoken word.
        this.noiseFloorRms = this.noiseFloorRms * 0.98 + Math.min(rms, 0.02) * 0.02;
        return rejected ? "rejected" : "idle";
      }
      this.candidateSamples += sampleCount;
      if (this.candidateSamples * 1000 / sampleRate < VoiceTurnDetector.MINIMUM_SPEECH_MS) return "candidate";
      this.active = true;
      this.silentSamples = 0;
      this.candidateSamples = 0;
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
    this.candidateSamples = 0;
    return "end";
  }

  reset(): void {
    this.active = false;
    this.silentSamples = 0;
    this.candidateSamples = 0;
  }
}
