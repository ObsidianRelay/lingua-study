export type PodcastSourceInput =
  | { kind: "feed"; feedUrl: string }
  | { kind: "apple"; collectionId: string };

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
    throw new Error("请输入公开 Podcast RSS 地址或 Apple Podcasts 节目链接。");
  }
  const collectionId = appleCollectionId(url);
  return collectionId
    ? { kind: "apple", collectionId }
    : { kind: "feed", feedUrl: url.toString() };
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
