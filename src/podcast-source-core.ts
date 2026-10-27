export type PodcastSourceInput =
  | { kind: "feed"; feedUrl: string }
  | { kind: "apple"; collectionId: string }
  | { kind: "spotify"; entity: "show" | "episode"; id: string };

export interface SpotifyPodcastCandidate {
  collectionId: string;
  collectionName: string;
  episodeTitle: string | null;
  episodeGuid: string | null;
}

function asHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Apple Podcasts 分享页通常以 /id<collectionId> 结尾，查询参数可包含某一集的 ID。 */
function appleCollectionId(url: URL): string | null {
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "podcasts.apple.com") {
    return null;
  }
  return /\/id([0-9]+)$/u.exec(url.pathname)?.[1] ?? null;
}

export function parsePodcastSourceInput(value: string): PodcastSourceInput {
  const url = asHttpUrl(value);
  if (!url) {
    throw new Error("请输入 Spotify / Apple Podcasts 链接或公开播客 RSS 地址。");
  }
  if (url.hostname.toLowerCase() === "open.spotify.com") {
    const match = /^\/(show|episode)\/([A-Za-z0-9]{22})\/?$/u.exec(url.pathname);
    if (!match || url.protocol !== "https:") {
      throw new Error("请粘贴 Spotify 播客节目或单集的分享链接。");
    }
    return { kind: "spotify", entity: match[1] as "show" | "episode", id: match[2] };
  }
  const collectionId = appleCollectionId(url);
  return collectionId
    ? { kind: "apple", collectionId }
    : { kind: "feed", feedUrl: url.toString() };
}

export function buildSpotifyOEmbedUrl(source: Extract<PodcastSourceInput, { kind: "spotify" }>): string {
  const spotifyUrl = `https://open.spotify.com/${source.entity}/${source.id}`;
  return `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
}

export function parseSpotifyOEmbed(value: string): { title: string; isVideo: boolean } {
  let payload: unknown;
  try { payload = JSON.parse(value); } catch { throw new Error("Spotify 没有返回有效的节目信息。"); }
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title || title.length > 300 || record.provider_name !== "Spotify") {
    throw new Error("无法识别 Spotify 播客标题，请改用公开 RSS 地址。");
  }
  return { title, isVideo: record.type === "video" };
}

export function buildApplePodcastSearchUrl(title: string, entity: "show" | "episode"): string {
  const params = new URLSearchParams({
    term: title,
    media: "podcast",
    entity: entity === "show" ? "podcast" : "podcastEpisode",
    country: "us",
    limit: "25"
  });
  return `https://itunes.apple.com/search?${params.toString()}`;
}

function normalizedPodcastTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function parseApplePodcastCandidates(
  value: string,
  spotifyTitle: string,
  entity: "show" | "episode"
): SpotifyPodcastCandidate[] {
  let payload: unknown;
  try { payload = JSON.parse(value); } catch { throw new Error("Apple Podcasts 搜索结果无法解析。"); }
  const results = payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
    ? (payload as { results: unknown[] }).results : [];
  const target = normalizedPodcastTitle(spotifyTitle);
  const candidates: SpotifyPodcastCandidate[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const result = item as Record<string, unknown>;
    const title = entity === "show" ? result.collectionName : result.trackName;
    const collectionId = result.collectionId;
    const collectionName = result.collectionName;
    if (typeof title !== "string" || normalizedPodcastTitle(title) !== target ||
      typeof collectionName !== "string" ||
      (typeof collectionId !== "number" && typeof collectionId !== "string") ||
      !/^[0-9]+$/u.test(String(collectionId))) continue;
    const episodeGuid = entity === "episode" && typeof result.episodeGuid === "string"
      ? result.episodeGuid : null;
    const key = `${collectionId}:${episodeGuid ?? normalizedPodcastTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      collectionId: String(collectionId),
      collectionName,
      episodeTitle: entity === "episode" ? title : null,
      episodeGuid
    });
  }
  return candidates;
}

export function findSpotifyPodcastEpisode(
  episodes: readonly { title: string; guid: string | null }[],
  candidate: SpotifyPodcastCandidate
): number {
  if (!candidate.episodeTitle) return -1;
  const byGuid = candidate.episodeGuid
    ? episodes.findIndex((episode) => episode.guid === candidate.episodeGuid) : -1;
  if (byGuid >= 0) return byGuid;
  const target = normalizedPodcastTitle(candidate.episodeTitle);
  const matches = episodes.flatMap((episode, index) =>
    normalizedPodcastTitle(episode.title) === target ? [index] : []);
  return matches.length === 1 ? matches[0] : -1;
}

export function buildApplePodcastLookupUrl(collectionId: string): string {
  if (!/^[0-9]+$/u.test(collectionId)) {
    throw new Error("Apple Podcasts 节目 ID 无效。");
  }
  return `https://itunes.apple.com/lookup?id=${collectionId}&entity=podcast`;
}

export function parseApplePodcastFeedUrl(value: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("Apple Podcasts 目录返回了无法解析的数据。");
  }
  const results = payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
    ? (payload as { results: unknown[] }).results
    : [];
  for (const result of results) {
    const feedUrl = result && typeof result === "object" && typeof (result as { feedUrl?: unknown }).feedUrl === "string"
      ? (result as { feedUrl: string }).feedUrl
      : "";
    const parsed = asHttpUrl(feedUrl);
    if (parsed) {
      return parsed.toString();
    }
  }
  throw new Error("Apple Podcasts 没有返回可用的 RSS。请改为粘贴播客官网的 RSS 地址。");
}
