import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import {
  parseCustomDictionary,
  type CustomDictionaryFormat,
  type CustomDictionaryEntryInput
} from "./custom-dictionary-core";
import type { StudyProfile } from "./study-core";

const CUSTOM_DICTIONARY_VERSION = 1;
const CUSTOM_DICTIONARY_INDEX_FILENAME = "custom-dictionary-index.json";
const MAX_CUSTOM_DICTIONARY_BYTES = 100 * 1024 * 1024;
const MAX_CUSTOM_DICTIONARY_ENTRIES = 1_000_000;
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

export interface CustomDictionaryManifest {
  version: 1;
  type: "lingua-study/custom-dictionary";
  sourceFileName: string;
  sourceSha256: string;
  entryCount: number;
  skippedRows: number;
  duplicateRows: number;
  compressedBytes: number;
  importedAt: string;
}

export interface CustomDictionaryStatus {
  installed: boolean;
  manifest: CustomDictionaryManifest | null;
  cacheFolder: string;
}

export interface CustomDictionaryInstallResult {
  manifest: CustomDictionaryManifest;
  warnings: string[];
}

export function getCustomDictionaryCacheFolder(
  platform = process.platform,
  homeDirectory = homedir(),
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Caches", "Lingua Study", "Custom Dictionary");
  }
  if (platform === "win32") {
    const base = environment.LOCALAPPDATA || join(homeDirectory, "AppData", "Local");
    return join(base, "Lingua Study", "Cache", "Custom Dictionary");
  }
  const base = environment.XDG_CACHE_HOME || join(homeDirectory, ".cache");
  return join(base, "lingua-study", "custom-dictionary");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCustomDictionaryManifest(value: unknown): CustomDictionaryManifest | null {
  if (!isRecord(value) ||
    value.version !== CUSTOM_DICTIONARY_VERSION ||
    value.type !== "lingua-study/custom-dictionary" ||
    typeof value.sourceFileName !== "string" || value.sourceFileName === "" ||
    typeof value.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceSha256) ||
    typeof value.entryCount !== "number" || !Number.isSafeInteger(value.entryCount) || value.entryCount < 1 ||
    typeof value.skippedRows !== "number" || !Number.isSafeInteger(value.skippedRows) || value.skippedRows < 0 ||
    typeof value.duplicateRows !== "number" || !Number.isSafeInteger(value.duplicateRows) || value.duplicateRows < 0 ||
    typeof value.compressedBytes !== "number" || !Number.isSafeInteger(value.compressedBytes) || value.compressedBytes < 1 ||
    typeof value.importedAt !== "string" || Number.isNaN(Date.parse(value.importedAt))) {
    return null;
  }
  return value as unknown as CustomDictionaryManifest;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function safeSourceFileName(value: string): string {
  const rawName = value.split(/[\\/]/u).at(-1) ?? "";
  const name = [...rawName].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? "_" : character;
  }).join("").trim();
  return name.slice(0, 200) || "custom-dictionary.csv";
}

function shardKey(word: string): string {
  const first = word[0] ?? "";
  return /^[a-z]$/u.test(first) ? first : "other";
}

function getCustomDictionaryFormat(fileName: string): CustomDictionaryFormat | null {
  const normalized = fileName.toLocaleLowerCase("en-US");
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".tsv")) return "tsv";
  if (normalized.endsWith(".json")) return "json";
  return null;
}

function packEntry(entry: CustomDictionaryEntryInput): PackedDictionaryEntry {
  return [
    entry.word,
    entry.phonetic,
    entry.definition,
    entry.translation,
    entry.partOfSpeech,
    entry.tags,
    0,
    0,
    ""
  ];
}

export async function verifyCustomDictionaryPackage(
  folder: string
): Promise<CustomDictionaryManifest | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(folder, CUSTOM_DICTIONARY_INDEX_FILENAME), "utf8")
    );
    const manifest = validateCustomDictionaryManifest(parsed);
    if (!manifest) {
      return null;
    }
    await Promise.all(SHARD_KEYS.map((key) => stat(join(folder, `${key}.json.gz`))));
    return manifest;
  } catch {
    return null;
  }
}

export class CustomDictionaryService {
  private manifest: CustomDictionaryManifest | null = null;
  private activeInstall: Promise<CustomDictionaryInstallResult> | null = null;

  constructor(readonly cacheFolder = getCustomDictionaryCacheFolder()) {}

  async initialize(): Promise<CustomDictionaryStatus> {
    this.manifest = await verifyCustomDictionaryPackage(this.cacheFolder);
    return this.getStatus();
  }

  getStatus(): CustomDictionaryStatus {
    return { installed: this.manifest !== null, manifest: this.manifest, cacheFolder: this.cacheFolder };
  }

  readCompressedShard(key: string): Uint8Array | null {
    if (!this.manifest || !/^(?:[a-z]|other)$/u.test(key)) {
      return null;
    }
    try {
      return readFileSync(join(this.cacheFolder, `${key}.json.gz`));
    } catch {
      return null;
    }
  }

  installFromFile(
    fileName: string,
    data: Uint8Array,
    onProgress: (message: string) => void
  ): Promise<CustomDictionaryInstallResult> {
    if (this.activeInstall) {
      return this.activeInstall;
    }
    this.activeInstall = this.performInstall(fileName, data, onProgress).finally(() => {
      this.activeInstall = null;
    });
    return this.activeInstall;
  }

  async clear(): Promise<void> {
    if (this.activeInstall) {
      throw new Error("自定义词典正在导入，请等待完成后再删除。");
    }
    await rm(this.cacheFolder, { recursive: true, force: true });
    this.manifest = null;
  }

  private async performInstall(
    fileName: string,
    data: Uint8Array,
    onProgress: (message: string) => void
  ): Promise<CustomDictionaryInstallResult> {
    const format = getCustomDictionaryFormat(fileName);
    if (!format) {
      throw new Error("请选择 CSV、TSV 或 JSON 格式的词典文件。");
    }
    if (data.byteLength === 0) {
      throw new Error("选择的词典文件为空。");
    }
    if (data.byteLength > MAX_CUSTOM_DICTIONARY_BYTES) {
      throw new Error("自定义词典文件不能超过 100 MB。");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new Error("词典文件必须使用 UTF-8 编码，请重新保存后再导入。");
    }

    onProgress(`正在检查 ${format.toUpperCase()} 格式和词条…`);
    const parsed = parseCustomDictionary(text, format);
    if (parsed.entries.length > MAX_CUSTOM_DICTIONARY_ENTRIES) {
      throw new Error(`自定义词典最多支持 ${MAX_CUSTOM_DICTIONARY_ENTRIES.toLocaleString()} 个词条。`);
    }

    const staging = `${this.cacheFolder}.installing`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      const entriesByShard = new Map<string, Record<string, PackedDictionaryEntry>>();
      for (const key of SHARD_KEYS) {
        entriesByShard.set(key, Object.create(null) as Record<string, PackedDictionaryEntry>);
      }
      for (const entry of parsed.entries) {
        entriesByShard.get(shardKey(entry.normalizedWord))![entry.normalizedWord] = packEntry(entry);
      }

      let compressedBytes = 0;
      for (const [index, key] of SHARD_KEYS.entries()) {
        onProgress(`正在生成自定义词典索引… ${index + 1}/${SHARD_KEYS.length}`);
        const compressed = await gzipAsync(JSON.stringify({
          entries: entriesByShard.get(key),
          aliases: Object.create(null) as Record<string, string>
        }), { level: 9 });
        compressedBytes += compressed.byteLength;
        await writeFile(join(staging, `${key}.json.gz`), compressed);
      }

      const manifest: CustomDictionaryManifest = {
        version: CUSTOM_DICTIONARY_VERSION,
        type: "lingua-study/custom-dictionary",
        sourceFileName: safeSourceFileName(fileName),
        sourceSha256: createHash("sha256").update(data).digest("hex"),
        entryCount: parsed.entries.length,
        skippedRows: parsed.skippedRows,
        duplicateRows: parsed.duplicateRows,
        compressedBytes,
        importedAt: new Date().toISOString()
      };
      await writeFile(
        join(staging, CUSTOM_DICTIONARY_INDEX_FILENAME),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );
      const verified = await verifyCustomDictionaryPackage(staging);
      if (!verified || verified.sourceSha256 !== manifest.sourceSha256) {
        throw new Error("自定义词典索引校验失败，原有词典未被替换。");
      }
      await this.activateStaging(staging, verified);
      return { manifest: verified, warnings: parsed.warnings };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async activateStaging(
    staging: string,
    manifest: CustomDictionaryManifest
  ): Promise<void> {
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
    this.manifest = manifest;
  }
}
