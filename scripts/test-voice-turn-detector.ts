import assert from "node:assert/strict";
import { VoiceTurnDetector } from "../src/lib/VoiceTurnDetector";

const detector = new VoiceTurnDetector();
const sampleRate = 16_000;
const frameSamples = 1_024;

assert.equal(detector.update(0.002, 0.001, frameSamples, sampleRate), "idle");
// One random spike is not human speech.
assert.equal(detector.update(0.08, 0.02, frameSamples, sampleRate), "candidate");
assert.equal(detector.update(0.003, 0.002, frameSamples, sampleRate), "rejected");
// Sustained speech for about 100 ms starts one genuine turn.
assert.equal(detector.update(0.08, 0.02, frameSamples, sampleRate), "candidate");
assert.equal(detector.update(0.08, 0.02, frameSamples, sampleRate), "start");
for (let index = 0; index < 2; index += 1) {
  assert.equal(detector.update(0.004, 0.002, frameSamples, sampleRate), "active");
}
assert.equal(detector.update(0.004, 0.002, frameSamples, sampleRate), "end");

detector.reset();
for (let index = 0; index < 120; index += 1) {
  assert.equal(detector.update(0.012, 0.004, frameSamples, sampleRate), "idle");
}
assert.equal(detector.update(0.03, 0.008, frameSamples, sampleRate), "candidate");
assert.equal(detector.update(0.03, 0.008, frameSamples, sampleRate), "start");

const interruptionDetector = new VoiceTurnDetector({
  minimumSpeechMs: 96,
  endOfSpeechSilenceMs: 128,
  speechRmsThreshold: 0.006,
  speechPeakThreshold: 0.02,
});
assert.equal(interruptionDetector.update(0.04, 0.01, frameSamples, sampleRate), "candidate");
assert.equal(interruptionDetector.update(0.04, 0.01, frameSamples, sampleRate), "start");
for (let index = 0; index < 1; index += 1) {
  assert.equal(interruptionDetector.update(0.004, 0.002, frameSamples, sampleRate), "active");
}
assert.equal(interruptionDetector.update(0.004, 0.002, frameSamples, sampleRate), "end");

console.log("Adaptive human-speech and noise rejection checks passed.");
