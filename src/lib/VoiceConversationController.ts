export type VoiceConversationPhase = "sleeping" | "listening" | "thinking" | "speaking" | "waiting_for_user";

export class VoiceConversationController {
  private phase: VoiceConversationPhase;
  private timer: unknown | null = null;
  private autoSleepEnabled: boolean;
  private timeoutSeconds: number;
  private wakeWordEnabled: boolean;
  private readonly onSleep: () => void;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelScheduled: (timer: unknown) => void;
  private readonly now: () => number;
  private deadlineMs: number | null = null;
  private pausedRemainingMs: number | null = null;
  private timerGeneration = 0;

  constructor(options: {
    wakeWordEnabled: boolean;
    initiallySleeping: boolean;
    autoSleepEnabled: boolean;
    timeoutSeconds: number;
    onSleep: () => void;
    schedule?: (callback: () => void, delayMs: number) => unknown;
    cancelScheduled?: (timer: unknown) => void;
    now?: () => number;
  }) {
    this.wakeWordEnabled = options.wakeWordEnabled;
    this.phase = options.initiallySleeping ? "sleeping" : "listening";
    this.autoSleepEnabled = options.autoSleepEnabled;
    this.timeoutSeconds = VoiceConversationController.validTimeout(options.timeoutSeconds);
    this.onSleep = options.onSleep;
    this.schedule = options.schedule || ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelScheduled = options.cancelScheduled || ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.now = options.now || Date.now;
  }

  get state(): VoiceConversationPhase { return this.phase; }
  get sleeping(): boolean { return this.phase === "sleeping"; }

  configure(autoSleepEnabled: boolean, timeoutSeconds: number, wakeWordEnabled: boolean): void {
    this.autoSleepEnabled = autoSleepEnabled;
    this.timeoutSeconds = VoiceConversationController.validTimeout(timeoutSeconds);
    this.wakeWordEnabled = wakeWordEnabled;
    if (!autoSleepEnabled || !wakeWordEnabled) this.cancelTimer();
  }

  wake(): boolean {
    if (!this.sleeping) return false;
    this.cancelTimer();
    this.phase = "listening";
    console.info("[Voice] Entering active conversation");
    return true;
  }

  markGenuineSpeech(): void {
    if (this.sleeping) return;
    this.cancelTimer();
    this.deadlineMs = null;
    this.pausedRemainingMs = null;
    this.phase = "listening";
    console.info("[Voice] Genuine speech detected");
  }

  markThinking(): void { if (!this.sleeping) { this.cancelTimer(); this.phase = "thinking"; } }
  markSpeaking(): void { if (!this.sleeping) { this.cancelTimer(); this.phase = "speaking"; } }

  markPotentialSpeech(): void {
    if (this.phase !== "waiting_for_user" || !this.timer || this.deadlineMs === null) return;
    this.pausedRemainingMs = Math.max(1, this.deadlineMs - this.now());
    this.cancelTimer();
  }

  markRejectedNoise(): void {
    if (this.phase !== "waiting_for_user" || this.pausedRemainingMs === null) return;
    const remaining = this.pausedRemainingMs;
    this.pausedRemainingMs = null;
    this.armTimer(remaining);
  }

  waitForUser(): void {
    if (this.sleeping) return;
    this.phase = "waiting_for_user";
    this.cancelTimer();
    this.pausedRemainingMs = null;
    if (!this.wakeWordEnabled || !this.autoSleepEnabled) return;
    console.info(`[Voice] Inactivity timer reset (${this.timeoutSeconds}s)`);
    this.armTimer(this.timeoutSeconds * 1_000);
  }

  private armTimer(delayMs: number): void {
    this.deadlineMs = this.now() + delayMs;
    const generation = ++this.timerGeneration;
    this.timer = this.schedule(() => {
      if (generation !== this.timerGeneration) return;
      this.timer = null;
      this.deadlineMs = null;
      if (this.phase !== "waiting_for_user") return;
      console.info(`[Voice] Auto sleep after ${this.timeoutSeconds}s inactivity`);
      this.phase = "sleeping";
      this.onSleep();
    }, delayMs);
  }

  sleepNow(): void {
    this.cancelTimer();
    if (!this.wakeWordEnabled) return;
    this.phase = "sleeping";
    this.onSleep();
  }

  destroy(): void { this.cancelTimer(); }

  private cancelTimer(): void {
    this.timerGeneration += 1;
    if (this.timer) this.cancelScheduled(this.timer);
    this.timer = null;
    this.deadlineMs = null;
  }

  private static validTimeout(value: number): number {
    if (!Number.isFinite(value)) return 15;
    return Math.min(3600, Math.max(1, Math.round(value)));
  }
}
