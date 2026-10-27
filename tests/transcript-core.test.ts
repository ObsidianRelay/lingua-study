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

test("字幕校验接受插件生成的本地视频来源但拒绝任意协议", () => {
  const local = validateTranscript({
    ...transcript,
    videoId: "abcdefghijk",
    sourceUrl: "lingua-local://abcdefghijk"
  });
  assert.equal(local.sourceUrl, "lingua-local://abcdefghijk");
  assert.throws(
    () => validateTranscript({ ...transcript, sourceUrl: "file:///Users/test/video.mp4" }),
    /HTTPS\/播客 HTTP\/本地视频来源/u
  );
});

test("字幕校验接受公开 HTTPS Podcast 节目 ID", () => {
  const podcast = validateTranscript({
    ...transcript,
    videoId: "podcast-drmw5siPhseMEpsfLMNrDo",
    sourceUrl: "https://dcs-cached.megaphone.fm/episode.mp3"
  });
  assert.equal(podcast.videoId, "podcast-drmw5siPhseMEpsfLMNrDo");
});

test("播客 RSS 的 HTTP 音频地址可保存为字幕来源，视频仍需 HTTPS", () => {
  const sourceUrl = "http://open.live.bbc.co.uk/mediaselector/audio/episode.mp3";
  const podcast = validateTranscript({
    ...transcript,
    videoId: "podcast-giukJNJTBO7ay6P0FtNq64",
    sourceUrl
  });
  assert.equal(podcast.sourceUrl, sourceUrl);
  assert.throws(() => validateTranscript({ ...transcript, sourceUrl }), /sourceUrl 缺失/u);
});
