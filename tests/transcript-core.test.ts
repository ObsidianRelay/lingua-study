import assert from "node:assert/strict";
import test from "node:test";
import {
  updateTranscriptSegmentText,
  validateTranscript,
  type TranscriptFile
} from "../src/transcript-core";

const transcript: TranscriptFile = validateTranscript({
  version: 1,
  videoId: "BV1zYui6fE4r",
  sourceUrl: "https://www.bilibili.com/video/BV1zYui6fE4r",
  language: "en",
  segments: [
    { start: 0, end: 2, text: "It get started." },
    { start: 2, end: 4, text: "Next sentence." }
  ]
});

test("手工编辑保留首次原文且不改变时间轴", () => {
  const edited = updateTranscriptSegmentText(transcript, 0, "It gets started.");
  assert.deepEqual(edited.segments[0], {
    start: 0,
    end: 2,
    text: "It gets started.",
    originalText: "It get started."
  });
  const editedAgain = updateTranscriptSegmentText(edited, 0, "It has started.");
  assert.equal(editedAgain.segments[0]?.originalText, "It get started.");
  const restored = updateTranscriptSegmentText(editedAgain, 0, "It get started.");
  assert.deepEqual(restored.segments[0], {
    start: 0,
    end: 2,
    text: "It get started."
  });
});
