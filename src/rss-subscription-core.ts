import { createHash } from "node:crypto";
import { decodeXmlText, parsePodcastFeed, type PodcastEpisode } from "./podcast-rss-core";

export type SubscriptionKind = "podcast" | "youtube";

export type SubscriptionItem =
  | (PodcastEpisode & { kind: "podcast"; id: string })
  | { kind: "youtube"; id: string; title: string; publishedAt: string | null; url: string };

export interface RssSubscription {
  id: string;
  kind: SubscriptionKind;
  url: string;
  title: string;
  items: SubscriptionItem[];
}

export interface RssSubscriptionData {
  version: 1;
  feeds: RssSubscription[];
  imports: Record<string, string>;
}

const MAX_STORED_ITEMS = 200;

export function emptySubscriptionData(): RssSubscriptionData {
  return { version: 1, feeds: [], imports: {} };
}

export function canonicalFeedUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的 RSS 地址。");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("请输入公开的 HTTP(S) RSS 地址，不能包含账号密码。");
  }
  url.hash = "";
  return url.toString();
}

function isYouTubeFeed(url: string): boolean {
  const parsed = new URL(url);
  return (parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube.com") &&
    parsed.pathname === "/feeds/videos.xml";
}

function xmlTagText(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "iu").exec(source);
  const value = match?.[1] ? decodeXmlText(match[1]) : "";
  return value || null;
}

export function parseYouTubeSubscription(xml: string, sourceUrl: string): RssSubscription {
  const url = canonicalFeedUrl(sourceUrl);
  if (!isYouTubeFeed(url) || !new URL(url).searchParams.get("channel_id")) {
    throw new Error("YouTube 首版仅支持频道 RSS 地址（含 channel_id 的 videos.xml）。");
  }
  const items: SubscriptionItem[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/giu)) {
    const body = match[1] ?? "";
    const videoId = xmlTagText(body, "yt:videoId");
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/u.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    items.push({
      kind: "youtube",
      id: videoId,
      title: xmlTagText(body, "title") ?? "未命名视频",
      publishedAt: xmlTagText(body, "published"),
      url: `https://www.youtube.com/watch?v=${videoId}`
    });
    if (items.length >= MAX_STORED_ITEMS) break;
  }
  if (items.length === 0) throw new Error("这个 YouTube 频道 RSS 中没有可识别的视频。");
  const head = xml.split(/<entry\b/iu, 1)[0] ?? xml;
  return {
    id: feedId(url), kind: "youtube", url,
    title: xmlTagText(head, "title") ?? "未命名 YouTube 频道",
    items
  };
}

function feedId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function parseSubscriptionFeed(xml: string, sourceUrl: string): RssSubscription {
  const url = canonicalFeedUrl(sourceUrl);
  if (isYouTubeFeed(url)) return parseYouTubeSubscription(xml, url);
  const feed = parsePodcastFeed(xml, url);
  return {
    id: feedId(url), kind: "podcast", url,
    title: feed.title,
    items: feed.episodes.slice(0, MAX_STORED_ITEMS).map((episode) => ({
      ...episode, kind: "podcast" as const, id: episode.sourceId
    }))
  };
}

export function mergeSubscription(previous: RssSubscription | undefined, next: RssSubscription): RssSubscription {
  if (!previous) return next;
  const seen = new Set<string>();
  const items = [...next.items, ...previous.items].filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_STORED_ITEMS);
  return { ...next, items };
}

export function subscriptionItemKey(item: SubscriptionItem): string {
  return `${item.kind}:${item.id}`;
}

export function subscriptionNotePath(item: SubscriptionItem): string {
  const slug = item.title
    .replace(/[\\/:*?"<>|#^\n\r]/gu, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 70) || "未命名";
  return `Lingua Study/Subscriptions/Notes/${item.kind}/${slug} [${item.id}].md`;
}

export function escapeSubscriptionNoteTitle(value: string): string {
  return value.replace(/[\r\n]+/gu, " ")
    .replace(/([\\`*_{}()#+.!>|~-])/gu, "\\$1")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

export function upsertSubscriptionData(data: RssSubscriptionData, feed: RssSubscription): RssSubscriptionData {
  const next = structuredClone(data);
  const index = next.feeds.findIndex((entry) => entry.id === feed.id);
  if (index < 0) next.feeds.push(feed);
  else next.feeds[index] = mergeSubscription(next.feeds[index], feed);
  return next;
}

export function removeSubscriptionData(data: RssSubscriptionData, id: string): RssSubscriptionData {
  const next = structuredClone(data);
  next.feeds = next.feeds.filter((feed) => feed.id !== id);
  return next;
}

export function renameImportedNote(data: RssSubscriptionData, oldPath: string, newPath: string): RssSubscriptionData {
  const next = structuredClone(data);
  for (const [key, path] of Object.entries(next.imports)) {
    if (path === oldPath || path.startsWith(`${oldPath}/`)) {
      next.imports[key] = `${newPath}${path.slice(oldPath.length)}`;
    }
  }
  return next;
}

export function parseSubscriptionData(value: unknown): RssSubscriptionData {
  if (!value || typeof value !== "object") throw new Error("订阅数据格式无效，未覆盖原文件。");
  const data = value as Partial<RssSubscriptionData>;
  if (data.version !== 1 || !Array.isArray(data.feeds) || !data.imports ||
    typeof data.imports !== "object" || Array.isArray(data.imports)) {
    throw new Error("订阅数据版本或结构不受支持，未覆盖原文件。");
  }
  for (const feed of data.feeds) {
    if (!feed || typeof feed.id !== "string" || typeof feed.title !== "string" ||
      typeof feed.url !== "string" || !Array.isArray(feed.items) ||
      (feed.kind !== "podcast" && feed.kind !== "youtube")) {
      throw new Error("订阅数据包含无效订阅源，未覆盖原文件。");
    }
    try {
      if (feed.id !== feedId(canonicalFeedUrl(feed.url)) || feed.items.length > MAX_STORED_ITEMS) {
        throw new Error("invalid feed");
      }
    } catch {
      throw new Error("订阅数据包含无效订阅源，未覆盖原文件。");
    }
    for (const item of feed.items) {
      if (!item || item.kind !== feed.kind || typeof item.title !== "string" ||
        (item.publishedAt !== null && typeof item.publishedAt !== "string")) {
        throw new Error("订阅数据包含无效条目，未覆盖原文件。");
      }
      if (item.kind === "youtube") {
        if (!/^[A-Za-z0-9_-]{11}$/u.test(item.id) ||
          item.url !== `https://www.youtube.com/watch?v=${item.id}`) {
          throw new Error("订阅数据包含无效 YouTube 视频，未覆盖原文件。");
        }
      } else if (item.id !== item.sourceId || !/^podcast-[A-Za-z0-9_-]{22}$/u.test(item.id) ||
        typeof item.enclosureUrl !== "string" || !Array.isArray(item.transcripts)) {
        throw new Error("订阅数据包含无效播客节目，未覆盖原文件。");
      }
    }
  }
  for (const path of Object.values(data.imports)) {
    if (typeof path !== "string" || !path.endsWith(".md") || path.startsWith("/") ||
      path.split("/").includes("..")) {
      throw new Error("订阅数据包含无效笔记路径，未覆盖原文件。");
    }
  }
  return data as RssSubscriptionData;
}
