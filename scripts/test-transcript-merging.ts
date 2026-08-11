import assert from "node:assert/strict";
import { mergeTranscriptFragments } from "../src/lib/transcript";
import { toLatinDisplayText } from "../src/lib/latinText";

assert.equal(mergeTranscriptFragments("", "open Chrome"), "open Chrome");
assert.equal(mergeTranscriptFragments("open", "open Chrome"), "open Chrome");
assert.equal(
  mergeTranscriptFragments("open Chrome and", "and search YouTube"),
  "open Chrome and search YouTube",
);
assert.equal(
  mergeTranscriptFragments("एक बार Chrome", "Chrome खोलो"),
  "एक बार Chrome खोलो",
);
assert.equal(mergeTranscriptFragments("how are you", "?"), "how are you?");
assert.equal(
  mergeTranscriptFragments("कुछ एक फाइल खुली हैं", "फाइल खुली हैं।"),
  "कुछ एक फाइल खुली हैं।",
);

console.log("Continuous transcript merging checks passed.");

assert.equal(toLatinDisplayText("क्या कर रही हो?"), "kya kar rahi ho?");
assert.equal(toLatinDisplayText("मुझे Chrome खोलो"), "mujhe Chrome kholo");
assert.equal(toLatinDisplayText("हाँ, Chrome खोल दिया।"), "haan, Chrome khol diya.");
assert.equal(toLatinDisplayText("Open `const नाम = 3` at https://example.com/हिंदी"), "Open `const नाम = 3` at https://example.com/हिंदी");
assert.equal(/[\u0900-\u097f]/u.test(toLatinDisplayText("बोलो Shree")), false);
assert.equal(toLatinDisplayText("کیا کر رہی ہو؟"), "kya kar rahi ho?");
assert.equal(toLatinDisplayText("مجھے Chrome کھولو"), "mujhe Chrome kholo");
assert.equal(/[\u0600-\u06ff]/u.test(toLatinDisplayText("شری")), false);
assert.equal(toLatinDisplayText("మూడు 3"), "three 3");
assert.equal(toLatinDisplayText("పరీక్ష"), "");
console.log("Latin-only conversational display checks passed.");
