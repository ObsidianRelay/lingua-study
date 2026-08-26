import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBilibiliCacheBaseName,
  getDefaultBilibiliCacheFolder,
  isAllowedBilibiliCdnUrl,
  MAX_BILIBILI_CACHE_VIDEO_BYTES,
  parseBilibiliMediaByteRange
} from "../src/bilibili-cache-core";

test("为不同桌面系统选择不会进入 Obsidian 笔记库的缓存目录", () => {
  assert.equal(
    getDefaultBilibiliCacheFolder("darwin", "/Users/test", {}),
    "/Users/test/Library/Caches/Lingua Study/Bilibili"
  );
  assert.equal(
    getDefaultBilibiliCacheFolder("linux", "/home/test", { XDG_CACHE_HOME: "/cache" }),
    "/cache/lingua-study/bilibili"
  );
  assert.equal(
    getDefaultBilibiliCacheFolder("win32", "C:\\Users\\test", { LOCALAPPDATA: "C:\\Local" }),
    "C:\\Local/Lingua Study/Cache/Bilibili"
  );
});

test("只接受B站 HTTPS 视频 CDN 地址", () => {
  assert.equal(isAllowedBilibiliCdnUrl("https://upos-sz.bilivideo.com/path/video.mp4"), true);
  assert.equal(isAllowedBilibiliCdnUrl("https://mcdn.bilivideo.cn/path/video.mp4"), true);
  assert.equal(isAllowedBilibiliCdnUrl("http://upos-sz.bilivideo.com/video.mp4"), false);
  assert.equal(isAllowedBilibiliCdnUrl("https://bilivideo.com.evil.example/video.mp4"), false);
  assert.equal(isAllowedBilibiliCdnUrl("https://example.com/video.mp4"), false);
});

test("缓存文件名和大小上限固定且不会接受路径内容", () => {
  assert.equal(buildBilibiliCacheBaseName("BV1B7411m7LV", 2), "BV1B7411m7LV-p2");
  assert.throws(() => buildBilibiliCacheBaseName("../video", 1), /视频 ID/);
  assert.throws(() => buildBilibiliCacheBaseName("BV1B7411m7LV", 0), /页码/);
  assert.equal(MAX_BILIBILI_CACHE_VIDEO_BYTES, 2 * 1024 * 1024 * 1024);
});

test("本地播放器只接受有效的单段视频范围请求", () => {
  assert.deepEqual(parseBilibiliMediaByteRange("bytes=0-499", 1_000), {
    start: 0,
    end: 499
  });
  assert.deepEqual(parseBilibiliMediaByteRange("bytes=500-", 1_000), {
    start: 500,
    end: 999
  });
  assert.deepEqual(parseBilibiliMediaByteRange("bytes=-100", 1_000), {
    start: 900,
    end: 999
  });
  assert.deepEqual(parseBilibiliMediaByteRange("bytes=900-2000", 1_000), {
    start: 900,
    end: 999
  });
  assert.equal(parseBilibiliMediaByteRange("bytes=1000-", 1_000), null);
  assert.equal(parseBilibiliMediaByteRange("bytes=500-100", 1_000), null);
  assert.equal(parseBilibiliMediaByteRange("bytes=0-1,4-5", 1_000), null);
});
