import assert from "node:assert/strict";
import test from "node:test";
import { parsePodcastFeed, selectEnglishPodcastTranscript } from "../src/podcast-rss-core";

test("RSS 2.0 enclosure 和 Podcasting transcript 会解析为稳定节目", () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>English Avenue</title><item>
    <guid>episode-42</guid><title><![CDATA[How to explain &amp; speak]]></title>
    <pubDate>Fri, 20 Sep 2026 00:00:00 GMT</pubDate>
    <enclosure url="/audio/42.mp3" type="audio/mpeg" length="1234" />
    <podcast:transcript url="/transcripts/42.vtt" type="text/vtt" language="en-US" />
  </item></channel></rss>`;
  const feed = parsePodcastFeed(xml, "https://example.test/feed.xml");
  assert.equal(feed.title, "English Avenue");
  assert.deepEqual(feed.episodes[0], {
    sourceId: "podcast-BJwphKXEFqTgXgR6I5ET4I",
    guid: "episode-42",
    title: "How to explain & speak",
    publishedAt: "Fri, 20 Sep 2026 00:00:00 GMT",
    enclosureUrl: "https://example.test/audio/42.mp3",
    enclosureType: "audio/mpeg",
    enclosureBytes: 1234,
    transcripts: [{
      url: "https://example.test/transcripts/42.vtt",
      type: "text/vtt",
      language: "en-us"
    }]
  });
  assert.equal(selectEnglishPodcastTranscript(feed.episodes[0]?.transcripts ?? [])?.url,
    "https://example.test/transcripts/42.vtt");
});

test("Atom enclosure、相对链接和重复 guid 能被一致处理", () => {
  const xml = `<feed><title>Example</title><entry><id>urn:one</id><title>One</title>
    <link rel="enclosure" href="audio/one.m4a" type="audio/mp4" length="99" />
  </entry><entry><id>urn:one</id><title>Duplicate</title>
    <link rel="enclosure" href="audio/other.m4a" type="audio/mp4" />
  </entry></feed>`;
  const feed = parsePodcastFeed(xml, "https://cdn.example.test/shows/feed.xml");
  assert.equal(feed.episodes.length, 1);
  assert.equal(feed.episodes[0]?.enclosureUrl, "https://cdn.example.test/shows/audio/one.m4a");
});

test("没有 enclosure 或不安全协议的 RSS 会给出可操作错误", () => {
  assert.throws(
    () => parsePodcastFeed("<rss><channel><item><title>Missing</title></item></channel></rss>", "https://example.test/feed.xml"),
    /没有可播放的音频节目/u
  );
  assert.throws(
    () => parsePodcastFeed("<rss><channel><item><enclosure url=\"file:///secret.mp3\" /></item></channel></rss>", "https://example.test/feed.xml"),
    /没有可播放的音频节目/u
  );
});
