import { canonicalFeedUrl } from "./rss-subscription-core";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;

function youtubeUrl(value: string): URL | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname.toLowerCase())) return null;
  return url;
}

export function parseYouTubeChannelLink(value: string): { pageUrl: string; channelId: string | null } | null {
  const url = youtubeUrl(value);
  if (!url) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "channel" && segments.length >= 2 && CHANNEL_ID.test(segments[1])) {
    return { pageUrl: `https://www.youtube.com/channel/${segments[1]}`, channelId: segments[1] };
  }
  if (segments[0]?.startsWith("@") && segments[0].length > 1) {
    return { pageUrl: `https://www.youtube.com/${segments[0]}`, channelId: null };
  }
  if ((segments[0] === "c" || segments[0] === "user") && segments[1]) {
    return { pageUrl: `https://www.youtube.com/${segments[0]}/${segments[1]}`, channelId: null };
  }
  return null;
}

export function youtubeFeedUrl(channelId: string): string {
  if (!CHANNEL_ID.test(channelId)) throw new Error("YouTube 频道 ID 无效。");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

function htmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attrs[(match[1] ?? "").toLowerCase()] = (match[2] ?? match[3] ?? "").replace(/&amp;/gu, "&").replace(/&quot;/gu, '"');
  }
  return attrs;
}

/** Only publisher-declared link tags are trusted; page recommendations also contain channel IDs. */
export function parseYouTubeChannelPage(html: string): { feedUrl: string; title: string } {
  let feedUrl: string | null = null;
  let canonicalId: string | null = null;
  let title = "YouTube 频道";
  for (const match of html.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
    const tag = match[0];
    const attrs = htmlAttributes(tag);
    if (tag.toLowerCase().startsWith("<meta") && attrs.property === "og:title" && attrs.content) title = attrs.content.trim();
    if (!tag.toLowerCase().startsWith("<link")) continue;
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/u);
    if (rel.includes("alternate") && attrs.type?.toLowerCase() === "application/rss+xml" && attrs.href) {
      try {
        const candidate = canonicalFeedUrl(attrs.href);
        const parsed = new URL(candidate);
        const id = parsed.searchParams.get("channel_id");
        if (["youtube.com", "www.youtube.com"].includes(parsed.hostname.toLowerCase()) &&
          parsed.pathname === "/feeds/videos.xml" && id && CHANNEL_ID.test(id)) feedUrl = youtubeFeedUrl(id);
      } catch { /* Ignore malformed link tags, then check the canonical channel URL. */ }
    }
    if (rel.includes("canonical") && attrs.href) {
      const canonical = parseYouTubeChannelLink(attrs.href);
      if (canonical?.channelId) canonicalId = canonical.channelId;
    }
  }
  if (!feedUrl && canonicalId) feedUrl = youtubeFeedUrl(canonicalId);
  if (!feedUrl) throw new Error("频道页面没有提供可确认的 YouTube RSS 地址。");
  return { feedUrl, title };
}
