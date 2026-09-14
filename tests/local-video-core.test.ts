import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingLocalSubtitleNames,
  isSupportedLocalSubtitlePath,
  isSupportedLocalVideoPath
} from "../src/local-video-core";

test("本地视频第一版只接受 MP4 和 SRT/VTT", () => {
  assert.equal(isSupportedLocalVideoPath("/TV/Episode 1.MP4"), true);
  assert.equal(isSupportedLocalVideoPath("/TV/Episode 1.mkv"), false);
  assert.equal(isSupportedLocalSubtitlePath("C:\\TV\\Episode 1.en.srt"), true);
  assert.equal(isSupportedLocalSubtitlePath("/TV/Episode 1.vtt"), true);
  assert.equal(isSupportedLocalSubtitlePath("/TV/Episode 1.ass"), false);
});

test("同名字幕匹配优先英文标记并排除其他剧集", () => {
  assert.deepEqual(
    findMatchingLocalSubtitleNames("/TV/S01E01.mp4", [
      "S01E02.en.srt",
      "S01E01.zh.srt",
      "S01E01.vtt",
      "S01E01.en-US.srt"
    ]),
    ["S01E01.en-US.srt", "S01E01.vtt"]
  );
});
