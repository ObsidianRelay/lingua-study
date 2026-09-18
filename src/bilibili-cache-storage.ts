import { basename, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { buildBilibiliCacheBaseName } from "./bilibili-cache-core";

export interface BilibiliCacheManifest {
  version: 1;
  platform: "bilibili";
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  sourceUrl: string;
  createdAt: string;
  segments: Array<{
    file: string;
    size: number;
    duration: number;
  }>;
}

export interface CachedBilibiliFiles {
  folder: string;
  manifest: BilibiliCacheManifest;
  filePaths: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function getOrderedBilibiliCacheFolders(
  primaryFolder: string,
  fallbackFolders: readonly string[]
): string[] {
  return [...new Set([primaryFolder, ...fallbackFolders].filter((folder) => folder.trim() !== ""))];
}

export async function readCachedBilibiliFilesFromFolder(
  folder: string,
  bvid: string,
  page: number
): Promise<CachedBilibiliFiles | null> {
  let baseName: string;
  try {
    baseName = buildBilibiliCacheBaseName(bvid, page);
  } catch {
    return null;
  }
  const manifestPath = join(folder, `${baseName}.json`);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1 || value.platform !== "bilibili") {
    return null;
  }
  if (value.bvid !== bvid || value.page !== page || !Array.isArray(value.segments)) {
    return null;
  }
  const aid = readPositiveInteger(value.aid);
  const cid = readPositiveInteger(value.cid);
  if (aid === null || cid === null || value.segments.length === 0) {
    return null;
  }

  const segments: BilibiliCacheManifest["segments"] = [];
  const filePaths: string[] = [];
  for (const entry of value.segments) {
    if (!isRecord(entry) || typeof entry.file !== "string" || basename(entry.file) !== entry.file) {
      return null;
    }
    const expectedSize = readPositiveInteger(entry.size);
    if (expectedSize === null) {
      return null;
    }
    const filePath = join(folder, entry.file);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size !== expectedSize) {
        return null;
      }
    } catch {
      return null;
    }
    segments.push({
      file: entry.file,
      size: expectedSize,
      duration: typeof entry.duration === "number" && Number.isFinite(entry.duration)
        ? Math.max(0, entry.duration)
        : 0
    });
    filePaths.push(filePath);
  }

  return {
    folder,
    manifest: {
      version: 1,
      platform: "bilibili",
      bvid,
      aid,
      cid,
      page,
      title: typeof value.title === "string" ? value.title : bvid,
      sourceUrl: typeof value.sourceUrl === "string"
        ? value.sourceUrl
        : `https://www.bilibili.com/video/${bvid}`,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      segments
    },
    filePaths
  };
}

export async function readCachedBilibiliFiles(
  primaryFolder: string,
  fallbackFolders: readonly string[],
  bvid: string,
  page: number
): Promise<CachedBilibiliFiles | null> {
  for (const folder of getOrderedBilibiliCacheFolders(primaryFolder, fallbackFolders)) {
    const cached = await readCachedBilibiliFilesFromFolder(folder, bvid, page);
    if (cached) {
      return cached;
    }
  }
  return null;
}
