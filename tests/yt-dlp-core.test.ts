import assert from "node:assert/strict";
import test from "node:test";
import {
  buildYtDlpCandidates,
  mapYtDlpFailure,
  selectGeneratedSubtitleFile
} from "../src/yt-dlp-core";

test("yt-dlp 自动探测优先使用用户路径并覆盖常见桌面环境", () => {
  assert.deepEqual(
    buildYtDlpCandidates(" /custom/yt-dlp ", "darwin"),
    [
      "/custom/yt-dlp",
      "yt-dlp",
      "/opt/homebrew/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
      "/opt/local/bin/yt-dlp"
    ]
  );
  assert.deepEqual(
    buildYtDlpCandidates("C:\\Tools\\yt-dlp.exe", "win32"),
    ["C:\\Tools\\yt-dlp.exe", "yt-dlp.exe", "yt-dlp"]
  );
});

test("yt-dlp 错误不会原样泄露，而会映射为明确中文原因", () => {
  assert.equal(mapYtDlpFailure("Sign in to confirm you're not a bot").code, "login-required");
  assert.equal(mapYtDlpFailure("ERROR: Private video").code, "private-or-unavailable");
  assert.equal(mapYtDlpFailure("There are no subtitles for the requested languages").code, "no-captions");
  assert.equal(mapYtDlpFailure("HTTP Error 429: Too Many Requests").code, "rate-limited");
  assert.equal(mapYtDlpFailure("Unable to download webpage: timed out").code, "network");
  assert.equal(mapYtDlpFailure("Unexpected extractor output").code, "invalid-response");
});

test("优先读取 JSON3，并拒绝临时目录中的非字幕文件", () => {
  assert.equal(
    selectGeneratedSubtitleFile(["video.info.json", "video.en.vtt", "video.en.json3"]),
    "video.en.json3"
  );
  assert.equal(selectGeneratedSubtitleFile(["video.en.vtt", "video.en.srt"]), "video.en.vtt");
  assert.equal(selectGeneratedSubtitleFile(["video.part", "video.mp4"]), null);
});
