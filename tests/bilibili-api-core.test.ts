import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedBilibiliSubtitleUrl,
  hasBilibiliLoginCookie,
  parseBilibiliSubtitleBody,
  parseBilibiliSubtitleTracks,
  parseBilibiliVideoMetadata,
  selectBilibiliEnglishTrack
} from "../src/bilibili-api-core";

test("B站登录状态直接识别隔离会话中的 SESSDATA", () => {
  assert.equal(hasBilibiliLoginCookie([
    { name: "DedeUserID", value: "123" },
    { name: "SESSDATA", value: "encrypted-session" }
  ]), true);
  assert.equal(hasBilibiliLoginCookie([
    { name: "DedeUserID", value: "123" },
    { name: "SESSDATA", value: "" }
  ]), false);
});

test("解析 B站视频分 P 元数据", () => {
  const metadata = parseBilibiliVideoMetadata({
    code: 0,
    data: {
      aid: 123,
      title: "English lesson",
      pages: [
        { page: 1, cid: 456 },
        { page: 2, cid: 789 }
      ]
    }
  }, "BV1Gf4y1y7wc", 2);
  assert.equal(metadata.aid, 123);
  assert.equal(metadata.cid, 789);
  assert.equal(metadata.sourceUrl, "https://www.bilibili.com/video/BV1Gf4y1y7wc?p=2");
});

test("字幕轨只接受可信 HTTPS 域名并优先人工英文", () => {
  const parsed = parseBilibiliSubtitleTracks({
    code: 0,
    data: {
      need_login_subtitle: false,
      subtitle: {
        subtitles: [
          { lan: "ai-en", lan_doc: "English (auto)", subtitle_url: "//aisubtitle.hdslb.com/a.json", type: 1 },
          { lan: "en-US", lan_doc: "English", subtitle_url: "https://i0.hdslb.com/b.json", type: 0 },
          { lan: "en", subtitle_url: "http://i0.hdslb.com/insecure.json", type: 0 },
          { lan: "en", subtitle_url: "https://example.com/evil.json", type: 0 }
        ]
      }
    }
  });
  assert.equal(parsed.tracks.length, 2);
  assert.equal(selectBilibiliEnglishTrack(parsed.tracks)?.label, "English");
  assert.equal(allowedBilibiliSubtitleUrl("https://example.com/a.json"), null);
});

test("字幕正文清理标签并忽略无效时间", () => {
  const segments = parseBilibiliSubtitleBody({
    body: [
      { from: 1, to: 2.5, content: "<b>Hello</b>   world" },
      { from: 3, to: 2, content: "invalid" }
    ]
  });
  assert.deepEqual(segments, [{ start: 1, duration: 1.5, text: "Hello world" }]);
});
