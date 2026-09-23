import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalFeedUrl,
  emptySubscriptionData,
  escapeSubscriptionNoteTitle,
  mergeSubscription,
  parseSubscriptionData,
  parseSubscriptionFeed,
  parseYouTubeSubscription,
  removeSubscriptionData,
  renameImportedNote,
  subscriptionItemKey,
  subscriptionNotePath,
  upsertSubscriptionData
} from "../src/rss-subscription-core";

const youtubeUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012";
const youtubeXml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>English Channel</title>
  <entry><yt:videoId>abcdefghijk</yt:videoId><title>First &amp; second</title><published>2026-09-20</published></entry>
  <entry><yt:videoId>abcdefghijk</yt:videoId><title>Duplicate</title></entry>
  <entry><yt:videoId>invalid</yt:videoId><title>Invalid</title></entry>
</feed>`;

test("YouTube 频道 RSS 提取视频 ID、标题并去重", () => {
  const feed = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  assert.equal(feed.kind, "youtube");
  assert.equal(feed.title, "English Channel");
  assert.deepEqual(feed.items, [{
    kind: "youtube", id: "abcdefghijk", title: "First & second",
    publishedAt: "2026-09-20", url: "https://www.youtube.com/watch?v=abcdefghijk"
  }]);
  assert.equal(subscriptionItemKey(feed.items[0]!), "youtube:abcdefghijk");
  assert.match(subscriptionNotePath(feed.items[0]!), /First & second \[abcdefghijk\]\.md$/u);
});

test("播客 RSS 使用现有解析器，刷新保留旧条目但不重复", () => {
  const podcastXml = `<rss><channel><title>My Podcast</title><item><guid>one</guid><title>Episode 1</title>
    <enclosure url="https://example.test/one.mp3" type="audio/mpeg" /></item></channel></rss>`;
  const feed = parseSubscriptionFeed(podcastXml, "https://example.test/rss.xml");
  assert.equal(feed.kind, "podcast");
  assert.equal(feed.items[0]?.kind, "podcast");
  const merged = mergeSubscription(feed, feed);
  assert.equal(merged.items.length, 1);
  assert.match(subscriptionNotePath(feed.items[0]!), /podcast\/Episode 1 \[podcast-[\w-]+\]\.md$/u);
});

test("刷新添加新视频，同时保留已从 RSS 消失的旧视频", () => {
  const first = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const second = parseYouTubeSubscription(youtubeXml.replaceAll("abcdefghijk", "lmnopqrstuv"), youtubeUrl);
  const merged = mergeSubscription(first, second);
  assert.deepEqual(merged.items.map((item) => item.id), ["lmnopqrstuv", "abcdefghijk"]);
});

test("退订保留已导入笔记映射，笔记改名后更新路径", () => {
  const feed = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const key = subscriptionItemKey(feed.items[0]!);
  const original = { ...emptySubscriptionData(), imports: { [key]: "Study/Old.md" } };
  const added = upsertSubscriptionData(original, feed);
  const renamed = renameImportedNote(added, "Study/Old.md", "Study/New.md");
  const removed = removeSubscriptionData(renamed, feed.id);
  assert.deepEqual(removed.feeds, []);
  assert.equal(removed.imports[key], "Study/New.md");
  assert.equal(original.imports[key], "Study/Old.md");
});

test("失败重试使用稳定笔记路径，不因标题中的路径符号创建其他文件", () => {
  const feed = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const item = { ...feed.items[0]!, title: "A/B: [practice]?" };
  const path = subscriptionNotePath(item);
  assert.equal(path, "Lingua Study/Subscriptions/Notes/youtube/A B practice [abcdefghijk].md");
  assert.equal(subscriptionNotePath(item), path);
  assert.equal(escapeSubscriptionNoteTitle("![art](https://example.test/x.png)"),
    "\\!\\[art\\]\\(https://example\\.test/x\\.png\\)");
});

test("只接受公开 HTTP(S) URL 和官方 YouTube 频道 RSS", () => {
  assert.throws(() => canonicalFeedUrl("file:///private.xml"), /HTTP\(S\)/u);
  assert.throws(() => canonicalFeedUrl("https://user:pass@example.test/rss.xml"), /账号密码/u);
  assert.throws(() => canonicalFeedUrl("not a URL"), /有效的 RSS/u);
  assert.throws(() => parseYouTubeSubscription(youtubeXml, "https://youtube.com/watch?v=abcdefghijk"), /频道 RSS/u);
  assert.throws(() => parseYouTubeSubscription("<feed></feed>", youtubeUrl), /没有可识别的视频/u);
});

test("损坏或未来版本的订阅数据拒绝读取，空文件可初始化", () => {
  assert.deepEqual(parseSubscriptionData(emptySubscriptionData()), emptySubscriptionData());
  assert.throws(() => parseSubscriptionData({ version: 2, feeds: [], imports: {} }), /版本或结构/u);
  assert.throws(() => parseSubscriptionData({ version: 1, feeds: [{ id: "x" }], imports: {} }), /无效订阅源/u);
  assert.throws(() => parseSubscriptionData({ version: 1, feeds: [], imports: { x: "../outside.md" } }), /无效笔记路径/u);
  const feed = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  assert.deepEqual(parseSubscriptionData({ version: 1, feeds: [feed], imports: {} }).feeds[0], feed);
});
