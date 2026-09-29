import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { requestUrl } from "obsidian";
import type { BilibiliVideoLink } from "./import-core";
import type { CachedAudioMedia } from "./cached-audio";
import {
  buildBilibiliCacheBaseName,
  getDefaultBilibiliCacheFolder,
  isAllowedBilibiliCdnUrl,
  MAX_BILIBILI_CACHE_VIDEO_BYTES,
  parseBilibiliMediaByteRange
} from "./bilibili-cache-core";
import {
  readCachedBilibiliFiles,
  readCachedBilibiliFilesFromFolder,
  type BilibiliCacheManifest
} from "./bilibili-cache-storage";

const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const BILIBILI_REFERER = "https://www.bilibili.com/";
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

interface BilibiliPageMetadata {
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  duration: number;
}

interface BilibiliDownloadSource {
  url: string;
  backupUrls: string[];
  size: number;
  duration: number;
}

export interface CachedBilibiliVideo extends CachedAudioMedia {
  manifest: BilibiliCacheManifest;
  fileUrls: string[];
  filePaths: string[];
}

export interface LocalPlaybackAsset {
  filePath: string;
  fileName: string;
  contentType: string;
}

export interface BilibiliCacheResult {
  link: BilibiliVideoLink;
  cached: CachedBilibiliVideo;
  reused: boolean;
}

export interface LocalVideoPlaybackAsset {
  fileUrl: string;
  filePath: string;
  title: string;
}

export interface BilibiliCacheServiceOptions {
  primaryFolder?: string;
  fallbackFolders?: readonly string[];
  primaryFolderIsCustom?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export class BilibiliCacheService {
  readonly cacheFolder: string;
  readonly fallbackFolders: readonly string[];
  private readonly primaryFolderIsCustom: boolean;
  private readonly mediaToken = randomBytes(24).toString("hex");
  private readonly allowedLocalAssets = new Map<
    string,
    { filePath: string; contentType: string }
  >();
  private mediaServer: Server | null = null;
  private mediaServerPort: number | null = null;
  private mediaServerStart: Promise<number> | null = null;

  constructor(options: BilibiliCacheServiceOptions = {}) {
    this.cacheFolder = options.primaryFolder ?? getDefaultBilibiliCacheFolder(
      process.platform,
      homedir(),
      process.env
    );
    this.fallbackFolders = [...new Set(
      (options.fallbackFolders ?? []).filter((folder) => folder !== this.cacheFolder)
    )];
    this.primaryFolderIsCustom = options.primaryFolderIsCustom ?? false;
  }

  async cacheVideo(
    link: BilibiliVideoLink,
    onProgress: (message: string) => void
  ): Promise<BilibiliCacheResult> {
    if (link.idType === "bvid") {
      const existing = await this.readCachedVideo(link.videoId, link.page);
      if (existing) {
        return { link, cached: existing, reused: true };
      }
    }

    onProgress("正在读取 B站视频信息…");
    const metadata = await this.fetchPageMetadata(link);
    const canonicalLink: BilibiliVideoLink = {
      kind: "video",
      idType: "bvid",
      videoId: metadata.bvid,
      page: metadata.page,
      canonicalUrl: `https://www.bilibili.com/video/${metadata.bvid}${metadata.page > 1 ? `?p=${metadata.page}` : ""}`,
      originalUrl: link.originalUrl
    };
    const existing = await this.readCachedVideo(metadata.bvid, metadata.page);
    if (existing && existing.manifest.cid === metadata.cid) {
      return { link: canonicalLink, cached: existing, reused: true };
    }

    await this.ensurePrimaryFolderWritable();
    onProgress("正在获取 B站公开缓存地址…");
    const sources = await this.fetchDownloadSources(metadata);
    const totalSize = sources.reduce((sum, source) => sum + source.size, 0);
    if (totalSize > MAX_BILIBILI_CACHE_VIDEO_BYTES) {
      throw new Error("该视频缓存预计超过 2 GB，为保护磁盘空间已停止下载。");
    }

    const baseName = buildBilibiliCacheBaseName(metadata.bvid, metadata.page);
    const segmentEntries: BilibiliCacheManifest["segments"] = [];
    let completedBytes = 0;
    for (const [index, source] of sources.entries()) {
      const suffix = sources.length === 1 ? "" : `-part${index + 1}`;
      const fileName = `${baseName}-${metadata.cid}${suffix}.mp4`;
      const filePath = join(this.cacheFolder, fileName);
      await this.downloadWithFallback(source, filePath, (downloaded) => {
        const current = completedBytes + downloaded;
        const percent = totalSize > 0 ? Math.min(99, Math.round((current / totalSize) * 100)) : null;
        onProgress(percent === null ? "正在缓存 B站视频…" : `正在缓存 B站视频… ${percent}%`);
      });
      const fileSize = (await stat(filePath)).size;
      completedBytes += fileSize;
      segmentEntries.push({ file: fileName, size: fileSize, duration: source.duration });
    }

    const manifest: BilibiliCacheManifest = {
      version: 1,
      platform: "bilibili",
      bvid: metadata.bvid,
      aid: metadata.aid,
      cid: metadata.cid,
      page: metadata.page,
      title: metadata.title,
      sourceUrl: canonicalLink.canonicalUrl,
      createdAt: new Date().toISOString(),
      segments: segmentEntries
    };
    const manifestPath = join(this.cacheFolder, `${baseName}.json`);
    const temporaryManifestPath = `${manifestPath}.part`;
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rm(manifestPath, { force: true });
    await rename(temporaryManifestPath, manifestPath);
    const cached = await this.readCachedVideoFromPrimary(metadata.bvid, metadata.page);
    if (!cached) {
      throw new Error("视频已经下载，但缓存清单校验失败，请打开缓存文件夹检查磁盘权限。");
    }
    onProgress("B站视频缓存完成，正在更新笔记…");
    return { link: canonicalLink, cached, reused: false };
  }

  async getCachedVideo(
    idType: "bvid" | "aid",
    videoId: string,
    page: number
  ): Promise<CachedBilibiliVideo | null> {
    if (idType !== "bvid") {
      return null;
    }
    return this.readCachedVideo(videoId, page);
  }

  async exposeExternalMp4(
    filePath: string,
    localId: string
  ): Promise<LocalVideoPlaybackAsset> {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(localId)) {
      throw new Error("本地视频 ID 格式不正确。");
    }
    if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== ".mp4") {
      throw new Error("本地视频路径无效，目前只支持电脑中的 MP4 文件。");
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      throw new Error("找不到本地视频，文件可能已被移动或删除。");
    }
    if (!info.isFile() || info.size <= 0) {
      throw new Error("本地视频不是有效文件。");
    }
    const publicName = `local-${localId}.mp4`;
    const baseUrl = await this.exposeLocalAssets([{
      filePath,
      fileName: publicName,
      contentType: "video/mp4"
    }]);
    return {
      fileUrl: `${baseUrl}${encodeURIComponent(publicName)}`,
      filePath,
      title: basename(filePath)
    };
  }

  async openCacheFolder(): Promise<void> {
    if (this.primaryFolderIsCustom) {
      const info = await stat(this.cacheFolder).catch(() => null);
      if (!info?.isDirectory()) {
        throw new Error(this.customFolderUnavailableMessage());
      }
    } else {
      await mkdir(this.cacheFolder, { recursive: true });
    }
    const command = process.platform === "darwin"
      ? "/usr/bin/open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [this.cacheFolder], {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.allowedLocalAssets.clear();
    const pendingStart = this.mediaServerStart;
    if (pendingStart && !this.mediaServerPort) {
      try {
        await pendingStart;
      } catch {
        return;
      }
    }

    const server = this.mediaServer;
    this.mediaServer = null;
    this.mediaServerPort = null;
    this.mediaServerStart = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async fetchPageMetadata(link: BilibiliVideoLink): Promise<BilibiliPageMetadata> {
    const query = link.idType === "bvid"
      ? `bvid=${encodeURIComponent(link.videoId)}`
      : `aid=${encodeURIComponent(link.videoId.slice(2))}`;
    const response = await requestUrl({
      url: `https://api.bilibili.com/x/web-interface/view?${query}`,
      headers: { Referer: BILIBILI_REFERER, "User-Agent": BILIBILI_USER_AGENT },
      throw: false
    });
    if (response.status === 429 || response.status === 412) {
      throw new Error("B站暂时限制了视频信息请求，请稍后再试。");
    }
    const responseJson: unknown = response.json;
    if (response.status !== 200 || !isRecord(responseJson)) {
      throw new Error(`无法读取 B站视频信息（HTTP ${response.status}）。`);
    }
    const root = responseJson;
    if (root.code !== 0 || !isRecord(root.data)) {
      throw new Error(typeof root.message === "string" ? `B站视频不可用：${root.message}` : "B站视频不可用或已被删除。");
    }
    const data = root.data;
    const bvid = typeof data.bvid === "string" && /^BV[0-9A-Za-z]{10}$/u.test(data.bvid)
      ? data.bvid
      : null;
    const aid = readPositiveInteger(data.aid);
    const pages: unknown[] = Array.isArray(data.pages) ? data.pages : [];
    const selected = pages.find(
      (entry) => isRecord(entry) && entry.page === link.page
    );
    if (!bvid || aid === null || !isRecord(selected)) {
      throw new Error(`B站视频没有第 ${link.page} P，无法创建缓存。`);
    }
    const cid = readPositiveInteger(selected.cid);
    if (cid === null) {
      throw new Error("B站没有返回有效的分 P 视频编号。");
    }
    return {
      bvid,
      aid,
      cid,
      page: link.page,
      title: typeof selected.part === "string" && selected.part.trim() !== ""
        ? selected.part.trim()
        : typeof data.title === "string" ? data.title.trim() : bvid,
      duration: readPositiveInteger(selected.duration) ?? 0
    };
  }

  private async fetchDownloadSources(metadata: BilibiliPageMetadata): Promise<BilibiliDownloadSource[]> {
    const params = new URLSearchParams({
      bvid: metadata.bvid,
      cid: metadata.cid.toString(),
      qn: "64",
      fnval: "0",
      fourk: "0"
    });
    const response = await requestUrl({
      url: `https://api.bilibili.com/x/player/playurl?${params.toString()}`,
      headers: { Referer: BILIBILI_REFERER, "User-Agent": BILIBILI_USER_AGENT },
      throw: false
    });
    if (response.status === 429 || response.status === 412) {
      throw new Error("B站暂时限制了视频缓存请求，请稍后再试。");
    }
    const responseJson: unknown = response.json;
    if (response.status !== 200 || !isRecord(responseJson)) {
      throw new Error(`无法获得 B站视频缓存地址（HTTP ${response.status}）。`);
    }
    const root = responseJson;
    if (root.code !== 0 || !isRecord(root.data) || !Array.isArray(root.data.durl)) {
      throw new Error("B站没有返回可缓存的视频文件，可能需要登录、会员或受到地区限制。");
    }

    const sources: BilibiliDownloadSource[] = [];
    for (const entry of root.data.durl) {
      if (!isRecord(entry) || typeof entry.url !== "string") {
        throw new Error("B站返回了不受信任的视频缓存地址，已停止下载。");
      }
      const rawBackupUrls: unknown[] = Array.isArray(entry.backup_url)
        ? entry.backup_url
        : [];
      const candidateUrls: unknown[] = [
        entry.url,
        ...rawBackupUrls
      ];
      const allowedUrls = candidateUrls.filter(
        (url): url is string => typeof url === "string" && isAllowedBilibiliCdnUrl(url)
      );
      const [url, ...backupUrls] = allowedUrls;
      if (!url) {
        throw new Error("B站返回了不受信任的视频缓存地址，已停止下载。");
      }
      const size = readPositiveInteger(entry.size) ?? 0;
      if (size > MAX_BILIBILI_CACHE_VIDEO_BYTES) {
        throw new Error("单个 B站视频文件超过 2 GB，为保护磁盘空间已停止下载。");
      }
      sources.push({
        url,
        backupUrls,
        size,
        duration: (readPositiveInteger(entry.length) ?? metadata.duration * 1_000) / 1_000
      });
    }
    if (sources.length === 0) {
      throw new Error("B站没有返回可缓存的视频文件。");
    }
    return sources;
  }

  private async downloadWithFallback(
    source: BilibiliDownloadSource,
    destination: string,
    onBytes: (downloaded: number) => void
  ): Promise<void> {
    let lastError: unknown = null;
    for (const url of [source.url, ...source.backupUrls]) {
      try {
        await this.downloadFile(url, destination, onBytes);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("B站视频缓存下载失败，请稍后重试。");
  }

  private async downloadFile(
    sourceUrl: string,
    destination: string,
    onBytes: (downloaded: number) => void,
    redirectCount = 0
  ): Promise<void> {
    if (!isAllowedBilibiliCdnUrl(sourceUrl)) {
      throw new Error("B站视频缓存地址不在允许的域名范围内。");
    }
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error("B站视频缓存地址跳转次数过多，已停止下载。");
    }

    const partialPath = `${destination}.part`;
    await rm(partialPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      const request = httpsGet(sourceUrl, {
        headers: { Referer: BILIBILI_REFERER, "User-Agent": BILIBILI_USER_AGENT }
      }, (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          let nextUrl: string;
          try {
            nextUrl = new URL(location, sourceUrl).toString();
          } catch {
            reject(new Error("B站视频缓存返回了无效跳转地址。"));
            return;
          }
          void this.downloadFile(nextUrl, destination, onBytes, redirectCount + 1)
            .then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`B站视频缓存下载失败（HTTP ${status}）。`));
          return;
        }

        const contentLength = Number.parseInt(response.headers["content-length"] ?? "0", 10);
        if (Number.isFinite(contentLength) && contentLength > MAX_BILIBILI_CACHE_VIDEO_BYTES) {
          response.destroy();
          reject(new Error("B站视频文件超过 2 GB，为保护磁盘空间已停止下载。"));
          return;
        }

        const output = createWriteStream(partialPath, { flags: "wx" });
        let downloaded = 0;
        let settled = false;
        const fail = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          response.destroy();
          output.destroy();
          void rm(partialPath, { force: true }).finally(() => reject(error));
        };
        response.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
          fail(new Error("B站视频缓存下载超时，请检查网络后重试。"));
        });
        response.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (downloaded > MAX_BILIBILI_CACHE_VIDEO_BYTES) {
            fail(new Error("B站视频文件超过 2 GB，为保护磁盘空间已停止下载。"));
            return;
          }
          onBytes(downloaded);
        });
        response.once("error", (error) => fail(error));
        output.once("error", (error) => fail(error));
        output.once("finish", () => {
          if (settled) {
            return;
          }
          settled = true;
          output.close(() => {
            void rm(destination, { force: true })
              .then(() => rename(partialPath, destination))
              .then(() => resolve(), reject);
          });
        });
        response.pipe(output);
      });
      request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
        request.destroy(new Error("B站视频缓存连接超时，请检查网络后重试。"));
      });
      request.once("error", (error) => {
        void rm(partialPath, { force: true }).finally(() => reject(error));
      });
    });
  }

  private async readCachedVideo(bvid: string, page: number): Promise<CachedBilibiliVideo | null> {
    const cached = await readCachedBilibiliFiles(
      this.cacheFolder,
      this.fallbackFolders,
      bvid,
      page
    );
    return cached ? this.exposeCachedFiles(cached.manifest, cached.filePaths) : null;
  }

  private async readCachedVideoFromPrimary(
    bvid: string,
    page: number
  ): Promise<CachedBilibiliVideo | null> {
    const cached = await readCachedBilibiliFilesFromFolder(this.cacheFolder, bvid, page);
    return cached ? this.exposeCachedFiles(cached.manifest, cached.filePaths) : null;
  }

  private async exposeCachedFiles(
    manifest: BilibiliCacheManifest,
    filePaths: string[]
  ): Promise<CachedBilibiliVideo> {
    return {
      manifest,
      segments: manifest.segments,
      filePaths,
      fileUrls: await this.createMediaUrls(filePaths)
    };
  }

  private async ensurePrimaryFolderWritable(): Promise<void> {
    let probePath: string | null = null;
    try {
      if (this.primaryFolderIsCustom) {
        const info = await stat(this.cacheFolder);
        if (!info.isDirectory()) {
          throw new Error("路径不是文件夹");
        }
      } else {
        await mkdir(this.cacheFolder, { recursive: true });
      }
      probePath = join(
        this.cacheFolder,
        `.lingua-study-write-${randomBytes(8).toString("hex")}.tmp`
      );
      const handle = await open(
        probePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      );
      await handle.close();
      await rm(probePath, { force: true });
    } catch (error) {
      if (probePath) {
        await rm(probePath, { force: true }).catch(() => undefined);
      }
      if (this.primaryFolderIsCustom) {
        throw new Error(this.customFolderUnavailableMessage(), { cause: error });
      }
      throw new Error("无法写入 B站视频缓存目录，请检查磁盘空间和系统权限。", {
        cause: error
      });
    }
  }

  private customFolderUnavailableMessage(): string {
    return "B站自定义缓存目录当前不可用。请重新连接磁盘、重新选择目录或恢复默认路径。";
  }

  private async createMediaUrls(filePaths: string[]): Promise<string[]> {
    const baseUrl = await this.exposeLocalAssets(filePaths.map((filePath) => ({
      filePath,
      fileName: basename(filePath),
      contentType: "video/mp4"
    })));
    return filePaths.map((filePath) => `${baseUrl}${encodeURIComponent(basename(filePath))}`);
  }

  /**
   * 只向本机临时播放通道注册调用方已经校验过的文件。
   * 返回的随机地址在插件卸载后立即失效。
   */
  async exposeLocalAssets(assets: LocalPlaybackAsset[]): Promise<string> {
    const port = await this.ensureMediaServer();
    for (const asset of assets) {
      if (
        asset.fileName === "" ||
        basename(asset.fileName) !== asset.fileName ||
        !/^[\w.+-]+$/u.test(asset.fileName)
      ) {
        throw new Error("本地播放文件名不安全，已拒绝开放。");
      }
      this.allowedLocalAssets.set(asset.fileName, {
        filePath: asset.filePath,
        contentType: asset.contentType
      });
    }
    return `http://127.0.0.1:${port}/${this.mediaToken}/`;
  }

  private ensureMediaServer(): Promise<number> {
    if (this.mediaServerPort !== null) {
      return Promise.resolve(this.mediaServerPort);
    }
    if (this.mediaServerStart) {
      return this.mediaServerStart;
    }

    this.mediaServerStart = new Promise<number>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleMediaRequest(request, response).catch(() => {
          if (response.headersSent) {
            response.destroy();
          } else {
            response.writeHead(500).end();
          }
        });
      });
      this.mediaServer = server;
      const failStartup = (error: Error): void => {
        this.mediaServer = null;
        this.mediaServerPort = null;
        this.mediaServerStart = null;
        reject(new Error(`无法启动本地缓存播放器：${error.message}`));
      };
      server.once("error", failStartup);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", failStartup);
        // 播放期间的连接错误由单个请求处理，避免插件进程因未处理事件退出。
        server.on("error", () => undefined);
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          failStartup(new Error("没有获得本地播放端口"));
          return;
        }
        this.mediaServerPort = address.port;
        resolve(address.port);
      });
    });
    return this.mediaServerStart;
  }

  private async handleMediaRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Accept-Ranges", "bytes");

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url ?? "", "http://127.0.0.1");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const prefix = `/${this.mediaToken}/`;
    if (!parsedUrl.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }

    let fileName: string;
    try {
      fileName = decodeURIComponent(parsedUrl.pathname.slice(prefix.length));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (fileName === "" || basename(fileName) !== fileName) {
      response.writeHead(404).end();
      return;
    }
    const asset = this.allowedLocalAssets.get(fileName);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }

    let fileSize: number;
    try {
      const fileStat = await stat(asset.filePath);
      if (!fileStat.isFile() || fileStat.size <= 0) {
        response.writeHead(404).end();
        return;
      }
      fileSize = fileStat.size;
    } catch {
      response.writeHead(404).end();
      return;
    }

    const rangeHeader = typeof request.headers.range === "string"
      ? request.headers.range
      : null;
    const range = rangeHeader
      ? parseBilibiliMediaByteRange(rangeHeader, fileSize)
      : { start: 0, end: fileSize - 1 };
    if (!range) {
      response.writeHead(416, { "Content-Range": `bytes */${fileSize}` }).end();
      return;
    }

    const contentLength = range.end - range.start + 1;
    const headers: Record<string, string | number> = {
      "Content-Type": asset.contentType,
      "Content-Length": contentLength
    };
    if (rangeHeader) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileSize}`;
    }
    response.writeHead(rangeHeader ? 206 : 200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(asset.filePath, { start: range.start, end: range.end });
    stream.once("error", () => response.destroy());
    request.once("aborted", () => stream.destroy());
    stream.pipe(response);
  }
}
