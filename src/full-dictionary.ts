import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { STUDY_PROFILES, type StudyProfile } from "./study-core";

const PACKAGE_VERSION = 1;
const SOURCE_REVISION = "bc015ed2e24a";
const SOURCE_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf";
const SOURCE_URL =
  `https://raw.githubusercontent.com/skywind3000/ECDICT/${SOURCE_REVISION}/ecdict.csv`;
const MAX_SOURCE_BYTES = 90 * 1024 * 1024;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const SHARD_KEYS = [..."abcdefghijklmnopqrstuvwxyz", "other"] as const;
const gzipAsync = promisify(gzip);

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
  await writeFile(join(outputFolder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rm(workingFolder, { recursive: true, force: true });
  return manifest;
}

async function verifyPackage(folder: string): Promise<FullDictionaryManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
    const manifest = validateFullDictionaryManifest(parsed);
    if (!manifest) {
      return null;
    }
    await Promise.all(SHARD_KEYS.map((key) => stat(join(folder, `${key}.json.gz`))));
    return manifest;
  } catch {
    return null;
  }
}

export class FullDictionaryService {
  readonly cacheFolder = getFullDictionaryCacheFolder();
  private manifest: FullDictionaryManifest | null = null;
  private activeInstall: Promise<FullDictionaryInstallResult> | null = null;

  async initialize(): Promise<FullDictionaryStatus> {
    this.manifest = await verifyPackage(this.cacheFolder);
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
    this.activeInstall = this.performInstall(onProgress).finally(() => {
      this.activeInstall = null;
    });
    return this.activeInstall;
  }

  async clear(): Promise<void> {
    if (this.activeInstall) {
      throw new Error("完整版词典正在下载，请等待当前任务完成后再删除。");
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

  private async performInstall(
    onProgress: (message: string) => void
  ): Promise<FullDictionaryInstallResult> {
    const staging = `${this.cacheFolder}.installing`;
    const sourcePath = join(staging, "ecdict.csv");
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      onProgress("正在下载 ECDICT 官方完整版…");
      const downloaded = await this.downloadSource(sourcePath, (received, total) => {
        const size = `${(received / 1024 / 1024).toFixed(1)} MB`;
        onProgress(total > 0 ? `正在下载完整版词典… ${Math.min(99, Math.round(received / total * 100))}%（${size}）` : `正在下载完整版词典… ${size}`);
      });
      if (downloaded.sha256 !== SOURCE_SHA256) {
        throw new Error("词典文件校验失败，已停止安装；请检查网络后重试。");
      }
      onProgress("下载完成，正在生成本地索引…");
      const manifest = await buildFullDictionaryPackage(sourcePath, staging, onProgress);
      await rm(sourcePath, { force: true });
      await rm(this.cacheFolder, { recursive: true, force: true });
      await rename(staging, this.cacheFolder);
      this.manifest = manifest;
      return { manifest, shardFolder: this.cacheFolder };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async downloadSource(
    targetPath: string,
    onProgress: (received: number, total: number) => void
  ): Promise<{ sha256: string; bytes: number }> {
    return new Promise((resolve, reject) => {
      const request = httpsGet(SOURCE_URL, { headers: { "User-Agent": "Lingua-Study/1.1" } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`完整版词典下载失败（HTTP ${response.statusCode ?? "未知"}）。`));
          return;
        }
        const total = Number.parseInt(response.headers["content-length"] ?? "0", 10) || 0;
        if (total > MAX_SOURCE_BYTES) {
          response.destroy();
          reject(new Error("远程词典文件异常，大小超过 90 MB，已停止下载。"));
          return;
        }
        const output = createWriteStream(targetPath, { flags: "wx" });
        const hash = createHash("sha256");
        let bytes = 0;
        let settled = false;
        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          response.destroy();
          output.destroy();
          reject(error);
        };
        response.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => fail(new Error("词典下载超时，请检查网络后重试。")));
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_SOURCE_BYTES) {
            fail(new Error("远程词典文件异常，大小超过 90 MB，已停止下载。"));
            return;
          }
          hash.update(chunk);
          onProgress(bytes, total);
        });
        response.once("error", fail);
        output.once("error", fail);
        output.once("finish", () => {
          if (settled) return;
          settled = true;
          resolve({ sha256: hash.digest("hex"), bytes });
        });
        response.pipe(output);
      });
      request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => request.destroy(new Error("连接词典下载服务器超时。")));
      request.once("error", reject);
    });
  }
}
