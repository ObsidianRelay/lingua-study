import { ungzip } from "pako";
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

export type ExternalDictionaryShardLoader = (key: string) => Uint8Array | null;

export interface ExternalDictionarySourceConfig {
  loader: ExternalDictionaryShardLoader;
  /** 完整 ECDICT 可以把自身收录的变形词重定向到 exchange 中的原形。 */
  resolveDirectInflections: boolean;
}

interface ExternalDictionarySource {
  loader: ExternalDictionaryShardLoader;
  loaded: Map<string, PackedDictionaryShard>;
  resolveDirectInflections: boolean;
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
  t: "最高级",
  x: "自定义词形"
};

/**
 * ECDICT 的 exchange 字段通常会提供 `0:原形`，但少数常见不规则词没有这项。
 * 这里只补齐无法通过词典元数据表达的高置信度关系；直接词条和用户填写的 aliases
 * 仍然拥有更高优先级，避免把普通单词误判成另一个词。
 */
const IRREGULAR_LEMMA_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  am: ["be"],
  is: ["be"],
  are: ["be"],
  was: ["be"],
  were: ["be"],
  been: ["be"],
  being: ["be"],
  has: ["have"],
  had: ["have"],
  having: ["have"],
  did: ["do"],
  done: ["do"],
  doing: ["do"],
  went: ["go"],
  gone: ["go"],
  ran: ["run"],
  driven: ["drive"],
  eaten: ["eat"],
  ate: ["eat"],
  drank: ["drink"],
  drunk: ["drink"],
  began: ["begin"],
  begun: ["begin"],
  sang: ["sing"],
  sung: ["sing"],
  swam: ["swim"],
  swum: ["swim"],
  children: ["child"],
  mice: ["mouse"],
  feet: ["foot"],
  teeth: ["tooth"],
  geese: ["goose"],
  men: ["man"],
  women: ["woman"],
  data: ["datum"],
  worse: ["bad"],
  worst: ["bad"],
  better: ["good", "well"],
  best: ["good", "well"],
  me: ["i"],
  him: ["he"],
  us: ["we"],
  his: ["he"],
  their: ["they"]
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

function parseDictionaryBaseForms(exchange: string): string[] {
  const forms: string[] = [];
  const seen = new Set<string>();
  for (const part of exchange.split("/")) {
    const separator = part.indexOf(":");
    if (separator < 1 || part.slice(0, separator) !== "0") {
      continue;
    }
    const normalized = normalizeLookupWord(part.slice(separator + 1));
    if (normalized !== "" && !seen.has(normalized)) {
      seen.add(normalized);
      forms.push(normalized);
    }
  }
  return forms;
}

function isDoubledConsonant(value: string): boolean {
  if (value.length < 2) return false;
  const last = value.at(-1) ?? "";
  return last === value.at(-2) && /^[b-df-hj-np-tv-z]$/u.test(last);
}

function addLemmaCandidate(candidates: string[], seen: Set<string>, candidate: string): void {
  if (
    candidate.length < 1 ||
    seen.has(candidate) ||
    !/^[a-z]+(?:['-][a-z]+)*$/u.test(candidate)
  ) {
    return;
  }
  seen.add(candidate);
  candidates.push(candidate);
}

/**
 * 为未提供 forms/aliases 的自定义词典生成保守的英文词形候选。
 * 候选只有在当前词典中确实存在对应原形时才会生效，不会凭空创建词条。
 */
export function inferLemmaCandidates(value: string): string[] {
  const word = normalizeLookupWord(value);
  if (word === "") return [];
  const irregular = IRREGULAR_LEMMA_CANDIDATES[word];
  if (irregular) return [...irregular];

  const candidates: string[] = [];
  const seen = new Set<string>([word]);
  const add = (candidate: string): void => addLemmaCandidate(candidates, seen, candidate);

  if (word.endsWith("ied") && word.length > 4) {
    add(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("ying") && word.length > 5) {
    add(`${word.slice(0, -4)}ie`);
  }
  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    if (isDoubledConsonant(stem)) add(stem.slice(0, -1));
    add(`${stem}e`);
    add(stem);
  }
  if (word.endsWith("ed") && word.length > 4) {
    const stem = word.slice(0, -2);
    if (isDoubledConsonant(stem)) add(stem.slice(0, -1));
    add(`${stem}e`);
    add(stem);
  }
  if (word.endsWith("ies") && word.length > 4) {
    add(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("es") && word.length > 3) {
    add(word.slice(0, -1));
    add(word.slice(0, -2));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    add(word.slice(0, -1));
  }
  if (word.endsWith("ier") && word.length > 4) {
    add(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("iest") && word.length > 5) {
    add(`${word.slice(0, -4)}y`);
  }
  if (word.endsWith("er") && word.length > 4) {
    const stem = word.slice(0, -2);
    if (isDoubledConsonant(stem)) add(stem.slice(0, -1));
    add(`${stem}e`);
    add(stem);
  }
  if (word.endsWith("est") && word.length > 5) {
    const stem = word.slice(0, -3);
    if (isDoubledConsonant(stem)) add(stem.slice(0, -1));
    add(`${stem}e`);
    add(stem);
  }
  return candidates;
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

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseCompressedShard(compressed: Uint8Array): PackedDictionaryShard {
  return JSON.parse(ungzip(compressed, { to: "string" })) as PackedDictionaryShard;
}

/** 按需解压首字母分片；已经使用的分片保留在内存中，后续查询不重复解析。 */
export class OfflineDictionary {
  private readonly loaded = new Map<string, PackedDictionaryShard>();
  private externalSources: ExternalDictionarySource[] = [];

  constructor(
    private readonly compressedShards: Readonly<Record<string, string>> = DICTIONARY_SHARDS
  ) {}

  /** 由桌面端注入完整版分片读取器；移动端仍保留内置精简版。 */
  setExternalShardLoader(loader: ExternalDictionaryShardLoader | null): void {
    this.setExternalShardLoaders(loader
      ? [{ loader, resolveDirectInflections: true }]
      : []);
  }

  /** 按优先级注入多个本地词典；自定义词典可以覆盖 ECDICT 的同名单词。 */
  setExternalShardLoaders(
    loaders: Array<ExternalDictionaryShardLoader | ExternalDictionarySourceConfig>
  ): void {
    this.externalSources = loaders.map((source) => ({
      loader: typeof source === "function" ? source : source.loader,
      loaded: new Map(),
      resolveDirectInflections: typeof source === "function"
        ? true
        : source.resolveDirectInflections
    }));
  }

  lookup(rawQuery: string): DictionaryLookupResult {
    const query = rawQuery.trim();
    const normalizedQuery = normalizeLookupWord(query);
    if (normalizedQuery === "") {
      return { query, normalizedQuery, entry: null, suggestions: [] };
    }

    const suggestions: string[] = [];
    for (const source of this.externalSources) {
      const external = this.lookupInSource(
        normalizedQuery,
        (key) => this.loadExternalShard(source, key),
        source.resolveDirectInflections
      );
      if (external.entry) {
        return {
          query,
          normalizedQuery,
          entry: unpackEntry(external.entry),
          suggestions: []
        };
      }
      suggestions.push(...external.suggestions);
    }

    const embedded = this.lookupInSource(normalizedQuery, (key) => this.loadShard(key), true);
    if (embedded.entry) {
      return {
        query,
        normalizedQuery,
        entry: unpackEntry(embedded.entry),
        suggestions: []
      };
    }

    return {
      query,
      normalizedQuery,
      entry: null,
      suggestions: [...new Set([...suggestions, ...embedded.suggestions])].slice(0, 5)
    };
  }

  private lookupInSource(
    normalizedQuery: string,
    load: (key: string) => PackedDictionaryShard,
    resolveDirectInflections: boolean
  ): { entry: PackedDictionaryEntry | null; suggestions: string[] } {
    const queryShard = load(shardKey(normalizedQuery));
    const direct = queryShard.entries[normalizedQuery];
    if (direct) {
      const resolved = this.findExistingLemma(
        resolveDirectInflections
          ? [
            ...parseDictionaryBaseForms(direct[8]),
            ...(IRREGULAR_LEMMA_CANDIDATES[normalizedQuery] ?? [])
          ]
          : parseDictionaryBaseForms(direct[8]),
        normalizedQuery,
        load
      );
      if (resolved) {
        return { entry: resolved, suggestions: [] };
      }
      return { entry: direct, suggestions: [] };
    }
    const lemma = queryShard.aliases[normalizedQuery];
    if (lemma) {
      const lemmaEntry = load(shardKey(lemma)).entries[lemma];
      if (lemmaEntry) {
        return { entry: lemmaEntry, suggestions: [] };
      }
    }
    const inferred = this.findExistingLemma(
      inferLemmaCandidates(normalizedQuery),
      normalizedQuery,
      load
    );
    if (inferred) {
      return { entry: inferred, suggestions: [] };
    }
    return {
      entry: null,
      suggestions: this.findSuggestions(queryShard, normalizedQuery, load)
    };
  }

  private findExistingLemma(
    candidates: readonly string[],
    normalizedQuery: string,
    load: (key: string) => PackedDictionaryShard
  ): PackedDictionaryEntry | null {
    for (const candidate of candidates) {
      if (candidate === normalizedQuery) continue;
      const entry = load(shardKey(candidate)).entries[candidate];
      if (entry) return entry;
    }
    return null;
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
    const parsed = parseCompressedShard(decodeBase64(encoded));
    this.loaded.set(key, parsed);
    return parsed;
  }

  private loadExternalShard(source: ExternalDictionarySource, key: string): PackedDictionaryShard {
    const existing = source.loaded.get(key);
    if (existing) {
      return existing;
    }
    try {
      const compressed = source.loader(key);
      if (!compressed) {
        return { entries: {}, aliases: {} };
      }
      const parsed = parseCompressedShard(compressed);
      source.loaded.set(key, parsed);
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
