import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplePodcastLookupUrl,
  buildApplePodcastSearchUrl,
  buildSpotifyOEmbedUrl,
  findSpotifyPodcastEpisode,
  parseApplePodcastCandidates,
  parseApplePodcastFeedUrl,
  parsePodcastSourceInput,
  parseSpotifyOEmbed
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

test("Spotify 节目和单集链接只接受官方域名及正确 ID", () => {
  const episode = parsePodcastSourceInput(
    "https://open.spotify.com/episode/4eQarsSI5sCSPMFMVSXSE0?si=71bb85f9534a4daf");
  assert.deepEqual(episode, { kind: "spotify", entity: "episode", id: "4eQarsSI5sCSPMFMVSXSE0" });
  if (episode.kind !== "spotify") throw new Error("未识别 Spotify 链接");
  assert.equal(buildSpotifyOEmbedUrl(episode),
    "https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Fepisode%2F4eQarsSI5sCSPMFMVSXSE0");
  assert.deepEqual(parsePodcastSourceInput("https://open.spotify.com/show/1234567890123456789012"),
    { kind: "spotify", entity: "show", id: "1234567890123456789012" });
  assert.throws(() => parsePodcastSourceInput("https://open.spotify.com/track/1234567890123456789012"),
    /播客节目或单集/u);
  assert.deepEqual(parsePodcastSourceInput("https://open.spotify.com.evil.test/episode/4eQarsSI5sCSPMFMVSXSE0"),
    { kind: "feed", feedUrl: "https://open.spotify.com.evil.test/episode/4eQarsSI5sCSPMFMVSXSE0" });
});

test("Spotify 元数据只读取标题，Apple 目录只留下同名候选", () => {
  const title = "Mexican Rancho Hauntings: Ghostly Footsteps & Phantom Horses";
  assert.deepEqual(parseSpotifyOEmbed(JSON.stringify({ provider_name: "Spotify", title, type: "video" })),
    { title, isVideo: true });
  assert.equal(new URL(buildApplePodcastSearchUrl(title, "episode")).searchParams.get("entity"),
    "podcastEpisode");
  const candidates = parseApplePodcastCandidates(JSON.stringify({ results: [
    { trackName: title, collectionName: "Paranormal Club: Ghosts, Folklore, and Mysteries",
      collectionId: 1799325568, episodeGuid: "rancho-episode" },
    { trackName: "Another Episode", collectionName: "Paranormal Club", collectionId: 11 },
    { trackName: title, collectionName: "Bad Result", collectionId: "invalid" }
  ] }), title, "episode");
  assert.deepEqual(candidates, [{ collectionId: "1799325568",
    collectionName: "Paranormal Club: Ghosts, Folklore, and Mysteries",
    episodeTitle: title, episodeGuid: "rancho-episode" }]);
  assert.equal(findSpotifyPodcastEpisode([
    { title: "Unrelated episode", guid: "other" },
    { title: "Renamed episode", guid: "rancho-episode" }
  ], candidates[0]), 1);
  assert.equal(findSpotifyPodcastEpisode([{ title, guid: null }], candidates[0]), 0);
});
