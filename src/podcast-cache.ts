import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { BilibiliCacheService } from "./bilibili-cache";
import type { CachedAudioMedia } from "./cached-audio";
import type { PodcastEpisode } from "./podcast-rss-core";

const MAX_PODCAST_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg", ".opus"]);

interface PodcastCacheManifest {
  version: 1;
  sourceId: string;
  title: string;
  enclosureUrl: string;
  contentType: string;
  fileName: string;
  size: number;
  createdAt: string;
}

export interface CachedPodcastEpisode extends CachedAudioMedia {
  sourceId: string;
  title: string;
  filePath: string;
  contentType: string;
}

function getPodcastCacheFolder(platform: NodeJS.Platform, home: string): string {
  if (platform === "darwin") {
    return join(home, "Library", "Caches", "Lingua Study", "Podcasts");
  }
  if (platform === "win32") {
    return join(process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "Lingua Study", "Cache", "Podcasts");
  }
  return join(process.env.XDG_CACHE_HOME?.trim() || join(home, ".cache"), "lingua-study", "podcasts");
}

function audioExtension(url: string, contentType: string): string | null {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (AUDIO_EXTENSIONS.has(fromUrl)) {
    return fromUrl;
  }
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const byType: Record<string, string> = {
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
    "audio/aac": ".aac", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/flac": ".flac", "audio/ogg": ".ogg", "audio/opus": ".opus"
  };
  return byType[normalized] ?? null;
}

function isAudioResponse(contentType: string, url: string): boolean {
  return contentType.toLowerCase().startsWith("audio/") || audioExtension(url, contentType) !== null;
}

function safeManifest(value: unknown): PodcastCacheManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  return item.version === 1 && typeof item.sourceId === "string" &&
    typeof item.title === "string" && typeof item.enclosureUrl === "string" &&
    typeof item.contentType === "string" && typeof item.fileName === "string" &&
    /^[\w.-]+$/u.test(item.fileName) && typeof item.size === "number" &&
    Number.isSafeInteger(item.size) && item.size > 0 && typeof item.createdAt === "string"
    ? item as unknown as PodcastCacheManifest
    : null;
}

export class PodcastCacheService {
  readonly cacheFolder: string;

  constructor(
    private readonly localAssetServer: BilibiliCacheService,
    options: { cacheFolder?: string } = {}
  ) {
    this.cacheFolder = options.cacheFolder ?? getPodcastCacheFolder(process.platform, homedir());
  }

  async cacheEpisode(
    episode: PodcastEpisode,
    onProgress: (message: string) => void
  ): Promise<{ cached: CachedPodcastEpisode; reused: boolean }> {
    const existing = await this.readCached(episode.sourceId);
    if (existing) {
      return { cached: existing, reused: true };
    }
    await mkdir(this.cacheFolder, { recursive: true });
    onProgress("正在缓存播客音频…");
    const response = await this.request(episode.enclosureUrl, 0);
    const contentType = (response.headers["content-type"] ?? "application/octet-stream").toString();
    if (!isAudioResponse(contentType, response.url)) {
      response.response.resume();
      throw new Error("播客 enclosure 不是可播放的音频文件。");
    }
    const declaredLength = Number.parseInt((response.headers["content-length"] ?? "").toString(), 10);
    if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_PODCAST_AUDIO_BYTES) {
      response.response.resume();
      throw new Error("播客音频超过 512 MB，已停止缓存以保护磁盘空间。");
    }
    const extension = audioExtension(response.url, contentType);
    if (!extension) {
      response.response.resume();
      throw new Error("播客音频格式不受支持；目前支持 MP3、M4A、AAC、WAV、FLAC、OGG 和 Opus。");
    }
    const fileName = `${episode.sourceId}${extension}`;
    const filePath = join(this.cacheFolder, fileName);
    await this.writeResponse(response.response, filePath, declaredLength, onProgress);
    const size = (await stat(filePath)).size;
    const manifest: PodcastCacheManifest = {
      version: 1,
      sourceId: episode.sourceId,
      title: episode.title,
      enclosureUrl: response.url,
      contentType,
      fileName,
      size,
      createdAt: new Date().toISOString()
    };
    const manifestPath = join(this.cacheFolder, `${episode.sourceId}.json`);
    const partialManifest = `${manifestPath}.part`;
    await writeFile(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(partialManifest, manifestPath);
    const cached = await this.readCached(episode.sourceId);
    if (!cached) {
      throw new Error("播客音频已下载，但缓存校验失败。请检查磁盘权限后重试。");
    }
    return { cached, reused: false };
  }

  async getCachedEpisode(sourceId: string): Promise<CachedPodcastEpisode | null> {
    return this.readCached(sourceId);
  }

  private async readCached(sourceId: string): Promise<CachedPodcastEpisode | null> {
    if (!/^podcast-[A-Za-z0-9_-]{22}$/u.test(sourceId)) {
      return null;
    }
    let manifest: PodcastCacheManifest | null = null;
    try {
      manifest = safeManifest(JSON.parse(await readFile(join(this.cacheFolder, `${sourceId}.json`), "utf8")));
    } catch {
      return null;
    }
    if (!manifest || manifest.sourceId !== sourceId) {
      return null;
    }
    const filePath = join(this.cacheFolder, manifest.fileName);
    const fileInfo = await stat(filePath).catch(() => null);
    if (!fileInfo?.isFile() || fileInfo.size !== manifest.size) {
      return null;
    }
    const baseUrl = await this.localAssetServer.exposeLocalAssets([{
      filePath,
      fileName: manifest.fileName,
      contentType: manifest.contentType
    }]);
    return {
      sourceId,
      title: manifest.title,
      filePath,
      contentType: manifest.contentType,
      fileUrls: [`${baseUrl}${encodeURIComponent(manifest.fileName)}`],
      segments: [{ duration: 0 }]
    };
  }

  private request(url: string, redirects: number): Promise<{
    response: import("node:http").IncomingMessage;
    headers: import("node:http").IncomingHttpHeaders;
    url: string;
  }> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return Promise.reject(new Error("播客媒体地址必须使用 HTTP 或 HTTPS。"));
    }
    const request = parsed.protocol === "https:" ? httpsGet : httpGet;
    return new Promise((resolve, reject) => {
      const pending = request(parsed, {
        headers: { "User-Agent": "Lingua Study Podcast Adapter/1.0", Accept: "audio/*,*/*;q=0.8" }
      }, (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error("播客媒体重定向次数过多。"));
            return;
          }
          void this.request(new URL(location, parsed).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`播客媒体请求失败（HTTP ${status}）。`));
          return;
        }
        resolve({ response, headers: response.headers, url: parsed.toString() });
      });
      pending.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => pending.destroy(new Error("播客媒体下载超时。")));
      pending.once("error", () => reject(new Error("无法下载播客媒体，请检查网络后重试。")));
    });
  }

  private writeResponse(
    response: import("node:http").IncomingMessage,
    filePath: string,
    declaredLength: number,
    onProgress: (message: string) => void
  ): Promise<void> {
    const partial = `${filePath}.part`;
    return new Promise((resolve, reject) => {
      let downloaded = 0;
      const output = createWriteStream(partial, { flags: "w" });
      const fail = (error: Error): void => {
        response.destroy();
        output.destroy();
        void rm(partial, { force: true }).finally(() => reject(error));
      };
      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (downloaded > MAX_PODCAST_AUDIO_BYTES) {
          fail(new Error("播客音频超过 512 MB，已停止缓存以保护磁盘空间。"));
          return;
        }
        const percent = Number.isSafeInteger(declaredLength) && declaredLength > 0
          ? ` ${Math.min(99, Math.round(downloaded / declaredLength * 100))}%`
          : "";
        onProgress(`正在缓存播客音频…${percent}`);
      });
      response.once("error", () => fail(new Error("播客音频下载中断。")));
      output.once("error", () => fail(new Error("无法写入播客缓存文件。")));
      output.once("finish", () => {
        void rename(partial, filePath).then(() => resolve(), (error: Error) => fail(error));
      });
      response.pipe(output);
    });
  }
}
