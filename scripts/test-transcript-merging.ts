import assert from "node:assert/strict";
import { mergeTranscriptFragments } from "../src/lib/transcript";

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
