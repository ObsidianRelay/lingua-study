import { STUDY_PROFILES, type StudyProfile } from "./study-core";

export const CUSTOM_DICTIONARY_TEMPLATE = [
  "word,phonetic,definition,translation,pos,tags",
  "dedication,ˌdedɪˈkeɪʃn,the quality of being committed,奉献,n,cet4 ielts"
].join("\n");

export const CUSTOM_DICTIONARY_TSV_TEMPLATE = [
  "word\tphonetic\tdefinition\ttranslation\tpos\ttags",
  "dedication\tˌdedɪˈkeɪʃn\tthe quality of being committed\t奉献\tn\tcet4 ielts"
].join("\n");

export const CUSTOM_DICTIONARY_JSON_TEMPLATE = JSON.stringify([
  {
    word: "dedication",
    phonetic: "ˌdedɪˈkeɪʃn",
    definition: "the quality of being committed",
    translation: "奉献",
    pos: "n",
    tags: ["cet4", "ielts"]
  }
], null, 2);

export type CustomDictionaryFormat = "csv" | "tsv" | "json";

export interface CustomDictionaryEntryInput {
  word: string;
  normalizedWord: string;
  phonetic: string;
  definition: string;
  translation: string;
  partOfSpeech: string;
  tags: StudyProfile[];
}

export interface CustomDictionaryParseResult {
  entries: CustomDictionaryEntryInput[];
  skippedRows: number;
  duplicateRows: number;
  warnings: string[];
}

const HEADER_ALIASES = {
  word: ["word", "单词"],
  phonetic: ["phonetic", "音标"],
  definition: ["definition", "english definition", "英文释义"],
  translation: ["translation", "chinese translation", "中文释义", "翻译"],
  partOfSpeech: ["pos", "part of speech", "词性"],
  tags: ["tags", "tag", "考试标签", "标签"]
} as const;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replaceAll("_", " ")
    .replace(/\s+/gu, " ");
}

function parseDelimitedRecords(
  value: string,
  delimiter: "," | "\t",
  formatLabel: "CSV" | "TSV"
): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const finishRecord = (): void => {
    record.push(field);
    if (record.some((item) => item.trim() !== "")) {
      records.push(record);
    }
    record = [];
    field = "";
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      finishRecord();
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) {
    throw new Error(`${formatLabel} 中存在未闭合的英文双引号，请检查文件格式。`);
  }
  if (field !== "" || record.length > 0) {
    finishRecord();
  }
  return records;
}

function findHeaderIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function cleanField(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "")
    .replaceAll("\r", "")
    .trim();
}

function normalizeHeadword(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’]/gu, "'")
    .trim()
    .toLocaleLowerCase("en-US");
}

function parseTags(value: string): StudyProfile[] {
  const valid = new Set<StudyProfile>();
  for (const tag of value.toLocaleLowerCase("en-US").split(/[\s,/|;]+/u)) {
    if ((STUDY_PROFILES as readonly string[]).includes(tag)) {
      valid.add(tag as StudyProfile);
    }
  }
  return [...valid];
}

interface RawDictionaryRow {
  location: string;
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  partOfSpeech: string;
  tags: string;
  invalidReason?: string;
}

function buildParseResult(
  rows: RawDictionaryRow[],
  formatLabel: CustomDictionaryFormat
): CustomDictionaryParseResult {
  const entryMap = new Map<string, CustomDictionaryEntryInput>();
  const warnings: string[] = [];
  let skippedRows = 0;
  let duplicateRows = 0;

  for (const row of rows) {
    const word = cleanField(row.word);
    const normalizedWord = normalizeHeadword(word);
    const definition = cleanField(row.definition);
    const translation = cleanField(row.translation);
    let reason = row.invalidReason ?? "";
    if (reason === "" && normalizedWord === "") {
      reason = "单词为空";
    } else if (reason === "" && normalizedWord.length > 120) {
      reason = "单词超过 120 个字符";
    } else if (reason === "" && !/^[a-z]+(?:['-][a-z]+)*$/u.test(normalizedWord)) {
      reason = "只支持单个英文单词，可包含撇号或连字符";
    } else if (reason === "" && definition === "" && translation === "") {
      reason = "英文释义和中文释义不能同时为空";
    } else if (
      reason === "" &&
      [definition, translation].some((field) => field.length > 10_000)
    ) {
      reason = "单条释义超过 10,000 个字符";
    }
    if (reason !== "") {
      skippedRows += 1;
      if (warnings.length < 5) {
        warnings.push(`${row.location}：${reason}`);
      }
      continue;
    }
    if (entryMap.has(normalizedWord)) {
      duplicateRows += 1;
    }
    entryMap.set(normalizedWord, {
      word,
      normalizedWord,
      phonetic: cleanField(row.phonetic),
      definition,
      translation,
      partOfSpeech: cleanField(row.partOfSpeech),
      tags: parseTags(cleanField(row.tags))
    });
  }

  if (entryMap.size === 0) {
    const detail = warnings[0] ? ` ${warnings[0]}` : "";
    throw new Error(`${formatLabel.toUpperCase()} 中没有可导入的有效词条。${detail}`);
  }
  return {
    entries: [...entryMap.values()],
    skippedRows,
    duplicateRows,
    warnings
  };
}

function parseCustomDictionaryDelimited(
  value: string,
  delimiter: "," | "\t",
  formatLabel: "CSV" | "TSV"
): CustomDictionaryParseResult {
  const records = parseDelimitedRecords(value, delimiter, formatLabel);
  if (records.length === 0) {
    throw new Error(`${formatLabel} 文件为空。`);
  }

  const headers = (records[0] ?? []).map(normalizeHeader);
  const wordIndex = findHeaderIndex(headers, HEADER_ALIASES.word);
  const phoneticIndex = findHeaderIndex(headers, HEADER_ALIASES.phonetic);
  const definitionIndex = findHeaderIndex(headers, HEADER_ALIASES.definition);
  const translationIndex = findHeaderIndex(headers, HEADER_ALIASES.translation);
  const partOfSpeechIndex = findHeaderIndex(headers, HEADER_ALIASES.partOfSpeech);
  const tagsIndex = findHeaderIndex(headers, HEADER_ALIASES.tags);
  if (wordIndex < 0) {
    throw new Error(`${formatLabel} 缺少 word（单词）列。`);
  }
  if (definitionIndex < 0 && translationIndex < 0) {
    throw new Error(
      `${formatLabel} 至少需要 definition（英文释义）或 translation（中文释义）列。`
    );
  }

  const getField = (row: string[], index: number): string =>
    index < 0 ? "" : row[index] ?? "";
  const rows = records.slice(1).map((row, index): RawDictionaryRow => ({
    location: `第 ${index + 2} 行`,
    word: getField(row, wordIndex),
    phonetic: getField(row, phoneticIndex),
    definition: getField(row, definitionIndex),
    translation: getField(row, translationIndex),
    partOfSpeech: getField(row, partOfSpeechIndex),
    tags: getField(row, tagsIndex)
  }));
  return buildParseResult(rows, formatLabel.toLocaleLowerCase("en-US") as "csv" | "tsv");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getJsonField(
  entry: Record<string, unknown>,
  aliases: readonly string[]
): string {
  for (const [key, value] of Object.entries(entry)) {
    if (!aliases.includes(normalizeHeader(key))) continue;
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string | number | boolean =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        )
        .map(String)
        .join(" ");
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }
    return "";
  }
  return "";
}

/** 解析用户自定义 CSV；同一单词重复出现时，以文件中最后一行为准。 */
export function parseCustomDictionaryCsv(value: string): CustomDictionaryParseResult {
  return parseCustomDictionaryDelimited(value, ",", "CSV");
}

/** TSV 使用与 CSV 相同的列名和校验规则。 */
export function parseCustomDictionaryTsv(value: string): CustomDictionaryParseResult {
  return parseCustomDictionaryDelimited(value, "\t", "TSV");
}

/** JSON 接受词条数组，也接受包含 entries 数组的对象。 */
export function parseCustomDictionaryJson(value: string): CustomDictionaryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("JSON 格式不正确，请检查括号、逗号和英文双引号。");
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.entries)
      ? parsed.entries
      : null;
  if (!entries) {
    throw new Error("JSON 顶层必须是词条数组，或包含 entries 数组的对象。");
  }
  if (entries.length === 0) {
    throw new Error("JSON 文件中没有词条。");
  }

  const rows = entries.map((entry, index): RawDictionaryRow => {
    if (!isRecord(entry)) {
      return {
        location: `第 ${index + 1} 条`,
        word: "",
        phonetic: "",
        definition: "",
        translation: "",
        partOfSpeech: "",
        tags: "",
        invalidReason: "词条必须是 JSON 对象"
      };
    }
    return {
      location: `第 ${index + 1} 条`,
      word: getJsonField(entry, HEADER_ALIASES.word),
      phonetic: getJsonField(entry, HEADER_ALIASES.phonetic),
      definition: getJsonField(entry, HEADER_ALIASES.definition),
      translation: getJsonField(entry, HEADER_ALIASES.translation),
      partOfSpeech: getJsonField(entry, HEADER_ALIASES.partOfSpeech),
      tags: getJsonField(entry, HEADER_ALIASES.tags)
    };
  });
  return buildParseResult(rows, "json");
}

export function parseCustomDictionary(
  value: string,
  format: CustomDictionaryFormat
): CustomDictionaryParseResult {
  if (format === "csv") return parseCustomDictionaryCsv(value);
  if (format === "tsv") return parseCustomDictionaryTsv(value);
  return parseCustomDictionaryJson(value);
}
