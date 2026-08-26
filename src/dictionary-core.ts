import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DICTIONARY_SHARDS, DICTIONARY_SOURCE } from "./dictionary-data.generated";
import type { StudyProfile } from "./study-core";

export type DictionaryExamTag = StudyProfile;

export interface DictionaryEntry {
  word: string;
  phonetic: string;
  englishDefinition: string;
  chineseTranslation: string;
  partOfSpeech: string;
  examTags: DictionaryExamTag[];
  bncRank: number | null;
  frequencyRank: number | null;
  inflections: Array<{
    label: string;
    value: string;
  }>;
}

export interface DictionaryLookupResult {
  query: string;
  normalizedQuery: string;
  entry: DictionaryEntry | null;
  suggestions: string[];
}

export interface DictionaryTextToken {
  text: string;
  isWord: boolean;
}

type PackedDictionaryEntry = [
  word: string,
  phonetic: string,
  definition: string,
  translation: string,
  pos: string,
  tags: DictionaryExamTag[],
  bnc: number,
  frequency: number,
  exchange: string
];

interface PackedDictionaryShard {
  entries: Record<string, PackedDictionaryEntry>;
  aliases: Record<string, string>;
}

const INFLECTION_LABELS: Readonly<Record<string, string>> = {
  "0": "原形",
  "1": "派生形式",
  s: "名词复数",
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
  "3": "第三人称单数",
  r: "比较级",
  t: "最高级"
};

export { DICTIONARY_SOURCE };

export function normalizeLookupWord(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’]/gu, "'")
    .trim()
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/gu, "")
    .replace(/'s$/iu, "")
    .toLocaleLowerCase("en-US");
}

/** 双击查词只接受一个英文词，允许常见撇号和连字符。 */
export function extractLookupWord(value: string): string | null {
  const trimmed = value.normalize("NFKC").trim();
  if (!/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u.test(trimmed)) {
    return null;
  }
  const normalized = normalizeLookupWord(trimmed);
  return normalized === "" ? null : normalized;
}

/**
 * 把字幕拆成“可查词单词”和普通文本。所有 token 重新拼接后必须与原文完全一致，
 * 因此不会改变复制结果、标点、空格或换行。
 */
export function tokenizeDictionaryText(value: string): DictionaryTextToken[] {
  const tokens: DictionaryTextToken[] = [];
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      tokens.push({ text: value.slice(cursor, index), isWord: false });
    }
    tokens.push({ text: match[0], isWord: true });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) {
    tokens.push({ text: value.slice(cursor), isWord: false });
  }
  return tokens;
}

function shardKey(word: string): string {
  const first = word[0] ?? "";
  return /^[a-z]$/u.test(first) ? first : "other";
}

function parseInflections(exchange: string): DictionaryEntry["inflections"] {
  const seen = new Set<string>();
  const inflections: DictionaryEntry["inflections"] = [];
  for (const part of exchange.split("/")) {
    const separator = part.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const code = part.slice(0, separator);
    const value = part.slice(separator + 1).trim();
    const label = INFLECTION_LABELS[code];
    const key = `${label}:${value}`;
    if (label && value !== "" && !seen.has(key)) {
      seen.add(key);
      inflections.push({ label, value });
    }
  }
  return inflections;
}

function unpackEntry(entry: PackedDictionaryEntry): DictionaryEntry {
  return {
    word: entry[0],
    phonetic: entry[1],
    englishDefinition: entry[2],
    chineseTranslation: entry[3],
    partOfSpeech: entry[4],
    examTags: entry[5],
    bncRank: entry[6] > 0 ? entry[6] : null,
    frequencyRank: entry[7] > 0 ? entry[7] : null,
    inflections: parseInflections(entry[8])
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const above = previous[rightIndex + 1] ?? 0;
      const substitution = diagonal + (left[leftIndex] === right[rightIndex] ? 0 : 1);
      previous[rightIndex + 1] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        above + 1,
        substitution
      );
      diagonal = above;
    }
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

/** 按需解压首字母分片；已经使用的分片保留在内存中，后续查询不重复解析。 */
export class OfflineDictionary {
  private readonly loaded = new Map<string, PackedDictionaryShard>();
  private readonly externalLoaded = new Map<string, PackedDictionaryShard>();
  private externalShardFolder: string | null = null;

  constructor(
    private readonly compressedShards: Readonly<Record<string, string>> = DICTIONARY_SHARDS
  ) {}

  /** 完整版词典安装或删除后切换本地分片；内置精简版始终保留。 */
  setExternalShardFolder(folder: string | null): void {
    this.externalShardFolder = folder;
    this.externalLoaded.clear();
  }

  lookup(rawQuery: string): DictionaryLookupResult {
    const query = rawQuery.trim();
    const normalizedQuery = normalizeLookupWord(query);
    if (normalizedQuery === "") {
      return { query, normalizedQuery, entry: null, suggestions: [] };
    }

    const embedded = this.lookupInSource(normalizedQuery, (key) => this.loadShard(key));
    if (embedded.entry) {
      return {
        query,
        normalizedQuery,
        entry: unpackEntry(embedded.entry),
        suggestions: []
      };
    }

    if (this.externalShardFolder) {
      const external = this.lookupInSource(normalizedQuery, (key) => this.loadExternalShard(key));
      if (external.entry) {
        return {
          query,
          normalizedQuery,
          entry: unpackEntry(external.entry),
          suggestions: []
        };
      }
      return {
        query,
        normalizedQuery,
        entry: null,
        suggestions: [...new Set([...external.suggestions, ...embedded.suggestions])].slice(0, 5)
      };
    }

    return {
      query,
      normalizedQuery,
      entry: null,
      suggestions: embedded.suggestions
    };
  }

  private lookupInSource(
    normalizedQuery: string,
    load: (key: string) => PackedDictionaryShard
  ): { entry: PackedDictionaryEntry | null; suggestions: string[] } {
    const queryShard = load(shardKey(normalizedQuery));
    const direct = queryShard.entries[normalizedQuery];
    if (direct) {
      return { entry: direct, suggestions: [] };
    }
    const lemma = queryShard.aliases[normalizedQuery];
    if (lemma) {
      const lemmaEntry = load(shardKey(lemma)).entries[lemma];
      if (lemmaEntry) {
        return { entry: lemmaEntry, suggestions: [] };
      }
    }
    return {
      entry: null,
      suggestions: this.findSuggestions(queryShard, normalizedQuery, load)
    };
  }

  private loadShard(key: string): PackedDictionaryShard {
    const existing = this.loaded.get(key);
    if (existing) {
      return existing;
    }
    const encoded = this.compressedShards[key];
    if (!encoded) {
      return { entries: {}, aliases: {} };
    }
    const parsed = JSON.parse(
      gunzipSync(Buffer.from(encoded, "base64")).toString("utf8")
    ) as PackedDictionaryShard;
    this.loaded.set(key, parsed);
    return parsed;
  }

  private loadExternalShard(key: string): PackedDictionaryShard {
    const existing = this.externalLoaded.get(key);
    if (existing) {
      return existing;
    }
    if (!this.externalShardFolder) {
      return { entries: {}, aliases: {} };
    }
    try {
      const parsed = JSON.parse(
        gunzipSync(readFileSync(join(this.externalShardFolder, `${key}.json.gz`))).toString("utf8")
      ) as PackedDictionaryShard;
      this.externalLoaded.set(key, parsed);
      return parsed;
    } catch {
      return { entries: {}, aliases: {} };
    }
  }

  private findSuggestions(
    shard: PackedDictionaryShard,
    query: string,
    load: (key: string) => PackedDictionaryShard
  ): string[] {
    const candidates = new Map<string, { label: string; score: number }>();
    for (const [word, packed] of Object.entries(shard.entries)) {
      const prefixScore = word.startsWith(query) || query.startsWith(word) ? 0 : 3;
      const distance = editDistance(word, query);
      if (prefixScore === 0 || distance <= 2) {
        candidates.set(word, { label: packed[0], score: prefixScore + distance });
      }
    }
    for (const [alias, lemma] of Object.entries(shard.aliases)) {
      const distance = editDistance(alias, query);
      if (alias.startsWith(query) || distance <= 2) {
        const label = load(shardKey(lemma)).entries[lemma]?.[0] ?? lemma;
        const current = candidates.get(lemma);
        if (!current || distance < current.score) {
          candidates.set(lemma, { label, score: distance + 1 });
        }
      }
    }
    return [...candidates.values()]
      .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))
      .slice(0, 5)
      .map((candidate) => candidate.label);
  }
}
