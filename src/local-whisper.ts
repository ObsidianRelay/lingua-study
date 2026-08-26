import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { BilibiliCacheService, CachedBilibiliVideo } from "./bilibili-cache";
import type { TimedRecognitionToken } from "./document-transcript-core";
import { decodeCachedAudio } from "./speech-audio";
import {
  getWhisperCacheFolder,
  isWhisperModelCacheUrl,
  WHISPER_RUNTIME_ASSETS,
  whisperChunksToTokens
} from "./local-whisper-core";
import type {
  WhisperWorkerResponse,
  WhisperWorkerTranscribeRequest
} from "./whisper-worker-protocol";
import WHISPER_WORKER_SOURCE from "virtual:whisper-worker";

const DOWNLOAD_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (chunks: unknown) => void;
  reject: (error: Error) => void;
  onProgress: (message: string) => void;
}

export class LocalWhisperService {
  readonly cacheFolder = getWhisperCacheFolder(process.platform, homedir(), process.env);
  private readonly pending = new Map<number, PendingRequest>();
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private nextRequestId = 1;
  private active = false;

  constructor(private readonly localAssetServer: BilibiliCacheService) {}

  async transcribe(
    cached: CachedBilibiliVideo,
    onProgress: (message: string) => void
  ): Promise<TimedRecognitionToken[]> {
    if (this.active) {
      throw new Error("已有一个视频正在本地自动对齐，请等待完成后再试。");
    }
    this.active = true;
    try {
      const wasmBaseUrl = await this.prepareRuntime(onProgress);
      const chunks = await decodeCachedAudio(cached, onProgress);
      const tokens: TimedRecognitionToken[] = [];
      for (const [index, chunk] of chunks.entries()) {
        onProgress(`正在本地识别音轨 ${index + 1}/${chunks.length}…`);
        const result = await this.requestWorker(chunk.samples, wasmBaseUrl, onProgress);
        tokens.push(...whisperChunksToTokens(result, chunk.offsetSeconds));
      }
      return tokens;
    } finally {
      this.active = false;
    }
  }

  async hasCachedModel(): Promise<boolean> {
    if (!window.caches) {
      return false;
    }
    const cache = await window.caches.open("transformers-cache");
    return (await cache.keys()).some((request) => isWhisperModelCacheUrl(request.url));
  }

  async clearCache(): Promise<void> {
    this.stopWorker();
    if (window.caches) {
      const cache = await window.caches.open("transformers-cache");
      await Promise.all((await cache.keys())
        .filter((request) => isWhisperModelCacheUrl(request.url))
        .map((request) => cache.delete(request)));
    }
    await rm(this.cacheFolder, { recursive: true, force: true });
  }

  async openCacheFolder(): Promise<void> {
    await mkdir(this.cacheFolder, { recursive: true });
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

  close(): void {
    this.stopWorker();
  }

  private requestWorker(
    audio: Float32Array,
    wasmBaseUrl: string,
    onProgress: (message: string) => void
  ): Promise<unknown> {
    const worker = this.getWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const request: WhisperWorkerTranscribeRequest = {
        type: "transcribe",
        id,
        audio,
        wasmBaseUrl
      };
      worker.postMessage(request, [audio.buffer]);
    });
  }

  private getWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const blob = new Blob([WHISPER_WORKER_SOURCE], { type: "text/javascript" });
    this.workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(this.workerUrl);
    worker.addEventListener("message", (event: MessageEvent<WhisperWorkerResponse>) => {
      const message = event.data;
      const pending = message && Number.isSafeInteger(message.id)
        ? this.pending.get(message.id)
        : null;
      if (!pending) {
        return;
      }
      if (message.type === "progress") {
        pending.onProgress(message.percent === null
          ? message.message
          : `${message.message} ${Math.round(message.percent)}%`);
        return;
      }
      this.pending.delete(message.id);
      if (message.type === "result") {
        pending.resolve(message.chunks);
      } else {
        pending.reject(new Error(`本地 Whisper 识别失败：${message.message}`));
      }
    });
    worker.addEventListener("error", () => {
      this.rejectAll("本地 Whisper 后台线程意外停止，请重新加载插件后再试。");
      this.stopWorker();
    });
    this.worker = worker;
    return worker;
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
    this.rejectAll("本地 Whisper 已停止。");
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private async prepareRuntime(onProgress: (message: string) => void): Promise<string> {
    await mkdir(this.cacheFolder, { recursive: true });
    const assets = [];
    for (const [index, asset] of WHISPER_RUNTIME_ASSETS.entries()) {
      const filePath = join(this.cacheFolder, asset.fileName);
      if (!await this.verifyFile(filePath, asset.sha256)) {
        onProgress(`首次使用：正在下载本地识别运行环境 ${index + 1}/${WHISPER_RUNTIME_ASSETS.length}…`);
        await this.download(asset.url, filePath, asset.maxBytes, asset.sha256);
      }
      assets.push({ filePath, fileName: asset.fileName, contentType: asset.contentType });
    }
    return this.localAssetServer.exposeLocalAssets(assets);
  }

  private async verifyFile(filePath: string, expectedHash: string): Promise<boolean> {
    try {
      const info = await stat(filePath);
      if (!info.isFile() || info.size <= 0) {
        return false;
      }
      const hash = createHash("sha256");
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.once("error", reject);
        stream.once("end", resolve);
      });
      return hash.digest("hex") === expectedHash;
    } catch {
      return false;
    }
  }

  private async download(
    url: string,
    destination: string,
    maximumBytes: number,
    expectedHash: string
  ): Promise<void> {
    const partial = `${destination}.part`;
    await rm(partial, { force: true });
    await new Promise<void>((resolve, reject) => {
      const request = httpsGet(url, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`本地 Whisper 运行文件下载失败（HTTP ${response.statusCode ?? 0}）。`));
          return;
        }
        const output = createWriteStream(partial, { flags: "wx" });
        let downloaded = 0;
        response.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (downloaded > maximumBytes) {
            request.destroy(new Error("本地 Whisper 运行文件超过安全大小限制。"));
          }
        });
        response.once("error", reject);
        output.once("error", reject);
        output.once("finish", () => {
          output.close(() => {
            void rm(destination, { force: true })
              .then(() => rename(partial, destination))
              .then(async () => {
                if (!await this.verifyFile(destination, expectedHash)) {
                  await rm(destination, { force: true });
                  throw new Error("本地 Whisper 运行文件校验失败。");
                }
              })
              .then(resolve, reject);
          });
        });
        response.pipe(output);
      });
      request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        request.destroy(new Error("本地 Whisper 运行文件下载超时。"));
      });
      request.once("error", (error) => {
        void rm(partial, { force: true }).finally(() => reject(error));
      });
    });
  }
}
