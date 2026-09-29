import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeChannelLink, parseYouTubeChannelPage, youtubeFeedUrl } from "../src/rss-subscription-source-core";

const id = "UCAuUUnT6oDeKwE6v1NGQxug";
const rss = youtubeFeedUrl(id);

test("YouTube handle、旧式频道和频道 ID 链接可识别", () => {
  assert.deepEqual(parseYouTubeChannelLink("https://www.youtube.com/@TED/videos?view=0"),
    { pageUrl: "https://www.youtube.com/@TED", channelId: null });
  assert.deepEqual(parseYouTubeChannelLink(`https://youtube.com/channel/${id}`),
    { pageUrl: `https://www.youtube.com/channel/${id}`, channelId: id });
  assert.equal(parseYouTubeChannelLink("https://www.youtube.com/c/TED" )?.pageUrl, "https://www.youtube.com/c/TED");
  assert.equal(parseYouTubeChannelLink("https://www.youtube.com/user/TEDtalksDirector" )?.pageUrl,
    "https://www.youtube.com/user/TEDtalksDirector");
  assert.equal(parseYouTubeChannelLink("https://youtube.com.evil.test/@TED"), null);
  assert.equal(parseYouTubeChannelLink("http://www.youtube.com/@TED"), null);
  assert.equal(parseYouTubeChannelLink("https://www.youtube.com/watch?v=abcdefghijk"), null);
});

test("只读取发布者声明的 RSS 或 canonical，忽略推荐视频中的 channelId", () => {
  const html = `<html><head><meta content="TED" property="og:title"><link type="application/rss+xml" href="${rss.replaceAll("&", "&amp;")}" rel="alternate"></head>
    <body>{"channelId":"UC1234567890123456789012"}</body></html>`;
  assert.deepEqual(parseYouTubeChannelPage(html), { feedUrl: rss, title: "TED" });
  assert.deepEqual(parseYouTubeChannelPage(`<link rel="canonical" href="https://www.youtube.com/channel/${id}">`),
    { feedUrl: rss, title: "YouTube 频道" });
  assert.throws(() => parseYouTubeChannelPage('{"channelId":"UC1234567890123456789012"}'), /没有提供/u);
  assert.throws(() => parseYouTubeChannelPage(`<link rel="alternate" type="application/rss+xml" href="https://evil.test/feeds/videos.xml?channel_id=${id}">`), /没有提供/u);
});
