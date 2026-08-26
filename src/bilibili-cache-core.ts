import { join } from "node:path";

export const MAX_BILIBILI_CACHE_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

export interface BilibiliMediaByteRange {
  start: number;
  end: number;
}

export function getDefaultBilibiliCacheFolder(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Caches", "Lingua Study", "Bilibili");
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    return join(
      localAppData && localAppData !== "" ? localAppData : join(homeDirectory, "AppData", "Local"),
      "Lingua Study",
      "Cache",
      "Bilibili"
    );
  }
  const xdgCacheHome = environment.XDG_CACHE_HOME?.trim();
  return join(
    xdgCacheHome && xdgCacheHome !== "" ? xdgCacheHome : join(homeDirectory, ".cache"),
    "lingua-study",
    "bilibili"
  );
}

/** 只允许从B站视频 CDN 下载，拒绝接口响应中出现的任意第三方地址。 */
export function isAllowedBilibiliCdnUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  return host === "bilivideo.com" ||
    host.endsWith(".bilivideo.com") ||
    host === "bilivideo.cn" ||
    host.endsWith(".bilivideo.cn");
}

export function buildBilibiliCacheBaseName(bvid: string, page: number): string {
  if (!/^BV[0-9A-Za-z]{10}$/u.test(bvid)) {
    throw new Error("B站视频 ID 格式不正确，无法创建缓存文件名。");
  }
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new Error("B站分 P 页码不正确，无法创建缓存文件名。");
  }
  return `${bvid}-p${page}`;
}

/**
 * 解析浏览器播放视频时发送的单段 Range 请求。
 * 多段 Range 不属于 HTML 视频播放器的正常需求，因此直接拒绝。
 */
export function parseBilibiliMediaByteRange(
  header: string,
  fileSize: number
): BilibiliMediaByteRange | null {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match) {
    return null;
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") {
    return null;
  }

  if (startText === "") {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1
    };
  }

  const start = Number.parseInt(startText, 10);
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) {
    return null;
  }
  const requestedEnd = endText === "" ? fileSize - 1 : Number.parseInt(endText, 10);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1)
  };
}
