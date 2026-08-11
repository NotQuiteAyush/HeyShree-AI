export type VoiceTurnEvent = "idle" | "candidate" | "rejected" | "start" | "active" | "end";

export interface VoiceTurnDetectorOptions {
  endOfSpeechSilenceMs?: number;
  minimumSpeechMs?: number;
  speechRmsThreshold?: number;
  speechPeakThreshold?: number;
}

export class VoiceTurnDetector {
  // Human turn-taking commonly begins within a few hundred milliseconds. The
  // defaults admit quiet speech quickly and close the turn without a long
  // artificial pause; Gemini's server VAD remains the final authority.
  static readonly END_OF_SPEECH_SILENCE_MS = 192;
  static readonly MINIMUM_SPEECH_MS = 96;
  static readonly SPEECH_RMS_THRESHOLD = 0.004;
  static readonly SPEECH_PEAK_THRESHOLD = 0.015;

  private active = false;
  private silentSamples = 0;
  private candidateSamples = 0;
  private noiseFloorRms = 0.0015;
  private readonly endOfSpeechSilenceMs: number;
  private readonly minimumSpeechMs: number;
  private readonly speechRmsThreshold: number;
  private readonly speechPeakThreshold: number;

  constructor(options: VoiceTurnDetectorOptions = {}) {
    this.endOfSpeechSilenceMs = options.endOfSpeechSilenceMs ?? VoiceTurnDetector.END_OF_SPEECH_SILENCE_MS;
    this.minimumSpeechMs = options.minimumSpeechMs ?? VoiceTurnDetector.MINIMUM_SPEECH_MS;
    this.speechRmsThreshold = options.speechRmsThreshold ?? VoiceTurnDetector.SPEECH_RMS_THRESHOLD;
    this.speechPeakThreshold = options.speechPeakThreshold ?? VoiceTurnDetector.SPEECH_PEAK_THRESHOLD;
  }

  update(peak: number, rms: number, sampleCount: number, sampleRate: number): VoiceTurnEvent {
    const rmsThreshold = Math.max(this.speechRmsThreshold, this.noiseFloorRms * 1.6);
    const peakThreshold = Math.max(this.speechPeakThreshold, this.noiseFloorRms * 4);
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
      if (this.candidateSamples * 1000 / sampleRate < this.minimumSpeechMs) return "candidate";
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
    if (this.silentSamples * 1000 / sampleRate < this.endOfSpeechSilenceMs) {
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
