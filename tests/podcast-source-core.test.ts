import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplePodcastLookupUrl,
  parseApplePodcastFeedUrl,
  parsePodcastSourceInput
} from "../src/podcast-source-core";

test("Apple Podcasts 分享链接会解析为节目 ID 并构造目录查询", () => {
  assert.deepEqual(
    parsePodcastSourceInput("https://podcasts.apple.com/us/podcast/all-ears-english-podcast/id751574016?uo=4"),
    { kind: "apple", collectionId: "751574016" }
  );
  assert.equal(
    buildApplePodcastLookupUrl("751574016"),
    "https://itunes.apple.com/lookup?id=751574016&entity=podcast"
  );
});

test("普通 HTTP(S) 地址仍按 RSS 处理，伪造 Apple 域名不会被信任", () => {
  assert.deepEqual(parsePodcastSourceInput("https://feeds.megaphone.fm/allearsenglish"), {
    kind: "feed",
    feedUrl: "https://feeds.megaphone.fm/allearsenglish"
  });
  assert.deepEqual(parsePodcastSourceInput("https://podcasts.apple.com.evil.test/id751574016"), {
    kind: "feed",
    feedUrl: "https://podcasts.apple.com.evil.test/id751574016"
  });
});

test("Apple 目录结果只接受安全的 feedUrl", () => {
  assert.equal(
    parseApplePodcastFeedUrl(JSON.stringify({ results: [{ feedUrl: "https://feeds.megaphone.fm/allearsenglish" }] })),
    "https://feeds.megaphone.fm/allearsenglish"
  );
  assert.throws(
    () => parseApplePodcastFeedUrl(JSON.stringify({ results: [{ feedUrl: "file:///private/feed.xml" }] })),
    /没有返回可用的 RSS/u
  );
});
