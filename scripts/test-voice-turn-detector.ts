import assert from "node:assert/strict";
import { VoiceTurnDetector } from "../src/lib/VoiceTurnDetector";

const detector = new VoiceTurnDetector();
const sampleRate = 16_000;
const frameSamples = 1_024;

assert.equal(detector.update(0.002, 0.001, frameSamples, sampleRate), "idle");
assert.equal(detector.update(0.08, 0.02, frameSamples, sampleRate), "start");

for (let index = 0; index < 13; index++) {
  assert.equal(
    detector.update(0.004, 0.002, frameSamples, sampleRate),
    "active",
    "A natural pause shorter than 850 ms must not split the utterance",
  );
}

assert.equal(
  detector.update(0.004, 0.002, frameSamples, sampleRate),
  "end",
  "Sustained silence must commit the voice turn",
);
assert.equal(detector.update(0.07, 0.018, frameSamples, sampleRate), "start");
detector.reset();
assert.equal(detector.update(0.001, 0.001, frameSamples, sampleRate), "idle");

console.log("Voice turn detector checks passed.");
