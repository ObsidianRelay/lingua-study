export type BilibiliSubtitleFailureKind =
  | "no-english"
  | "no-tracks"
  | "login-required"
  | "rate-limited"
  | "network"
  | "invalid-response";

export interface BilibiliVideoIdentity {
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  sourceUrl: string;
}

export interface BilibiliSubtitlePayload {
  language: string;
  label: string;
  automatic: boolean;
  segments: Array<{ start: number; duration: number; text: string }>;
}

export interface BilibiliSubtitleSuccessResult {
  status: "success";
  video: BilibiliVideoIdentity;
  subtitle: BilibiliSubtitlePayload;
}

export interface BilibiliSubtitleErrorResult {
  status: "error";
  video: Pick<BilibiliVideoIdentity, "bvid" | "page">;
  error: { kind: BilibiliSubtitleFailureKind; message: string };
}

export type BilibiliSubtitleResult =
  | BilibiliSubtitleSuccessResult
  | BilibiliSubtitleErrorResult;

export interface BilibiliSubtitleTrack {
  url: string;
  language: string;
  label: string;
  automatic: boolean;
}

export interface BilibiliSessionCookie {
  name: string;
  value: string;
}

export class BilibiliApiError extends Error {
  constructor(
    readonly kind: BilibiliSubtitleFailureKind,
    message: string
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Electron 不同版本对 cookies.get({ url, name }) 的组合过滤行为不一致。 */
export function hasBilibiliLoginCookie(cookies: readonly BilibiliSessionCookie[]): boolean {
  return cookies.some((cookie) => cookie.name === "SESSDATA" && cookie.value.trim() !== "");
}

export function parseBilibiliVideoMetadata(
  value: unknown,
  bvid: string,
  page: number
): BilibiliVideoIdentity {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
    throw new BilibiliApiError("invalid-response", "B站返回的视频信息格式无效。");
  }
  const rawPages: unknown = value.data.pages;
  const pages: unknown[] = Array.isArray(rawPages) ? rawPages : [];
  const selected = pages.find((entry) => isRecord(entry) && entry.page === page);
  const aid = value.data.aid;
  const cid = isRecord(selected) ? selected.cid : undefined;
  if (!isPositiveInteger(aid) || !isPositiveInteger(cid)) {
    throw new BilibiliApiError("invalid-response", "无法确定当前分 P 的 aid 或 cid。");
  }
  return {
    bvid,
    aid,
    cid,
    page,
    title: typeof value.data.title === "string" && value.data.title.trim() !== ""
      ? value.data.title.trim()
      : bvid,
    sourceUrl: `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ""}`
  };
}

export function allowedBilibiliSubtitleUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.startsWith("//") ? `https:${value}` : value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const allowed = url.protocol === "https:" && [
    "hdslb.com",
    "bilibili.com",
    "bilivideo.com",
    "bilivideo.cn"
  ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return allowed ? url.toString() : null;
}

export function parseBilibiliSubtitleTracks(
  value: unknown
): { tracks: BilibiliSubtitleTrack[]; loginRequired: boolean } {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
    throw new BilibiliApiError("invalid-response", "B站字幕接口返回了无效响应。");
  }
  const subtitle = isRecord(value.data.subtitle) ? value.data.subtitle : null;
  const entries = subtitle && Array.isArray(subtitle.subtitles) ? subtitle.subtitles : [];
  const tracks: BilibiliSubtitleTrack[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.lan !== "string" || typeof entry.subtitle_url !== "string") {
      continue;
    }
    const url = allowedBilibiliSubtitleUrl(entry.subtitle_url);
    if (!url) {
      continue;
    }
    const language = entry.lan.trim();
    const lower = language.toLowerCase();
    tracks.push({
      url,
      language,
      label: typeof entry.lan_doc === "string" && entry.lan_doc.trim() !== ""
        ? entry.lan_doc.trim()
        : language,
      automatic: entry.type === 1 || entry.ai_type === 1 ||
        lower.startsWith("ai-") || lower.endsWith("-ai")
    });
  }
  return { tracks, loginRequired: value.data.need_login_subtitle === true };
}

export function selectBilibiliEnglishTrack(
  tracks: readonly BilibiliSubtitleTrack[]
): BilibiliSubtitleTrack | null {
  const english = tracks.filter((track) => {
    const language = track.language.toLowerCase();
    return language === "en" || language.startsWith("en-") ||
      language === "ai-en" || language.startsWith("ai-en-");
  });
  return english.find((track) => !track.automatic) ??
    english.find((track) => track.automatic) ?? null;
}

export function parseBilibiliSubtitleBody(value: unknown): BilibiliSubtitlePayload["segments"] {
  if (!isRecord(value) || !Array.isArray(value.body)) {
    throw new BilibiliApiError("invalid-response", "B站字幕正文格式无效。");
  }
  const segments: BilibiliSubtitlePayload["segments"] = [];
  for (const entry of value.body) {
    if (!isRecord(entry)) {
      continue;
    }
    const start = entry.from;
    const end = entry.to;
    const content = entry.content;
    if (
      typeof start !== "number" || typeof end !== "number" || typeof content !== "string" ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start
    ) {
      continue;
    }
    const text = content.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
    if (text !== "") {
      segments.push({ start, duration: end - start, text });
    }
  }
  if (segments.length === 0) {
    throw new BilibiliApiError("invalid-response", "B站英文字幕正文为空。");
  }
  return segments;
}
