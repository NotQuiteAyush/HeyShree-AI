import assert from "node:assert/strict";
import { VoiceConversationController } from "../src/lib/VoiceConversationController";

let scheduled: (() => void) | null = null;
let scheduledDelay = 0;
let sleepCount = 0;
const controller = new VoiceConversationController({
  wakeWordEnabled: true,
  initiallySleeping: true,
  autoSleepEnabled: true,
  timeoutSeconds: 15,
  onSleep: () => { sleepCount += 1; },
  schedule: (callback, delay) => { scheduled = callback; scheduledDelay = delay; return callback; },
  cancelScheduled: () => { scheduled = null; },
});

assert.equal(controller.state, "sleeping");
assert.equal(controller.wake(), true);
assert.equal(controller.wake(), false);
controller.markGenuineSpeech();
assert.equal(controller.state, "listening");
controller.markThinking();
controller.markSpeaking();
assert.equal(scheduled, null, "never arm auto sleep while thinking or speaking");
controller.waitForUser();
assert.equal(controller.state, "waiting_for_user");
assert.equal(scheduledDelay, 15_000);
const timeoutCallback = scheduled as (() => void);
scheduled = null;
timeoutCallback();
assert.equal(controller.state, "sleeping");
assert.equal(sleepCount, 1);

controller.wake();
controller.configure(false, 10, true);
controller.waitForUser();
assert.equal(scheduled, null, "Auto Sleep OFF must not schedule a timeout");

let staleSleepCount = 0;
let staleCallback: (() => void) | null = null;
const staleController = new VoiceConversationController({
  wakeWordEnabled: true,
  initiallySleeping: false,
  autoSleepEnabled: true,
  timeoutSeconds: 15,
  onSleep: () => { staleSleepCount += 1; },
  schedule: (callback) => { staleCallback = callback; return callback; },
  // Simulate a callback that was already queued and cannot be removed.
  cancelScheduled: () => {},
});
staleController.waitForUser();
const queuedBeforeWake = staleCallback as (() => void);
staleController.sleepNow();
staleController.wake();
queuedBeforeWake();
assert.equal(staleController.state, "listening");
assert.equal(staleSleepCount, 1, "a stale inactivity callback must not put Shree back to sleep after waking");

console.log("Voice conversation state and auto-sleep checks passed.");

let now = 0;
let edgeCallback: (() => void) | null = null;
let edgeDelay = 0;
const edgeController = new VoiceConversationController({
  wakeWordEnabled: true,
  initiallySleeping: false,
  autoSleepEnabled: true,
  timeoutSeconds: 15,
  onSleep: () => { throw new Error("Speech at the timeout edge must keep Shree awake"); },
  now: () => now,
  schedule: (callback, delay) => { edgeCallback = callback; edgeDelay = delay; return callback; },
  cancelScheduled: () => { edgeCallback = null; },
});
edgeController.waitForUser();
now = 14_900;
edgeController.markPotentialSpeech();
assert.equal(edgeCallback, null, "speech onset pauses the deadline before 15 seconds");
now = 15_050;
edgeController.markGenuineSpeech();
assert.equal(edgeController.state, "listening");

edgeController.waitForUser();
now += 14_900;
edgeController.markPotentialSpeech();
edgeController.markRejectedNoise();
assert.equal(edgeDelay, 100, "a rejected noise spike resumes the original deadline instead of resetting 15 seconds");

console.log("Timeout-edge speech and non-resetting noise checks passed.");
