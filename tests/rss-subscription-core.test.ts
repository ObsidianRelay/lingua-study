import assert from "node:assert/strict";
import test from "node:test";
import {
  addNewSubscriptionData,
  addSubscriptionCategory,
  assignSubscriptionCategory,
  buildSubscriptionOverview,
  canonicalFeedUrl,
  countNewSubscriptionItems,
  emptySubscriptionData,
  escapeSubscriptionNoteTitle,
  mergeSubscription,
  parseSubscriptionData,
  parseSubscriptionFeed,
  parseYouTubeSubscription,
  pendingYouTubeSubscription,
  removeSubscriptionCategory,
  removeSubscriptionData,
  renameImportedNote,
  selectSubscriptionSources,
  subscriptionItemKey,
  subscriptionNotePath,
  upsertSubscriptionData,
  youtubeThumbnailUrl
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
  assert.equal(countNewSubscriptionItems(first, merged), 1);
  const third = parseYouTubeSubscription(youtubeXml.replaceAll("abcdefghijk", "01234567890"), youtubeUrl);
  const accumulated = mergeSubscription(merged, third);
  assert.deepEqual(accumulated.items.map((item) => item.id), ["01234567890", "lmnopqrstuv", "abcdefghijk"]);
  assert.equal(countNewSubscriptionItems(merged, accumulated), 1);
  assert.equal(countNewSubscriptionItems(accumulated, mergeSubscription(accumulated, third)), 0);
});

test("视频简介从频道 RSS 读取，刷新缺失简介时保留旧内容", () => {
  const withDescription = youtubeXml.replace("</entry>",
    "<media:group><media:description><![CDATA[<p>Why &amp; how to act.</p>]]></media:description></media:group></entry>");
  const described = parseYouTubeSubscription(withDescription, youtubeUrl);
  assert.equal(described.items[0]?.description, "Why & how to act.");
  const refreshed = mergeSubscription(described, parseYouTubeSubscription(youtubeXml, youtubeUrl));
  assert.equal(refreshed.items[0]?.description, "Why & how to act.");
  assert.equal(parseSubscriptionData(upsertSubscriptionData(emptySubscriptionData(), refreshed)).feeds[0]?.items[0]?.description,
    "Why & how to act.");
  assert.equal(parseSubscriptionData(upsertSubscriptionData(emptySubscriptionData(), parseYouTubeSubscription(youtubeXml, youtubeUrl)))
    .feeds[0]?.items[0]?.description, undefined);
});

test("全部订阅按频道分区预览，不混排且不改动原条目顺序", () => {
  const youtube = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const video = youtube.items[0]!;
  const videos = [0, 1, 2, 3, 4].map((index) => ({ ...video,
    id: `video00000${index}`, publishedAt: `2026-09-${20 - index}` }));
  const channel = { ...youtube, items: [...videos].reverse() };
  const podcast = parseSubscriptionFeed(`<rss><channel><title>Podcast</title><item><guid>new</guid><title>New episode</title>
    <pubDate>Thu, 24 Sep 2026 05:00:00 +0000</pubDate><enclosure url="https://example.test/one.mp3" type="audio/mpeg" />
    </item></channel></rss>`, "https://example.test/feed.xml");
  const overview = buildSubscriptionOverview([channel, podcast], 4);
  assert.deepEqual(overview.map((group) => group.feed.title), ["Podcast", "English Channel"]);
  assert.equal(overview[0]?.items.length, 1);
  assert.deepEqual(overview[1]?.items.map((item) => item.id), videos.slice(0, 4).map((item) => item.id));
  assert.deepEqual(channel.items.map((item) => item.id), [...videos].reverse().map((item) => item.id));
});

test("固定视频和播客目录按来源类型列频道，彩色标签只负责筛选", () => {
  const video = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const podcast = parseSubscriptionFeed(`<rss><channel><title>My Podcast</title><item><guid>one</guid><title>Episode 1</title>
    <enclosure url="https://example.test/one.mp3" type="audio/mpeg" /></item></channel></rss>`, "https://example.test/rss.xml");
  const data = addNewSubscriptionData(emptySubscriptionData(), video, { name: "演讲", color: "red" });
  const withPodcast = addNewSubscriptionData(data, podcast, { existingId: data.categories[0]!.id });
  assert.deepEqual(selectSubscriptionSources(withPodcast.feeds, "__all").map((feed) => feed.title), ["English Channel", "My Podcast"]);
  assert.deepEqual(selectSubscriptionSources(withPodcast.feeds, "youtube").map((feed) => feed.title), ["English Channel"]);
  assert.deepEqual(selectSubscriptionSources(withPodcast.feeds, "podcast").map((feed) => feed.title), ["My Podcast"]);
  assert.deepEqual(selectSubscriptionSources(withPodcast.feeds, "youtube", data.categories[0]!.id).map((feed) => feed.title), ["English Channel"]);
  assert.deepEqual(selectSubscriptionSources(withPodcast.feeds, "podcast", "__all", video.id), []);
  assert.equal(withPodcast.feeds[0]?.categoryId, data.categories[0]!.id);
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
  const oldFeed = { id: feed.id, kind: feed.kind, url: feed.url, title: feed.title, items: feed.items };
  const migrated = parseSubscriptionData({ version: 1, feeds: [oldFeed], imports: { "youtube:abcdefghijk": "Study/Old.md" } });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.feeds[0]?.categoryId, null);
  assert.equal(migrated.feeds[0]?.status, "ready");
  assert.equal(migrated.imports["youtube:abcdefghijk"], "Study/Old.md");
  assert.deepEqual(migrated.categories, []);
});

test("分类创建、调整和删除不丢失订阅与导入记录", () => {
  const feed = parseYouTubeSubscription(youtubeXml, youtubeUrl);
  const data = addNewSubscriptionData(emptySubscriptionData(), feed, { name: "演讲", color: "purple" });
  const id = data.categories[0]!.id;
  assert.equal(data.feeds[0]?.categoryId, id);
  assert.throws(() => addNewSubscriptionData(data, feed, { existingId: id }), /已经添加/u);
  const withImport = { ...data, imports: { "youtube:abcdefghijk": "Study/Old.md" } };
  const refreshed = upsertSubscriptionData(withImport, parseYouTubeSubscription(youtubeXml, youtubeUrl));
  assert.equal(refreshed.feeds[0]?.categoryId, id);
  const unclassified = assignSubscriptionCategory(refreshed, feed.id, null);
  assert.equal(unclassified.feeds[0]?.categoryId, null);
  const recategorized = assignSubscriptionCategory(unclassified, feed.id, id);
  const removed = removeSubscriptionCategory(recategorized, id);
  assert.equal(removed.feeds[0]?.categoryId, null);
  assert.equal(removed.imports["youtube:abcdefghijk"], "Study/Old.md");
  assert.equal(removed.feeds[0]?.items.length, 1);
  assert.throws(() => addSubscriptionCategory(data, "演讲", "blue"), /重名/u);
});

test("待刷新频道恢复后转为已就绪，已获取的视频在异常时可保留", () => {
  const pending = pendingYouTubeSubscription(youtubeUrl, "English Channel");
  assert.equal(pending.status, "pending");
  assert.deepEqual(pending.items, []);
  const data = upsertSubscriptionData(emptySubscriptionData(), pending);
  const ready = upsertSubscriptionData(data, parseYouTubeSubscription(youtubeXml, youtubeUrl));
  assert.equal(ready.feeds[0]?.status, "ready");
  assert.equal(ready.feeds[0]?.items[0]?.title, "First & second");
  assert.equal(youtubeThumbnailUrl("abcdefghijk"), "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  assert.equal(youtubeThumbnailUrl("invalid"), null);
});
