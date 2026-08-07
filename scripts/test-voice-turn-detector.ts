import assert from "node:assert/strict";
import { VoiceTurnDetector } from "../src/lib/VoiceTurnDetector";

const detector = new VoiceTurnDetector();
const sampleRate = 16_000;
const frameSamples = 1_024;

assert.equal(detector.update(0.002, 0.001, frameSamples, sampleRate), "idle");
assert.equal(detector.update(0.08, 0.02, frameSamples, sampleRate), "start");
for (let index = 0; index < 6; index += 1) {
  assert.equal(detector.update(0.004, 0.002, frameSamples, sampleRate), "active");
}
assert.equal(detector.update(0.004, 0.002, frameSamples, sampleRate), "end");
assert.equal(detector.update(0.07, 0.018, frameSamples, sampleRate), "start");

console.log("Fast voice endpoint checks passed.");
