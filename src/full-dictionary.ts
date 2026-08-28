import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import JSZip from "jszip";
import { STUDY_PROFILES, type StudyProfile } from "./study-core";

const PACKAGE_VERSION = 1;
const SOURCE_REVISION = "bc015ed2e24a";
const SOURCE_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf";
const SOURCE_URL =
  `https://raw.githubusercontent.com/skywind3000/ECDICT/${SOURCE_REVISION}/ecdict.csv`;
const RELEASE_ARCHIVE_NAME = `ecdict-${SOURCE_REVISION}.zip`;
const RELEASE_ARCHIVE_URL =
  `https://github.com/ObsidianRelay/lingua-study/releases/download/dictionary-${SOURCE_REVISION}/${RELEASE_ARCHIVE_NAME}`;
const RELEASE_ARCHIVE_SHA256 = "74e2993be40623059a10a8b605a452333d4a8d006b7d0e18186bf0ee3064d37f";
const MAX_SOURCE_BYTES = 90 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 1_000;
const MAX_DOWNLOAD_REDIRECTS = 5;
const DICTIONARY_INDEX_FILENAME = "dictionary-index.json";
const SHARD_KEYS = [..."abcdefghijklmnopqrstuvwxyz", "other"] as const;
const DICTIONARY_PACKAGE_FILES = [
  DICTIONARY_INDEX_FILENAME,
  ...SHARD_KEYS.map((key) => `${key}.json.gz`)
] as const;
const gzipAsync = promisify(gzip);

export interface DownloadProgress {
  received: number;
  total: number;
  bytesPerSecond: number;
}

export interface ResumableDownloadOptions {
  url: string;
  targetPath: string;
  maxBytes: number;
  expectedSha256: string;
  attempts?: number;
  retryBaseDelayMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onRetry?: (attempt: number, error: Error) => void;
}

type PackedDictionaryEntry = [
  word: string,
  phonetic: string,
  definition: string,
  translation: string,
  pos: string,
  tags: StudyProfile[],
  bnc: number,
  frequency: number,
  exchange: string
];

export interface FullDictionaryManifest {
  version: 1;
  project: "skywind3000/ECDICT";
  revision: string;
  sourceSha256: string;
  entryCount: number;
  aliasCount: number;
  compressedBytes: number;
  installedAt: string;
}

export interface FullDictionaryStatus {
  installed: boolean;
  manifest: FullDictionaryManifest | null;
  cacheFolder: string;
}

export interface FullDictionaryInstallResult {
  manifest: FullDictionaryManifest;
  shardFolder: string;
}

export function getFullDictionaryCacheFolder(
  platform = process.platform,
  homeDirectory = homedir(),
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Caches", "Lingua Study", "Dictionary");
  }
  if (platform === "win32") {
    const base = environment.LOCALAPPDATA || join(homeDirectory, "AppData", "Local");
    return join(base, "Lingua Study", "Cache", "Dictionary");
  }
  const base = environment.XDG_CACHE_HOME || join(homeDirectory, ".cache");
  return join(base, "lingua-study", "dictionary");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFullDictionaryManifest(value: unknown): FullDictionaryManifest | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.version !== PACKAGE_VERSION ||
    value.project !== "skywind3000/ECDICT" ||
    value.revision !== SOURCE_REVISION ||
    value.sourceSha256 !== SOURCE_SHA256 ||
    typeof value.entryCount !== "number" || !Number.isSafeInteger(value.entryCount) || value.entryCount < 1 ||
    typeof value.aliasCount !== "number" || !Number.isSafeInteger(value.aliasCount) || value.aliasCount < 0 ||
    typeof value.compressedBytes !== "number" || !Number.isSafeInteger(value.compressedBytes) || value.compressedBytes < 1 ||
    typeof value.installedAt !== "string" || Number.isNaN(Date.parse(value.installedAt))
  ) {
    return null;
  }
  return value as unknown as FullDictionaryManifest;
}

class DownloadHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`HTTP ${statusCode}`);
    this.name = "DownloadHttpError";
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const input = createReadStream(path);
  for await (const chunk of input) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

function parseTotalBytes(response: IncomingMessage, offset: number): number {
  const contentRange = response.headers["content-range"];
  if (typeof contentRange === "string") {
    const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/iu.exec(contentRange);
    if (match?.[3] && match[3] !== "*") {
      return Number.parseInt(match[3], 10) || 0;
    }
  }
  const contentLength = Number.parseInt(response.headers["content-length"] ?? "0", 10) || 0;
  return contentLength > 0 ? offset + contentLength : 0;
}

async function downloadAttempt(
  urlText: string,
  targetPath: string,
  maxBytes: number,
  onProgress: (progress: DownloadProgress) => void,
  redirectCount = 0
): Promise<void> {
  if (redirectCount > MAX_DOWNLOAD_REDIRECTS) {
    throw new Error("词典下载重定向次数过多。");
  }
  const url = new URL(urlText);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("词典下载地址必须使用 HTTPS。");
  }
  const offset = await fileSize(targetPath);
  if (offset > maxBytes) {
    await rm(targetPath, { force: true });
    throw new Error("未完成的词典文件超过安全大小限制，已删除后重新下载。");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const headers: Record<string, string> = {
      "Accept-Encoding": "identity",
      "User-Agent": "Lingua-Study/1.2"
    };
    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
    }
    const getter = url.protocol === "https:" ? httpsGet : httpGet;
    const request = getter(url, { headers }, (response) => {
      const statusCode = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          finish(new Error("词典下载服务器返回了无效重定向。"));
          return;
        }
        void downloadAttempt(
          new URL(location, url).toString(),
          targetPath,
          maxBytes,
          onProgress,
          redirectCount + 1
        ).then(() => finish(), (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
        return;
      }
      if (statusCode === 416 && offset > 0) {
        response.resume();
        void rm(targetPath, { force: true })
          .then(() => downloadAttempt(url.toString(), targetPath, maxBytes, onProgress, redirectCount))
          .then(() => finish(), (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
        return;
      }
      if (statusCode !== 200 && statusCode !== 206) {
        response.resume();
        finish(new DownloadHttpError(statusCode));
        return;
      }

      const startOffset = statusCode === 206 ? offset : 0;
      if (statusCode === 206) {
        const contentRange = response.headers["content-range"];
        const match = typeof contentRange === "string" ? /bytes\s+(\d+)-/iu.exec(contentRange) : null;
        if (!match?.[1] || Number.parseInt(match[1], 10) !== offset) {
          response.resume();
          finish(new Error("词典下载服务器返回了无效的断点位置。"));
          return;
        }
      }
      const total = parseTotalBytes(response, startOffset);
      if (total > maxBytes) {
        response.destroy();
        finish(new Error("远程词典文件超过安全大小限制，已停止下载。"));
        return;
      }
      const output = createWriteStream(targetPath, { flags: statusCode === 206 ? "a" : "w" });
      const startedAt = Date.now();
      let attemptBytes = 0;
      const fail = (error: Error): void => {
        response.destroy();
        output.destroy();
        finish(error);
      };
      response.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => fail(new Error("词典下载超时，已保留当前进度。")));
      response.on("data", (chunk: Buffer) => {
        attemptBytes += chunk.byteLength;
        const received = startOffset + attemptBytes;
        if (received > maxBytes) {
          fail(new Error("远程词典文件超过安全大小限制，已停止下载。"));
          return;
        }
        const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1_000);
        onProgress({ received, total, bytesPerSecond: attemptBytes / elapsedSeconds });
      });
      response.once("error", fail);
      output.once("error", fail);
      output.once("finish", () => finish());
      response.pipe(output);
    });
    request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => request.destroy(new Error("连接词典下载服务器超时，已保留当前进度。")));
    request.once("error", (error) => finish(error));
  });
}

/** 支持 HTTP Range 断点续传、重定向和校验的通用下载器。 */
export async function downloadFileWithResume(options: ResumableDownloadOptions): Promise<{
  sha256: string;
  bytes: number;
}> {
  const attempts = Math.max(1, options.attempts ?? DOWNLOAD_ATTEMPTS);
  const retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DOWNLOAD_RETRY_BASE_DELAY_MS);
  await mkdir(dirname(options.targetPath), { recursive: true });
  const existingBytes = await fileSize(options.targetPath);
  if (existingBytes > 0 && existingBytes <= options.maxBytes) {
    const existingSha256 = await sha256File(options.targetPath);
    if (existingSha256 === options.expectedSha256) {
      options.onProgress?.({ received: existingBytes, total: existingBytes, bytesPerSecond: 0 });
      return { sha256: existingSha256, bytes: existingBytes };
    }
  }

  let lastError: Error = new Error("词典下载失败。");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadAttempt(
        options.url,
        options.targetPath,
        options.maxBytes,
        (progress) => options.onProgress?.(progress)
      );
      const bytes = await fileSize(options.targetPath);
      const sha256 = await sha256File(options.targetPath);
      if (sha256 !== options.expectedSha256) {
        await rm(options.targetPath, { force: true });
        throw new Error("词典文件校验失败，已删除损坏文件。");
      }
      return { sha256, bytes };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError instanceof DownloadHttpError && lastError.statusCode >= 400 && lastError.statusCode < 500 && ![408, 429].includes(lastError.statusCode)) {
        break;
      }
      if (attempt < attempts) {
        options.onRetry?.(attempt + 1, lastError);
        await delay(retryBaseDelayMs * (2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current.replace(/\r$/u, ""));
  return fields;
}

function normalizeWord(value: string): string {
  return value.normalize("NFKC").replace(/[’]/gu, "'").trim().toLocaleLowerCase("en-US");
}

function cleanField(value: string): string {
  return value.replaceAll("\\n", "\n").replaceAll("\\r", "").trim();
}

function positiveRank(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function shardKey(word: string): string {
  const first = word[0] ?? "";
  return /^[a-z]$/u.test(first) ? first : "other";
}

function parseExchange(value: string): string[] {
  const forms: string[] = [];
  for (const part of value.split("/")) {
    const separator = part.indexOf(":");
    if (separator < 1 || !/^[01spdi3rt]$/u.test(part.slice(0, separator))) {
      continue;
    }
    const form = normalizeWord(part.slice(separator + 1));
    if (form !== "" && /^[a-z][a-z'.-]*$/u.test(form)) {
      forms.push(form);
    }
  }
  return forms;
}

async function writeWithBackpressure(stream: WriteStream, value: string): Promise<void> {
  if (!stream.write(value)) {
    await once(stream, "drain");
  }
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  stream.end();
  await once(stream, "finish");
}

async function readJsonLines(
  path: string,
  onLine: (value: unknown) => void
): Promise<void> {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() !== "") {
      onLine(JSON.parse(line) as unknown);
    }
  }
}

/** 把官方 CSV 转换为按首字母加载的本地压缩包；一次只在内存中处理一个分片。 */
export async function buildFullDictionaryPackage(
  sourcePath: string,
  outputFolder: string,
  onProgress: (message: string) => void = () => undefined
): Promise<FullDictionaryManifest> {
  const workingFolder = join(outputFolder, "working");
  await rm(workingFolder, { recursive: true, force: true });
  await mkdir(workingFolder, { recursive: true });

  const entryStreams = new Map<string, WriteStream>();
  const aliasStreams = new Map<string, WriteStream>();
  for (const key of SHARD_KEYS) {
    entryStreams.set(key, createWriteStream(join(workingFolder, `${key}.entries.ndjson`)));
    aliasStreams.set(key, createWriteStream(join(workingFolder, `${key}.aliases.ndjson`)));
  }

  let sourceRows = 0;
  const input = createInterface({
    input: createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let headerSeen = false;
  try {
    for await (const line of input) {
      if (!headerSeen) {
        headerSeen = true;
        continue;
      }
      const fields = parseCsvLine(line);
      if (fields.length < 13) {
        continue;
      }
      const [rawWord = "", phonetic = "", definition = "", translation = "", pos = "",
        , , rawTags = "", bnc = "", frq = "", exchange = ""] = fields;
      const word = cleanField(rawWord);
      const normalized = normalizeWord(word);
      const chinese = cleanField(translation);
      const english = cleanField(definition);
      if (
        normalized === "" || normalized.length > 120 ||
        (chinese === "" && english === "") ||
        !/^[a-z][a-z0-9'’().,&/+ -]*$/iu.test(word)
      ) {
        continue;
      }
      const tags = rawTags.trim().split(/\s+/u).filter(
        (tag): tag is StudyProfile => (STUDY_PROFILES as readonly string[]).includes(tag)
      );
      const cleanedExchange = cleanField(exchange);
      const packed: PackedDictionaryEntry = [
        word,
        cleanField(phonetic),
        english,
        chinese,
        cleanField(pos),
        tags,
        positiveRank(bnc),
        positiveRank(frq),
        cleanedExchange
      ];
      await writeWithBackpressure(
        entryStreams.get(shardKey(normalized))!,
        `${JSON.stringify([normalized, packed])}\n`
      );
      for (const form of parseExchange(cleanedExchange)) {
        if (form !== normalized) {
          await writeWithBackpressure(
            aliasStreams.get(shardKey(form))!,
            `${JSON.stringify([form, normalized])}\n`
          );
        }
      }
      sourceRows += 1;
      if (sourceRows % 25_000 === 0) {
        onProgress(`正在整理完整版词典… 已处理 ${sourceRows.toLocaleString()} 条`);
      }
    }
  } finally {
    await Promise.all([
      ...[...entryStreams.values()].map(closeWriteStream),
      ...[...aliasStreams.values()].map(closeWriteStream)
    ]);
  }

  let entryCount = 0;
  let aliasCount = 0;
  let compressedBytes = 0;
  for (const [index, key] of SHARD_KEYS.entries()) {
    onProgress(`正在生成词典索引… ${index + 1}/${SHARD_KEYS.length}`);
    // 词典单词会直接作为对象键名。使用无原型对象，避免 `constructor`
    // 等合法英文单词误命中 Object.prototype 上的内置属性。
    const entries = Object.create(null) as Record<string, PackedDictionaryEntry>;
    const aliases = Object.create(null) as Record<string, string>;
    await readJsonLines(join(workingFolder, `${key}.entries.ndjson`), (value) => {
      if (!Array.isArray(value) || typeof value[0] !== "string" || !Array.isArray(value[1])) {
        return;
      }
      const normalized = value[0];
      const packed = value[1] as PackedDictionaryEntry;
      const existing = entries[normalized];
      if (!existing || JSON.stringify(packed).length > JSON.stringify(existing).length) {
        entries[normalized] = packed;
      }
    });
    await readJsonLines(join(workingFolder, `${key}.aliases.ndjson`), (value) => {
      if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string") {
        aliases[value[0]] ??= value[1];
      }
    });
    for (const direct of Object.keys(entries)) {
      delete aliases[direct];
    }
    entryCount += Object.keys(entries).length;
    aliasCount += Object.keys(aliases).length;
    const compressed = await gzipAsync(JSON.stringify({ entries, aliases }), { level: 9 });
    compressedBytes += compressed.byteLength;
    await writeFile(join(outputFolder, `${key}.json.gz`), compressed);
  }

  const manifest: FullDictionaryManifest = {
    version: PACKAGE_VERSION,
    project: "skywind3000/ECDICT",
    revision: SOURCE_REVISION,
    sourceSha256: SOURCE_SHA256,
    entryCount,
    aliasCount,
    compressedBytes,
    installedAt: new Date().toISOString()
  };
  await writeFile(
    join(outputFolder, DICTIONARY_INDEX_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await rm(workingFolder, { recursive: true, force: true });
  return manifest;
}

/** 把已生成的 27 个分片打包为可作为 GitHub Release 资源的标准 ZIP。 */
export async function createFullDictionaryArchive(
  packageFolder: string,
  archivePath: string
): Promise<{ sha256: string; bytes: number }> {
  const manifest = await verifyFullDictionaryPackage(packageFolder);
  if (!manifest) {
    throw new Error("完整版词典目录不完整，无法生成发布包。");
  }
  const archive = new JSZip();
  const fixedDate = new Date("1980-01-01T00:00:00.000Z");
  for (const fileName of DICTIONARY_PACKAGE_FILES) {
    archive.file(fileName, await readFile(join(packageFolder, fileName)), {
      binary: true,
      compression: "STORE",
      date: fixedDate,
      createFolders: false
    });
  }
  const output = await archive.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    platform: "UNIX",
    streamFiles: true
  });
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, output);
  return {
    sha256: createHash("sha256").update(output).digest("hex"),
    bytes: output.byteLength
  };
}

export async function extractFullDictionaryArchive(
  archivePath: string,
  outputFolder: string
): Promise<FullDictionaryManifest> {
  const archiveBytes = await readFile(archivePath);
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("词典 ZIP 超过 40 MB 安全限制。");
  }
  const archive = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
  const allowedFiles = new Set<string>(DICTIONARY_PACKAGE_FILES);
  const unexpected = Object.values(archive.files).find(
    (entry) => !entry.dir && !allowedFiles.has(entry.name)
  );
  if (unexpected) {
    throw new Error(`词典 ZIP 包含未知文件：${unexpected.name}`);
  }
  await mkdir(outputFolder, { recursive: true });
  for (const fileName of DICTIONARY_PACKAGE_FILES) {
    const entry = archive.file(fileName);
    if (!entry) {
      throw new Error(`词典 ZIP 缺少文件：${fileName}`);
    }
    const bytes = await entry.async("nodebuffer");
    await writeFile(join(outputFolder, fileName), bytes);
  }
  const manifest = await verifyFullDictionaryPackage(outputFolder);
  if (!manifest) {
    throw new Error("词典 ZIP 内容不完整或版本不匹配。");
  }
  return manifest;
}

async function readDictionaryIndex(folder: string): Promise<{
  fileName: string;
  manifest: FullDictionaryManifest;
} | null> {
  const fileNames = await readdir(folder);
  const candidates = [
    DICTIONARY_INDEX_FILENAME,
    ...fileNames.filter((fileName) =>
      fileName.endsWith(".json") && fileName !== DICTIONARY_INDEX_FILENAME
    )
  ];
  for (const fileName of candidates) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(folder, fileName), "utf8"));
      const manifest = validateFullDictionaryManifest(parsed);
      if (manifest) {
        return { fileName, manifest };
      }
    } catch {
      // 继续检查其他 JSON 文件；旧版缓存索引会在验证成功后自动迁移。
    }
  }
  return null;
}

export async function verifyFullDictionaryPackage(
  folder: string
): Promise<FullDictionaryManifest | null> {
  try {
    const index = await readDictionaryIndex(folder);
    if (!index) {
      return null;
    }
    await Promise.all(SHARD_KEYS.map((key) => stat(join(folder, `${key}.json.gz`))));
    if (index.fileName !== DICTIONARY_INDEX_FILENAME) {
      try {
        await rename(
          join(folder, index.fileName),
          join(folder, DICTIONARY_INDEX_FILENAME)
        );
      } catch {
        // 只读缓存仍然可以继续使用；下次重新安装时会生成新的专用索引名。
      }
    }
    return index.manifest;
  } catch {
    return null;
  }
}

function formatDownloadStatus(label: string, progress: DownloadProgress): string {
  const received = `${(progress.received / 1024 / 1024).toFixed(1)} MB`;
  const speed = progress.bytesPerSecond >= 1024 * 1024
    ? `${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
    : `${Math.max(0, Math.round(progress.bytesPerSecond / 1024))} KB/s`;
  if (progress.total <= 0) {
    return `${label}… ${received} · ${speed}`;
  }
  const percent = Math.min(99, Math.round(progress.received / progress.total * 100));
  const remainingSeconds = progress.bytesPerSecond > 0
    ? Math.max(0, Math.ceil((progress.total - progress.received) / progress.bytesPerSecond))
    : 0;
  const eta = remainingSeconds > 0 ? ` · 约 ${remainingSeconds} 秒` : "";
  return `${label}… ${percent}%（${received} · ${speed}${eta}）`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class FullDictionaryService {
  private manifest: FullDictionaryManifest | null = null;
  private activeInstall: Promise<FullDictionaryInstallResult> | null = null;

  constructor(readonly cacheFolder = getFullDictionaryCacheFolder()) {}

  async initialize(): Promise<FullDictionaryStatus> {
    this.manifest = await verifyFullDictionaryPackage(this.cacheFolder);
    return this.getStatus();
  }

  getStatus(): FullDictionaryStatus {
    return { installed: this.manifest !== null, manifest: this.manifest, cacheFolder: this.cacheFolder };
  }

  getShardFolder(): string | null {
    return this.manifest ? this.cacheFolder : null;
  }

  install(onProgress: (message: string) => void): Promise<FullDictionaryInstallResult> {
    if (this.activeInstall) {
      return this.activeInstall;
    }
    this.activeInstall = this.performRemoteInstall(onProgress).finally(() => {
      this.activeInstall = null;
    });
    return this.activeInstall;
  }

  async clear(): Promise<void> {
    if (this.activeInstall) {
      throw new Error("完整版词典正在安装，请等待当前任务完成后再删除。");
    }
    await rm(this.cacheFolder, { recursive: true, force: true });
    this.manifest = null;
  }

  async openCacheFolder(): Promise<void> {
    await mkdir(this.cacheFolder, { recursive: true });
    const command = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [this.cacheFolder], { detached: true, shell: false, stdio: "ignore", windowsHide: true });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
  }

  private async performRemoteInstall(
    onProgress: (message: string) => void
  ): Promise<FullDictionaryInstallResult> {
    const staging = `${this.cacheFolder}.installing`;
    const downloadFolder = `${this.cacheFolder}.downloads`;
    const archivePath = join(downloadFolder, `${RELEASE_ARCHIVE_NAME}.part`);
    const sourcePath = join(downloadFolder, `ecdict-${SOURCE_REVISION}.csv.part`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await mkdir(downloadFolder, { recursive: true });
    try {
      if (/^[0-9a-f]{64}$/u.test(RELEASE_ARCHIVE_SHA256)) {
        try {
          onProgress("正在下载预生成词典包…");
          await downloadFileWithResume({
            url: RELEASE_ARCHIVE_URL,
            targetPath: archivePath,
            maxBytes: MAX_ARCHIVE_BYTES,
            expectedSha256: RELEASE_ARCHIVE_SHA256,
            onProgress: (progress) => onProgress(formatDownloadStatus("正在下载词典包", progress)),
            onRetry: (attempt) => onProgress(`词典包连接中断，正在进行第 ${attempt}/${DOWNLOAD_ATTEMPTS} 次尝试…`)
          });
          onProgress("下载完成，正在校验并解压词典包…");
          const manifest = await extractFullDictionaryArchive(archivePath, staging);
          const result = await this.activateStaging(staging, manifest);
          await rm(archivePath, { force: true });
          return result;
        } catch {
          onProgress("预生成词典包暂不可用，已自动切换到 ECDICT 官方源…");
          await rm(staging, { recursive: true, force: true });
          await mkdir(staging, { recursive: true });
        }
      }

      onProgress("正在下载 ECDICT 官方完整版…");
      await downloadFileWithResume({
        url: SOURCE_URL,
        targetPath: sourcePath,
        maxBytes: MAX_SOURCE_BYTES,
        expectedSha256: SOURCE_SHA256,
        onProgress: (progress) => onProgress(formatDownloadStatus("正在下载官方 CSV", progress)),
        onRetry: (attempt) => onProgress(`下载中断，已保留进度；正在进行第 ${attempt}/${DOWNLOAD_ATTEMPTS} 次尝试…`)
      });
      onProgress("下载完成，正在生成本地索引…");
      const manifest = await buildFullDictionaryPackage(sourcePath, staging, onProgress);
      const result = await this.activateStaging(staging, manifest);
      await rm(sourcePath, { force: true });
      return result;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async activateStaging(
    staging: string,
    expectedManifest: FullDictionaryManifest
  ): Promise<FullDictionaryInstallResult> {
    const verified = await verifyFullDictionaryPackage(staging);
    if (!verified || verified.sourceSha256 !== expectedManifest.sourceSha256) {
      throw new Error("生成的词典索引校验失败，未替换已安装词典。");
    }
    const backup = `${this.cacheFolder}.backup`;
    await rm(backup, { recursive: true, force: true });
    const hadExisting = await pathExists(this.cacheFolder);
    if (hadExisting) {
      await rename(this.cacheFolder, backup);
    }
    try {
      await rename(staging, this.cacheFolder);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (hadExisting && await pathExists(backup)) {
        await rename(backup, this.cacheFolder);
      }
      throw error;
    }
    this.manifest = verified;
    return { manifest: verified, shardFolder: this.cacheFolder };
  }
}
