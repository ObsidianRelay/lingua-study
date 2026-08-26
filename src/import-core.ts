import type { TranscriptSegment } from "./transcript-core";

export const DEFAULT_TRANSCRIPT_FOLDER = "Lingua Study/Transcripts";

export interface YouTubeLink {
  videoId: string;
  canonicalUrl: string;
  originalUrl: string;
}

export interface BilibiliVideoLink {
  kind: "video";
  idType: "bvid" | "aid";
  videoId: string;
  page: number;
  canonicalUrl: string;
  originalUrl: string;
}

export interface BilibiliShortLink {
  kind: "short";
  shortUrl: string;
  originalUrl: string;
}

export type BilibiliLink = BilibiliVideoLink | BilibiliShortLink;

export type PastedVideoLink =
  | { platform: "youtube"; link: YouTubeLink }
  | { platform: "bilibili"; link: BilibiliLink };

export interface CaptionTrackDescriptor {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  vssId?: string;
}

export interface InnerTubeConfig {
  apiKey: string;
  clientVersion: string;
}

export interface RawTranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export type YouTubeImportErrorCode =
  | "no-captions"
  | "no-english-captions"
  | "login-required"
  | "private-or-unavailable"
  | "rate-limited"
  | "network"
  | "invalid-response";

export interface YouTubeImportFailure {
  code: YouTubeImportErrorCode;
  message: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);
const SHORT_YOUTUBE_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const BILIBILI_HOSTS = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com"
]);
const SHORT_BILIBILI_HOSTS = new Set(["b23.tv", "www.b23.tv"]);
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const BILIBILI_BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/u;
const BILIBILI_AID_PATTERN = /^av([1-9][0-9]*)$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[\])},.!?;:]+$/u, "");
}

export function parseYouTubeLink(value: string): YouTubeLink | null {
  let candidate = trimUrlPunctuation(value.trim().replace(/^<|>$/gu, ""));
  if (candidate.startsWith("www.")) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  let videoId: string | null = null;

  if (SHORT_YOUTUBE_HOSTS.has(hostname)) {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else {
      const path = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live", "v"].includes(path[0] ?? "")) {
        videoId = path[1] ?? null;
      }
    }
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    originalUrl: candidate
  };
}

export function extractYouTubeLinks(text: string): YouTubeLink[] {
  const links: YouTubeLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    const link = parseYouTubeLink(match[0]);
    if (link && !seen.has(link.videoId)) {
      seen.add(link.videoId);
      links.push(link);
    }
  }

  return links;
}

/** 返回第一个包含 YouTube 链接的范围，用于保证“选区→当前行→全文”的固定优先级。 */
export function findYouTubeLinksByPriority(
  selection: string,
  cursorLine: string,
  fullNote: string
): YouTubeLink[] {
  for (const scope of [selection, cursorLine, fullNote]) {
    const links = extractYouTubeLinks(scope);
    if (links.length > 0) {
      return links;
    }
  }
  return [];
}

function parsePositivePage(value: string | null): number {
  if (!value || !/^[0-9]+$/u.test(value)) {
    return 1;
  }
  const page = Number.parseInt(value, 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** 仅接受 B站正式视频域名和官方 b23.tv 分享短链。 */
export function parseBilibiliLink(value: string): BilibiliLink | null {
  let candidate = trimUrlPunctuation(value.trim().replace(/^<|>$/gu, ""));
  if (candidate.startsWith("www.")) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (SHORT_BILIBILI_HOSTS.has(hostname)) {
    const path = parsed.pathname.split("/").filter(Boolean);
    if (path.length !== 1 || !/^[0-9A-Za-z_-]+$/u.test(path[0] ?? "")) {
      return null;
    }
    const shortUrl = `https://b23.tv/${path[0]}`;
    return { kind: "short", shortUrl, originalUrl: candidate };
  }

  if (!BILIBILI_HOSTS.has(hostname)) {
    return null;
  }

  const path = parsed.pathname.split("/").filter(Boolean);
  if (path[0]?.toLowerCase() !== "video" || path.length < 2) {
    return null;
  }

  const rawVideoId = path[1] ?? "";
  const page = parsePositivePage(parsed.searchParams.get("p"));
  if (BILIBILI_BVID_PATTERN.test(rawVideoId)) {
    return {
      kind: "video",
      idType: "bvid",
      videoId: rawVideoId,
      page,
      canonicalUrl: `https://www.bilibili.com/video/${rawVideoId}${page > 1 ? `?p=${page}` : ""}`,
      originalUrl: candidate
    };
  }

  const aidMatch = BILIBILI_AID_PATTERN.exec(rawVideoId);
  if (!aidMatch?.[1]) {
    return null;
  }
  const videoId = `av${aidMatch[1]}`;
  return {
    kind: "video",
    idType: "aid",
    videoId,
    page,
    canonicalUrl: `https://www.bilibili.com/video/${videoId}${page > 1 ? `?p=${page}` : ""}`,
    originalUrl: candidate
  };
}

export function extractBilibiliLinks(text: string): BilibiliLink[] {
  const links: BilibiliLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    const link = parseBilibiliLink(match[0]);
    if (!link) {
      continue;
    }
    const key = link.kind === "short"
      ? link.shortUrl
      : `${link.idType}:${link.videoId}:p${link.page}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push(link);
    }
  }

  return links;
}

/**
 * 按正文中的真实出现顺序提取插件支持的视频链接。
 * 同一个视频只返回一次，供左侧 Logo 的手动导入入口使用。
 */
export function extractSupportedVideoLinks(text: string): PastedVideoLink[] {
  const links: PastedVideoLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0];
    const youtube = parseYouTubeLink(candidate);
    if (youtube) {
      const key = `youtube:${youtube.videoId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ platform: "youtube", link: youtube });
      }
      continue;
    }

    const bilibili = parseBilibiliLink(candidate);
    if (!bilibili) {
      continue;
    }
    const key = bilibili.kind === "short"
      ? `bilibili:short:${bilibili.shortUrl}`
      : `bilibili:${bilibili.idType}:${bilibili.videoId}:p${bilibili.page}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ platform: "bilibili", link: bilibili });
    }
  }

  return links;
}

/** 依次检查选区、光标所在行和全文，避免全文中的旧链接抢占用户当前操作。 */
export function findSupportedVideoLinksByPriority(
  selection: string,
  cursorLine: string,
  fullNote: string
): PastedVideoLink[] {
  for (const scope of [selection, cursorLine, fullNote]) {
    const links = extractSupportedVideoLinks(scope);
    if (links.length > 0) {
      return links;
    }
  }
  return [];
}

/**
 * 只识别“本次粘贴内容就是一个视频链接”的情况。
 * 不从普通段落或包含多个链接的文本中抽取，避免用户整理资料时意外开始下载。
 */
export function parseStandalonePastedVideoLink(text: string): PastedVideoLink | null {
  const candidate = text.trim();
  if (
    candidate === "" ||
    /[\r\n]/u.test(candidate) ||
    !/^<?(?:https?:\/\/|www\.)[^\s<>]+>?$/iu.test(candidate)
  ) {
    return null;
  }

  const youtube = parseYouTubeLink(candidate);
  if (youtube) {
    return { platform: "youtube", link: youtube };
  }
  const bilibili = parseBilibiliLink(candidate);
  return bilibili ? { platform: "bilibili", link: bilibili } : null;
}

/**
 * 从一行 Markdown 中移除匹配的视频链接。
 * 同时支持裸链接、<自动链接> 和 [说明文字](链接)，不会删除同一行的其他文字。
 */
export function removeMatchingVideoLinkFromLine(
  line: string,
  matches: (url: string) => boolean
): { line: string; removed: boolean } {
  let removed = false;
  let next = line.replace(
    /\[[^\]\n]*\]\((<?(?:https?:\/\/|www\.)[^\s<>)]*>?)\)/giu,
    (full, url: string) => {
      if (!matches(url.replace(/^<|>$/gu, ""))) {
        return full;
      }
      removed = true;
      return "";
    }
  );
  next = next.replace(/<((?:https?:\/\/|www\.)[^\s<>]+)>/giu, (full, url: string) => {
    if (!matches(url)) {
      return full;
    }
    removed = true;
    return "";
  });
  next = next.replace(URL_PATTERN, (url) => {
    if (!matches(url)) {
      return url;
    }
    removed = true;
    return "";
  });

  return {
    line: removed ? next.replace(/[ \t]+$/u, "") : line,
    removed
  };
}

/** 返回第一个包含 B站链接的范围，顺序与 YouTube 一键导入保持一致。 */
export function findBilibiliLinksByPriority(
  selection: string,
  cursorLine: string,
  fullNote: string
): BilibiliLink[] {
  for (const scope of [selection, cursorLine, fullNote]) {
    const links = extractBilibiliLinks(scope);
    if (links.length > 0) {
      return links;
    }
  }
  return [];
}

export function sanitizeTranscriptFolder(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_TRANSCRIPT_FOLDER;
  }

  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.includes("\0"))
  ) {
    return DEFAULT_TRANSCRIPT_FOLDER;
  }

  return parts.join("/");
}

/** 从包含 JavaScript 字符串的页面中安全提取一个 JSON 对象，不执行页面代码。 */
export function extractBalancedJsonObject(source: string, objectStart: number): string | null {
  if (source[objectStart] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

export function extractInitialPlayerResponse(html: string): unknown {
  const markers = [
    "ytInitialPlayerResponse =",
    "var ytInitialPlayerResponse =",
    "\"ytInitialPlayerResponse\":"
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }
    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) {
      continue;
    }
    const json = extractBalancedJsonObject(html, objectStart);
    if (!json) {
      continue;
    }
    try {
      return JSON.parse(json) as unknown;
    } catch {
      // 页面可能包含多个同名片段，继续尝试下一种标记。
    }
  }

  return null;
}

function extractConfigValue(html: string, key: string): string | null {
  const pattern = new RegExp(`(?:"|&quot;)${key}(?:"|&quot;)\\s*:\\s*(?:"|&quot;)([^"&]+)`, "u");
  return pattern.exec(html)?.[1] ?? null;
}

export function extractInnerTubeConfig(html: string): InnerTubeConfig | null {
  const apiKey = extractConfigValue(html, "INNERTUBE_API_KEY");
  const clientVersion = extractConfigValue(html, "INNERTUBE_CONTEXT_CLIENT_VERSION");
  if (!apiKey || !clientVersion || !/^[A-Za-z0-9_-]+$/u.test(apiKey)) {
    return null;
  }
  return { apiKey, clientVersion };
}

export function getCaptionTracks(playerResponse: unknown): CaptionTrackDescriptor[] {
  if (!isRecord(playerResponse)) {
    return [];
  }

  const captions = playerResponse.captions;
  if (!isRecord(captions)) {
    return [];
  }
  const renderer = captions.playerCaptionsTracklistRenderer;
  if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) {
    return [];
  }

  const tracks: CaptionTrackDescriptor[] = [];
  for (const value of renderer.captionTracks) {
    if (!isRecord(value) || typeof value.baseUrl !== "string" || typeof value.languageCode !== "string") {
      continue;
    }
    tracks.push({
      baseUrl: value.baseUrl,
      languageCode: value.languageCode,
      kind: typeof value.kind === "string" ? value.kind : undefined,
      vssId: typeof value.vssId === "string" ? value.vssId : undefined
    });
  }
  return tracks;
}

export function selectEnglishCaptionTrack(
  tracks: CaptionTrackDescriptor[]
): CaptionTrackDescriptor | null {
  const english = tracks.filter((track) => {
    const language = track.languageCode.toLowerCase();
    return language === "en" || language.startsWith("en-");
  });
  const isAutomatic = (track: CaptionTrackDescriptor): boolean =>
    track.kind === "asr" || track.vssId?.startsWith("a.") === true;

  return english.find((track) => !isAutomatic(track)) ?? english.find(isAutomatic) ?? null;
}

export function getPlayerMetadata(playerResponse: unknown): {
  title: string | null;
  status: string | null;
  reason: string | null;
} {
  if (!isRecord(playerResponse)) {
    return { title: null, status: null, reason: null };
  }

  const details = isRecord(playerResponse.videoDetails) ? playerResponse.videoDetails : null;
  const playability = isRecord(playerResponse.playabilityStatus)
    ? playerResponse.playabilityStatus
    : null;
  return {
    title: details && typeof details.title === "string" ? details.title : null,
    status: playability && typeof playability.status === "string" ? playability.status : null,
    reason: playability && typeof playability.reason === "string" ? playability.reason : null
  };
}

export function mapPlayerFailure(playerResponse: unknown): YouTubeImportFailure | null {
  const metadata = getPlayerMetadata(playerResponse);
  if (!metadata.status || metadata.status === "OK") {
    return null;
  }

  const reason = metadata.reason ? `（${metadata.reason}）` : "";
  if (metadata.status === "LOGIN_REQUIRED") {
    return {
      code: "login-required",
      message: `YouTube 要求登录或进行反机器人验证，无法读取公开字幕${reason}。`
    };
  }
  if (metadata.status === "UNPLAYABLE" || metadata.status === "ERROR") {
    return {
      code: "private-or-unavailable",
      message: `视频不可播放，可能是私密、地区限制或发布者限制${reason}。`
    };
  }
  return {
    code: "invalid-response",
    message: `YouTube 返回了无法处理的视频状态：${metadata.status}${reason}。`
  };
}

export function mapHttpFailure(status: number): YouTubeImportFailure | null {
  if (status === 429) {
    return {
      code: "rate-limited",
      message: "YouTube 暂时限制了字幕请求（HTTP 429），请稍后再试。"
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: "login-required",
      message: "YouTube 拒绝了字幕请求，可能需要登录或触发了反机器人验证。"
    };
  }
  if (status < 200 || status >= 300) {
    return {
      code: "network",
      message: `YouTube 请求失败（HTTP ${status}）。`
    };
  }
  return null;
}

function decodeEntity(entity: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  const lower = entity.toLowerCase();
  if (lower in named) {
    return named[lower] ?? "";
  }
  if (lower.startsWith("#x")) {
    const code = Number.parseInt(lower.slice(2), 16);
    return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF
      ? String.fromCodePoint(code)
      : `&${entity};`;
  }
  if (lower.startsWith("#")) {
    const code = Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF
      ? String.fromCodePoint(code)
      : `&${entity};`;
  }
  return `&${entity};`;
}

export function cleanSubtitleText(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&([^;\s]+);/gu, (_match, entity: string) => decodeEntity(entity))
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const SENTENCE_GROUP_MAX_GAP_SECONDS = 1.5;
const SENTENCE_GROUP_MAX_DURATION_SECONDS = 20;
const SENTENCE_GROUP_MAX_WORDS = 45;
const NON_TERMINAL_ABBREVIATION_PATTERN = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e|u\.s|u\.k)\.$/iu;

function wordCount(value: string): number {
  const normalized = value.trim();
  return normalized === "" ? 0 : normalized.split(/\s+/u).length;
}

function endsCompleteSentence(value: string): boolean {
  const normalized = value.trim().replace(/["'”’)\]]+$/u, "");
  if (/[!?]$/u.test(normalized)) {
    return true;
  }
  if (!normalized.endsWith(".")) {
    return false;
  }
  const lastToken = normalized.split(/\s+/u).at(-1) ?? "";
  return !NON_TERMINAL_ABBREVIATION_PATTERN.test(lastToken) && !/^[A-Z]\.$/u.test(lastToken);
}

function joinSubtitleParts(parts: readonly string[]): string {
  return cleanSubtitleText(parts.join(" "))
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([[(])\s+/gu, "$1");
}

function createSentenceGroup(segments: readonly TranscriptSegment[]): TranscriptSegment {
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) {
    throw new Error("无法从空字幕片段创建完整句子。");
  }
  const text = joinSubtitleParts(segments.map((segment) => segment.text));
  const hasOriginalText = segments.some((segment) => segment.originalText !== undefined);
  const originalText = hasOriginalText
    ? joinSubtitleParts(segments.map((segment) => segment.originalText ?? segment.text))
    : undefined;
  return {
    start: first.start,
    end: last.end,
    text,
    ...(originalText && originalText !== text ? { originalText } : {})
  };
}

/**
 * 将平台提供的短字幕片段合并成适合学习的完整句子。
 *
 * 只在已有片段边界上合并，不拆分单个片段或估算新的时间戳。
 * 句末标点优先；长停顿及缺少标点的超长内容作为安全兜底边界。
 */
export function groupTranscriptSegmentsIntoSentences(
  segments: readonly TranscriptSegment[]
): TranscriptSegment[] {
  const grouped: TranscriptSegment[] = [];
  let pending: TranscriptSegment[] = [];
  let pendingWords = 0;

  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }
    grouped.push(createSentenceGroup(pending));
    pending = [];
    pendingWords = 0;
  };

  for (const segment of segments) {
    const previous = pending.at(-1);
    const first = pending[0];
    const nextWords = wordCount(segment.text);
    const gap = previous ? segment.start - previous.end : 0;
    const candidateDuration = first ? segment.end - first.start : segment.end - segment.start;
    const exceedsFallbackLimit = pending.length > 0 && (
      candidateDuration > SENTENCE_GROUP_MAX_DURATION_SECONDS ||
      pendingWords + nextWords > SENTENCE_GROUP_MAX_WORDS
    );

    if (gap > SENTENCE_GROUP_MAX_GAP_SECONDS || exceedsFallbackLimit) {
      flush();
    }

    pending.push({ ...segment });
    pendingWords += nextWords;
    if (endsCompleteSentence(segment.text)) {
      flush();
    }
  }

  flush();
  return grouped;
}

export function normalizeTranscriptSegments(raw: RawTranscriptSegment[]): TranscriptSegment[] {
  const prepared = raw
    .filter((segment) => Number.isFinite(segment.start) && segment.start >= 0)
    .map((segment) => ({
      start: roundMilliseconds(segment.start),
      duration: Number.isFinite(segment.duration) && segment.duration > 0
        ? roundMilliseconds(segment.duration)
        : 0,
      text: cleanSubtitleText(segment.text)
    }))
    .filter((segment) => segment.text !== "")
    .sort((left, right) => left.start - right.start);

  const merged: RawTranscriptSegment[] = [];
  for (const segment of prepared) {
    const previous = merged.at(-1);
    if (previous && previous.start === segment.start) {
      if (!previous.text.includes(segment.text)) {
        previous.text = `${previous.text} ${segment.text}`;
      }
      previous.duration = Math.max(previous.duration, segment.duration);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged.map((segment, index) => {
    const nextStart = merged[index + 1]?.start;
    let end = segment.start + (segment.duration > 0 ? segment.duration : 2);
    if (nextStart !== undefined && nextStart > segment.start) {
      end = Math.min(end, nextStart);
    }
    if (end <= segment.start) {
      end = segment.start + 0.001;
    }
    return {
      start: segment.start,
      end: roundMilliseconds(end),
      text: segment.text
    };
  });
}

export function parseJson3Captions(text: string): TranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("YouTube 返回的 JSON 字幕格式无法解析。");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    throw new Error("YouTube 返回的字幕缺少 events 数据。");
  }

  const raw: RawTranscriptSegment[] = [];
  for (const event of parsed.events) {
    if (!isRecord(event) || !Array.isArray(event.segs)) {
      continue;
    }
    const textParts = event.segs
      .filter(isRecord)
      .map((segment) => typeof segment.utf8 === "string" ? segment.utf8 : "");
    const startMs = typeof event.tStartMs === "number" ? event.tStartMs : 0;
    const durationMs = typeof event.dDurationMs === "number" ? event.dDurationMs : 0;
    raw.push({ start: startMs / 1000, duration: durationMs / 1000, text: textParts.join("") });
  }

  const segments = normalizeTranscriptSegments(raw);
  if (segments.length === 0) {
    throw new Error("YouTube 返回的字幕内容为空。");
  }
  return segments;
}

function readXmlAttribute(attributes: string, name: string): number | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]+)"`, "u").exec(attributes);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(value) ? value : null;
}

export function parseTimedTextXml(text: string): TranscriptSegment[] {
  const raw: RawTranscriptSegment[] = [];
  const elementPattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gu;
  for (const match of text.matchAll(elementPattern)) {
    const tag = match[1];
    const attributes = match[2] ?? "";
    const content = match[3] ?? "";
    const start = readXmlAttribute(attributes, tag === "p" ? "t" : "start");
    const duration = readXmlAttribute(attributes, tag === "p" ? "d" : "dur");
    if (start === null) {
      continue;
    }
    raw.push({
      start: tag === "p" ? start / 1000 : start,
      duration: duration === null ? 0 : tag === "p" ? duration / 1000 : duration,
      text: content
    });
  }

  const segments = normalizeTranscriptSegments(raw);
  if (segments.length === 0) {
    throw new Error("YouTube 返回的 XML 字幕内容为空。");
  }
  return segments;
}

function parseSubtitleTimestamp(value: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  const milliseconds = Number.parseInt(match[4] ?? "0", 10);
  if (minutes > 59 || seconds > 59) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function parseSubtitleFile(text: string): TranscriptSegment[] {
  const normalized = text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/^WEBVTT[^\n]*\n?/iu, "")
    .trim();
  const raw: RawTranscriptSegment[] = [];

  for (const block of normalized.split(/\n{2,}/u)) {
    const lines = block.split("\n").map((line) => line.trim());
    if (lines.length === 0 || /^(WEBVTT|NOTE|STYLE|REGION)\b/iu.test(lines[0] ?? "")) {
      continue;
    }
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }
    const timing = /^([^\s]+)\s+-->\s+([^\s]+)/u.exec(lines[timingIndex] ?? "");
    if (!timing) {
      continue;
    }
    const start = parseSubtitleTimestamp(timing[1] ?? "");
    const end = parseSubtitleTimestamp(timing[2] ?? "");
    if (start === null || end === null || end <= start) {
      continue;
    }
    raw.push({
      start,
      duration: end - start,
      text: lines.slice(timingIndex + 1).join(" ")
    });
  }

  const segments = normalizeTranscriptSegments(raw);
  if (segments.length === 0) {
    throw new Error("没有识别到有效的 SRT 或 VTT 时间轴字幕。");
  }
  return segments;
}

export function buildStudyBlock(transcriptPath: string): string {
  return `\`\`\`lingua-study\ntranscript: ${transcriptPath}\n\`\`\``;
}

export function buildBilibiliStudyBlock(
  link: BilibiliVideoLink,
  transcriptPath?: string
): string {
  const idLine = link.idType === "bvid"
    ? `bvid: ${link.videoId}`
    : `aid: ${link.videoId.slice(2)}`;
  const transcriptLine = transcriptPath ? `\ntranscript: ${transcriptPath}` : "";
  return `\`\`\`lingua-study\nplatform: bilibili\n${idLine}\npage: ${link.page}${transcriptLine}\n\`\`\``;
}

export function addTranscriptToBilibiliStudyBlock(
  markdown: string,
  link: BilibiliVideoLink,
  transcriptPath: string
): string | null {
  const blockPattern = /```(?:lingua-study|english-video-study)\s*\n([\s\S]*?)```/gu;
  for (const block of markdown.matchAll(blockPattern)) {
    const body = block[1] ?? "";
    if (!/^\s*platform\s*:\s*bilibili\s*$/imu.test(body)) {
      continue;
    }
    const bvid = /^\s*bvid\s*:\s*(BV[0-9A-Za-z]{10})\s*$/imu.exec(body)?.[1];
    const aid = /^\s*aid\s*:\s*([1-9][0-9]*)\s*$/imu.exec(body)?.[1];
    const page = parsePositivePage(/^\s*page\s*:\s*([0-9]+)\s*$/imu.exec(body)?.[1] ?? null);
    const sameIdentity = link.idType === "bvid"
      ? bvid === link.videoId && page === link.page
      : aid === link.videoId.slice(2) && page === link.page;
    if (!sameIdentity || block.index === undefined) {
      continue;
    }

    const transcriptPattern = /^\s*transcript\s*:[^\n]*$/imu;
    const nextBody = transcriptPattern.test(body)
      ? body.replace(transcriptPattern, `transcript: ${transcriptPath}`)
      : `${body.trimEnd()}\ntranscript: ${transcriptPath}\n`;
    const originalBlock = block[0];
    const nextBlock = originalBlock.replace(body, nextBody);
    return `${markdown.slice(0, block.index)}${nextBlock}${markdown.slice(block.index + originalBlock.length)}`;
  }
  return null;
}

/** 清理代码块外与播放器完全匹配的可见 B站链接，保留同一行的其他文字。 */
export function removeVisibleBilibiliLinksFromMarkdown(
  markdown: string,
  link: Pick<BilibiliVideoLink, "idType" | "videoId" | "page">
): { markdown: string; removed: number } {
  const lines = markdown.split("\n");
  let fence: { character: "`" | "~"; length: number } | null = null;
  let removed = 0;
  const nextLines = lines.map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
    if (fenceMatch) {
      const character = fenceMatch[0] as "`" | "~";
      if (fence === null) {
        fence = { character, length: fenceMatch.length };
      } else if (fence.character === character && fenceMatch.length >= fence.length) {
        fence = null;
      }
      return line;
    }
    if (fence !== null) {
      return line;
    }
    const result = removeMatchingVideoLinkFromLine(line, (url) => {
      const candidate = parseBilibiliLink(url);
      return candidate?.kind === "video" &&
        candidate.idType === link.idType &&
        candidate.videoId === link.videoId &&
        candidate.page === link.page;
    });
    if (result.removed) {
      removed += 1;
    }
    return result.line;
  });
  return { markdown: nextLines.join("\n"), removed };
}

export function extractBilibiliVideosFromStudyBlocks(
  markdown: string
): Array<{ idType: "bvid" | "aid"; videoId: string; page: number }> {
  const videos: Array<{ idType: "bvid" | "aid"; videoId: string; page: number }> = [];
  const blockPattern = /```(?:lingua-study|english-video-study)\s*\n([\s\S]*?)```/gu;
  for (const block of markdown.matchAll(blockPattern)) {
    const body = block[1] ?? "";
    if (!/^\s*platform\s*:\s*bilibili\s*$/imu.test(body)) {
      continue;
    }
    const bvid = /^\s*bvid\s*:\s*(BV[0-9A-Za-z]{10})\s*$/imu.exec(body)?.[1];
    const aid = /^\s*aid\s*:\s*([1-9][0-9]*)\s*$/imu.exec(body)?.[1];
    const pageText = /^\s*page\s*:\s*([0-9]+)\s*$/imu.exec(body)?.[1] ?? null;
    const page = parsePositivePage(pageText);
    if (bvid) {
      videos.push({ idType: "bvid", videoId: bvid, page });
    } else if (aid) {
      videos.push({ idType: "aid", videoId: `av${aid}`, page });
    }
  }
  return videos;
}

export function chooseAvailableTranscriptPath(
  folder: string,
  videoId: string,
  exists: (path: string) => boolean
): { path: string; conflict: boolean } {
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : `-${index}`;
    const path = `${folder}/${videoId}${suffix}.json`;
    if (!exists(path)) {
      return { path, conflict: index > 1 };
    }
    index += 1;
  }
}

export function extractTranscriptPathsFromStudyBlocks(markdown: string): string[] {
  const paths: string[] = [];
  const blockPattern = /```(?:lingua-study|english-video-study)\s*\n([\s\S]*?)```/gu;
  for (const block of markdown.matchAll(blockPattern)) {
    const body = block[1] ?? "";
    const pathMatch = /^\s*transcript\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\n#]+))/mu.exec(body);
    const path = (pathMatch?.[1] ?? pathMatch?.[2] ?? pathMatch?.[3] ?? "").trim();
    if (path !== "") {
      paths.push(path);
    }
  }
  return paths;
}
