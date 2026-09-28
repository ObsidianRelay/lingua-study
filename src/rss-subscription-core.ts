import { createHash, randomUUID } from "node:crypto";
import { decodeXmlText, MAX_FEED_DESCRIPTION_LENGTH, parsePodcastFeed, plainFeedDescription, type PodcastEpisode } from "./podcast-rss-core";

export type SubscriptionKind = "podcast" | "youtube";
export type SubscriptionSourceKind = SubscriptionKind | "__all";
export const SUBSCRIPTION_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type SubscriptionColor = typeof SUBSCRIPTION_COLORS[number];

export interface SubscriptionCategory {
  id: string;
  name: string;
  color: SubscriptionColor;
}

export type SubscriptionItem =
  | (PodcastEpisode & { kind: "podcast"; id: string })
  | { kind: "youtube"; id: string; title: string; description?: string; publishedAt: string | null; url: string };

export interface RssSubscription {
  id: string;
  kind: SubscriptionKind;
  url: string;
  title: string;
  items: SubscriptionItem[];
  categoryId: string | null;
  status: "ready" | "pending";
}

export interface RssSubscriptionData {
  version: 2;
  feeds: RssSubscription[];
  imports: Record<string, string>;
  categories: SubscriptionCategory[];
}

/** Filter source folders without changing the saved subscriptions or their labels. */
export function selectSubscriptionSources(
  feeds: readonly RssSubscription[], kind: SubscriptionSourceKind, categoryId = "__all", feedId = "__all"
): RssSubscription[] {
  return feeds.filter((feed) =>
    (kind === "__all" || feed.kind === kind) &&
    (categoryId === "__all" || (feed.categoryId ?? "") === categoryId) &&
    (feedId === "__all" || feed.id === feedId));
}

export type CategoryChoice = { existingId: string | null } | { name: string; color: SubscriptionColor };

const MAX_STORED_ITEMS = 200;

export function emptySubscriptionData(): RssSubscriptionData {
  return { version: 2, feeds: [], imports: {}, categories: [] };
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
    const description = plainFeedDescription(xmlTagText(body, "media:description"));
    items.push({
      kind: "youtube",
      id: videoId,
      title: xmlTagText(body, "title") ?? "未命名视频",
      ...(description ? { description } : {}),
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
    items, categoryId: null, status: "ready"
  };
}

export function youtubeThumbnailUrl(videoId: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/u.test(videoId)
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;
}

export function pendingYouTubeSubscription(urlInput: string, title: string): RssSubscription {
  const url = canonicalFeedUrl(urlInput);
  if (!isYouTubeFeed(url) || !/^UC[A-Za-z0-9_-]{22}$/u.test(new URL(url).searchParams.get("channel_id") ?? "")) {
    throw new Error("待刷新订阅必须是可确认的 YouTube 频道。");
  }
  return { id: feedId(url), kind: "youtube", url, title: title.trim() || "YouTube 频道", items: [], categoryId: null, status: "pending" };
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
    categoryId: null, status: "ready",
    items: feed.episodes.slice(0, MAX_STORED_ITEMS).map((episode) => ({
      ...episode, kind: "podcast" as const, id: episode.sourceId
    }))
  };
}

export function mergeSubscription(previous: RssSubscription | undefined, next: RssSubscription): RssSubscription {
  if (!previous) return next;
  const previousItems = new Map(previous.items.map((item) => [subscriptionItemKey(item), item]));
  const seen = new Set<string>();
  const incoming = next.items.map((item) => {
    const older = previousItems.get(subscriptionItemKey(item));
    return !item.description && older?.description ? { ...item, description: older.description } : item;
  });
  const items = [...incoming, ...previous.items].filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_STORED_ITEMS);
  return { ...next, categoryId: previous.categoryId, status: next.status === "pending" && previous.items.length > 0 ? "ready" : next.status, items };
}

export function addSubscriptionCategory(data: RssSubscriptionData, nameInput: string, color: SubscriptionColor): RssSubscriptionData {
  const name = nameInput.trim();
  if (!name || name.length > 40 || !SUBSCRIPTION_COLORS.includes(color) ||
    data.categories.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("分类名称须为 1–40 个字符，且不能与已有分类重名。");
  }
  return { ...data, categories: [...data.categories, { id: randomUUID(), name, color }] };
}

export function updateSubscriptionCategory(data: RssSubscriptionData, id: string, nameInput: string, color: SubscriptionColor): RssSubscriptionData {
  if (!data.categories.some((category) => category.id === id)) throw new Error("找不到此分类。");
  const updated = addSubscriptionCategory({ ...data, categories: data.categories.filter((category) => category.id !== id) }, nameInput, color);
  const replacement = updated.categories[updated.categories.length - 1];
  return { ...data, categories: data.categories.map((category) => category.id === id ? { ...replacement, id } : category) };
}

export function removeSubscriptionCategory(data: RssSubscriptionData, id: string): RssSubscriptionData {
  if (!data.categories.some((category) => category.id === id)) throw new Error("找不到此分类。");
  return { ...data, categories: data.categories.filter((category) => category.id !== id),
    feeds: data.feeds.map((feed) => feed.categoryId === id ? { ...feed, categoryId: null } : feed) };
}

export function assignSubscriptionCategory(data: RssSubscriptionData, feedIdValue: string, categoryId: string | null): RssSubscriptionData {
  if (categoryId !== null && !data.categories.some((category) => category.id === categoryId)) throw new Error("找不到此分类。");
  if (!data.feeds.some((feed) => feed.id === feedIdValue)) throw new Error("找不到此订阅源。");
  return { ...data, feeds: data.feeds.map((feed) => feed.id === feedIdValue ? { ...feed, categoryId } : feed) };
}

export function addNewSubscriptionData(data: RssSubscriptionData, feed: RssSubscription, category: CategoryChoice): RssSubscriptionData {
  if (data.feeds.some((entry) => entry.id === feed.id)) throw new Error("这个订阅源已经添加；请在现有订阅中调整分类。");
  let next = data;
  let categoryId: string | null;
  if ("existingId" in category) {
    categoryId = category.existingId;
    if (categoryId !== null && !data.categories.some((entry) => entry.id === categoryId)) throw new Error("所选分类已不存在。");
  } else {
    next = addSubscriptionCategory(data, category.name, category.color);
    categoryId = next.categories[next.categories.length - 1].id;
  }
  return upsertSubscriptionData(next, { ...feed, categoryId });
}

export function subscriptionItemKey(item: SubscriptionItem): string {
  return `${item.kind}:${item.id}`;
}

export function countNewSubscriptionItems(previous: RssSubscription, current: RssSubscription): number {
  const previousKeys = new Set(previous.items.map(subscriptionItemKey));
  return current.items.filter((item) => !previousKeys.has(subscriptionItemKey(item))).length;
}

function subscriptionItemTime(item: SubscriptionItem | undefined): number {
  return Date.parse(item?.publishedAt ?? "") || 0;
}

/** Build a small, non-mutating preview for each source; full lists stay in the feed data. */
export function buildSubscriptionOverview(feeds: readonly RssSubscription[], previewSize: number):
  { feed: RssSubscription; items: SubscriptionItem[] }[] {
  return feeds.map((feed) => ({
    feed,
    items: [...feed.items].sort((a, b) => subscriptionItemTime(b) - subscriptionItemTime(a)).slice(0, previewSize)
  })).sort((a, b) => subscriptionItemTime(b.items[0]) - subscriptionItemTime(a.items[0]));
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
  const data = value as { version?: number; feeds?: RssSubscription[]; imports?: Record<string, string>; categories?: SubscriptionCategory[] };
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.feeds) || !data.imports ||
    typeof data.imports !== "object" || Array.isArray(data.imports)) {
    throw new Error("订阅数据版本或结构不受支持，未覆盖原文件。");
  }
  if (data.version === 2 && !Array.isArray(data.categories)) {
    throw new Error("订阅数据版本或结构不受支持，未覆盖原文件。");
  }
  const categories = data.version === 2 ? data.categories! : [];
  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  for (const category of categories) {
    if (!category || typeof category.id !== "string" || !category.id ||
      typeof category.name !== "string" || !category.name.trim() || category.name.length > 40 ||
      !SUBSCRIPTION_COLORS.includes(category.color) || categoryIds.has(category.id) ||
      categoryNames.has(category.name.toLocaleLowerCase())) {
      throw new Error("订阅数据包含无效分类，未覆盖原文件。");
    }
    categoryIds.add(category.id);
    categoryNames.add(category.name.toLocaleLowerCase());
  }
  for (const feed of data.feeds) {
    if (!feed || typeof feed.id !== "string" || typeof feed.title !== "string" ||
      typeof feed.url !== "string" || !Array.isArray(feed.items) ||
      (feed.kind !== "podcast" && feed.kind !== "youtube") ||
      (data.version === 2 && ((feed.categoryId !== null && !categoryIds.has(feed.categoryId)) ||
        (feed.status !== "ready" && feed.status !== "pending")))) {
      throw new Error("订阅数据包含无效订阅源，未覆盖原文件。");
    }
    try {
      if (feed.id !== feedId(canonicalFeedUrl(feed.url)) || feed.items.length > MAX_STORED_ITEMS) {
        throw new Error("invalid feed");
      }
    } catch {
      throw new Error("订阅数据包含无效订阅源，未覆盖原文件。");
    }
    if (data.version === 2 && feed.status === "pending" && (feed.kind !== "youtube" || feed.items.length !== 0)) {
      throw new Error("订阅数据包含无效待刷新频道，未覆盖原文件。");
    }
    for (const item of feed.items) {
      if (!item || item.kind !== feed.kind || typeof item.title !== "string" ||
        (item.publishedAt !== null && typeof item.publishedAt !== "string") ||
        (item.description !== undefined && (typeof item.description !== "string" || item.description.length > MAX_FEED_DESCRIPTION_LENGTH))) {
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
  return { version: 2, feeds: data.feeds.map((feed) => ({ ...feed,
    categoryId: data.version === 1 ? null : feed.categoryId,
    status: data.version === 1 ? "ready" as const : feed.status
  })), imports: data.imports, categories };
}
