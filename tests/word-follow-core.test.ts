import assert from "node:assert/strict";
import test from "node:test";
import { matchTimedWordsToText } from "../src/word-follow-core";

test("词级时间只对应完整匹配的字幕文字，避免错亮其他词", () => {
  const words = [
    { start: 0, end: 0.3, text: "Hello" },
    { start: 0.3, end: 0.8, text: "world." }
  ];
  assert.deepEqual(matchTimedWordsToText("Hello world.", words), [
    { startOffset: 0, endOffset: 5 },
    { startOffset: 6, endOffset: 12 }
  ]);
  assert.equal(matchTimedWordsToText("Hello there.", words), null);
  assert.equal(matchTimedWordsToText("Hello extra world.", words), null);
});
