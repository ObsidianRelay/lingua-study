import { createHash } from "node:crypto";

export interface PodcastTranscriptReference {
  url: string;
  language: string | null;
  type: string | null;
}

export interface PodcastEpisode {
  sourceId: string;
  guid: string | null;
  title: string;
  publishedAt: string | null;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureBytes: number | null;
  transcripts: PodcastTranscriptReference[];
}

export interface PodcastFeed {
  title: string;
  sourceUrl: string;
  episodes: PodcastEpisode[];
}

const MAX_EPISODES = 500;

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (entity, value: string) => {
      const codePoint = value.toLowerCase().startsWith("x")
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/\s+/gu, " ")
    .trim();
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    const name = (match[1] ?? "").toLowerCase();
    const raw = match[2] ?? match[3] ?? "";
    result[name] = decodeXmlText(raw);
  }
  return result;
}

function tagText(source: string, names: readonly string[]): string | null {
  const alternatives = names.map((name) => name.replace(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&")).join("|");
  const match = new RegExp(`<(?:(?:[\\w-]+):)?(?:${alternatives})\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?(?:${alternatives})\\s*>`, "iu")
    .exec(source);
  const value = match?.[1] ? decodeXmlText(match[1]) : "";
  return value === "" ? null : value;
}

function absoluteHttpUrl(value: string | undefined, sourceUrl: string): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^[0-9]+$/u.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stableSourceId(feedUrl: string, guid: string | null, enclosureUrl: string): string {
  const identity = guid?.trim() || enclosureUrl;
  return `podcast-${createHash("sha256").update(`${feedUrl}\n${identity}`).digest("base64url").slice(0, 22)}`;
}

function findEpisodes(xml: string): Array<{ body: string; atom: boolean }> {
  const episodes: Array<{ body: string; atom: boolean }> = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/giu)) {
    if (match[1]) {
      episodes.push({ body: match[1], atom: false });
    }
  }
  if (episodes.length > 0) {
    return episodes;
  }
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/giu)) {
    if (match[1]) {
      episodes.push({ body: match[1], atom: true });
    }
  }
  return episodes;
}

function parseEpisode(
  body: string,
  atom: boolean,
  sourceUrl: string
): Omit<PodcastEpisode, "sourceId"> | null {
  const enclosureMatch = atom
    ? /<link\b([^>]*\brel\s*=\s*(?:"enclosure"|'enclosure')[^>]*)\/?\s*>/iu.exec(body)
    : /<enclosure\b([^>]*)\/?\s*>/iu.exec(body);
  const enclosure = attributes(enclosureMatch?.[1] ?? "");
  const enclosureUrl = absoluteHttpUrl(atom ? enclosure.href : enclosure.url, sourceUrl);
  if (!enclosureUrl) {
    return null;
  }
  const transcripts: PodcastTranscriptReference[] = [];
  for (const match of body.matchAll(/<(?:podcast:)?transcript\b([^>]*)\/?\s*>/giu)) {
    const reference = attributes(match[1] ?? "");
    const url = absoluteHttpUrl(reference.url ?? reference.href, sourceUrl);
    if (url) {
      transcripts.push({
        url,
        language: reference.language?.toLowerCase() ?? null,
        type: reference.type?.toLowerCase() ?? null
      });
    }
  }
  const title = tagText(body, ["title"]) ?? "未命名节目";
  return {
    guid: tagText(body, atom ? ["id"] : ["guid", "id"]),
    title,
    publishedAt: tagText(body, atom ? ["published", "updated"] : ["pubDate", "date", "published"]),
    enclosureUrl,
    enclosureType: enclosure.type?.toLowerCase() ?? null,
    enclosureBytes: positiveInteger(enclosure.length),
    transcripts
  };
}

/** 解析公开 RSS 2.0 或 Atom 播客源；只保留可访问的 HTTP(S) 音频 enclosure。 */
export function parsePodcastFeed(xml: string, sourceUrl: string): PodcastFeed {
  const canonicalSourceUrl = absoluteHttpUrl(sourceUrl, sourceUrl);
  if (!canonicalSourceUrl || xml.length === 0) {
    throw new Error("播客 RSS 地址或响应内容无效。");
  }
  const rawEpisodes = findEpisodes(xml);
  const episodes: PodcastEpisode[] = [];
  const seen = new Set<string>();
  for (const raw of rawEpisodes) {
    const parsed = parseEpisode(raw.body, raw.atom, canonicalSourceUrl);
    if (!parsed) {
      continue;
    }
    const sourceId = stableSourceId(canonicalSourceUrl, parsed.guid, parsed.enclosureUrl);
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    episodes.push({ ...parsed, sourceId });
    if (episodes.length >= MAX_EPISODES) {
      break;
    }
  }
  if (episodes.length === 0) {
    throw new Error("播客源中没有可播放的音频节目。请确认它包含 enclosure 或 Atom enclosure link。");
  }
  const channel = /<channel\b[^>]*>([\s\S]*?)<\/channel\s*>/iu.exec(xml)?.[1] ?? xml;
  return {
    title: tagText(channel, ["title"]) ?? "未命名播客",
    sourceUrl: canonicalSourceUrl,
    episodes
  };
}

/** 只接受发布者明确标记为英文的 Podcasting 2.0 transcript。 */
export function selectEnglishPodcastTranscript(
  references: readonly PodcastTranscriptReference[]
): PodcastTranscriptReference | null {
  return references.find((reference) =>
    reference.language === "en" || reference.language?.startsWith("en-") === true
  ) ?? null;
}
