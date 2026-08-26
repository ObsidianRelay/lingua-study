import type { TranscriptSegment } from "./transcript-core";

export interface ImportedTranscriptRow {
  english: string;
  chinese: string;
}

export interface TimedRecognitionToken {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptAlignmentRow extends ImportedTranscriptRow {
  start: number | null;
  end: number | null;
  confidence: number;
}

export interface TranscriptAlignmentResult {
  rows: TranscriptAlignmentRow[];
  matchedCount: number;
  lowConfidenceCount: number;
  averageConfidence: number;
}

export type AlignmentTimeBoundary = "start" | "end";

export interface AlignmentTimingIssue {
  index: number;
  kind: "missing" | "invalid" | "out-of-range" | "overlap";
  message: string;
}

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:[’'][A-Za-z]+)*(?:-[A-Za-z]+(?:[’'][A-Za-z]+)*)*/gu;
const SPEAKER_PREFIX_PATTERN = /^\s*[A-Z][A-Za-z .'-]{0,40}:\s*/u;

/** 将时间固定到百分之一秒，避免播放器浮点误差进入字幕数据。 */
export function roundAlignmentTime(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/** 统一显示为 MM:SS.xx；超过一小时后显示 HH:MM:SS.xx。 */
export function formatAlignmentTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "--:--.--";
  }
  const totalHundredths = Math.round(seconds * 100);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const secondPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutePart = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const fraction = `${secondPart.toString().padStart(2, "0")}.${hundredths
    .toString()
    .padStart(2, "0")}`;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutePart.toString().padStart(2, "0")}:${fraction}`
    : `${totalMinutes.toString().padStart(2, "0")}:${fraction}`;
}

/**
 * 解析用户直接输入的字幕时间。
 * 支持 MM:SS、MM:SS.xx、HH:MM:SS 和 HH:MM:SS.xx，返回统一的百分之一秒。
 */
export function parseAlignmentTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const secondsText = parts.at(-1) ?? "";
  if (!/^\d{1,2}(?:\.\d{1,2})?$/u.test(secondsText)) {
    return null;
  }
  const seconds = Number(secondsText);
  if (!Number.isFinite(seconds) || seconds >= 60) {
    return null;
  }
  const minuteText = parts.at(-2) ?? "";
  if (!/^\d+$/u.test(minuteText)) {
    return null;
  }
  const minutes = Number(minuteText);
  if (!Number.isSafeInteger(minutes) || (parts.length === 3 && minutes >= 60)) {
    return null;
  }
  let hours = 0;
  if (parts.length === 3) {
    const hourText = parts[0] ?? "";
    if (!/^\d+$/u.test(hourText)) {
      return null;
    }
    hours = Number(hourText);
    if (!Number.isSafeInteger(hours)) {
      return null;
    }
  }
  return roundAlignmentTime(hours * 3_600 + minutes * 60 + seconds);
}

/** 汇总每一行的时间问题；每行最多返回一个，便于显示剩余问题数量。 */
export function findAlignmentTimingIssues(
  rows: readonly TranscriptAlignmentRow[],
  totalDuration: number
): AlignmentTimingIssue[] {
  const issues: AlignmentTimingIssue[] = [];
  let previousEnd: number | null = null;
  rows.forEach((row, index) => {
    const start = row.start;
    const end = row.end;
    if (start === null || end === null) {
      issues.push({ index, kind: "missing", message: `第 ${index + 1} 句还没有完整时间。` });
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      issues.push({ index, kind: "invalid", message: `第 ${index + 1} 句的开始或结束时间无效。` });
      return;
    }
    if (!Number.isFinite(totalDuration) || totalDuration <= 0 || end > totalDuration) {
      issues.push({ index, kind: "out-of-range", message: `第 ${index + 1} 句超出了音频总时长。` });
      return;
    }
    if (previousEnd !== null && start < previousEnd) {
      issues.push({ index, kind: "overlap", message: `第 ${index + 1} 句与上一句时间重叠。` });
      return;
    }
    previousEnd = end;
  });
  return issues;
}

/** 在用户记录单个边界时立即阻止越界、倒序和相邻句重叠。 */
export function validateAlignmentBoundary(
  rows: readonly TranscriptAlignmentRow[],
  index: number,
  boundary: AlignmentTimeBoundary,
  value: number,
  totalDuration: number
): string | null {
  const row = rows[index];
  if (!row || !Number.isFinite(value)) {
    return "当前时间无效，请重新定位播放器。";
  }
  if (value < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0 || value > totalDuration) {
    return `记录时间必须位于 00:00.00 至 ${formatAlignmentTime(totalDuration)} 之间。`;
  }
  if (boundary === "start") {
    const previousEnd = rows[index - 1]?.end;
    if (previousEnd !== null && previousEnd !== undefined && value < previousEnd) {
      return `开始时间不能早于上一句结束时间 ${formatAlignmentTime(previousEnd)}。`;
    }
    const nextStart = rows[index + 1]?.start;
    if (nextStart !== null && nextStart !== undefined && value >= nextStart) {
      return `开始时间必须早于下一句开始时间 ${formatAlignmentTime(nextStart)}。`;
    }
    return null;
  }
  if (row.start === null) {
    return "请先记录这一句的开始时间。";
  }
  if (value <= row.start) {
    return `结束时间必须晚于开始时间 ${formatAlignmentTime(row.start)}。`;
  }
  const nextStart = rows[index + 1]?.start;
  if (nextStart !== null && nextStart !== undefined && value > nextStart) {
    return `结束时间不能晚于下一句开始时间 ${formatAlignmentTime(nextStart)}。`;
  }
  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sentenceParts(value: string): string[] {
  const normalized = normalizeWhitespace(value);
  if (normalized === "") {
    return [];
  }
  const matches = normalized.match(/[^.!?。！？]+(?:[.!?。！？]+[”’"']?|$)/gu);
  return (matches ?? [normalized]).map(normalizeWhitespace).filter((part) => part !== "");
}

function classifyLine(value: string): "english" | "chinese" | "mixed" | "other" {
  const hasChinese = CJK_PATTERN.test(value);
  const hasEnglish = /[A-Za-z]{2}/u.test(value);
  if (hasChinese && hasEnglish) {
    return "mixed";
  }
  if (hasChinese) {
    return "chinese";
  }
  if (hasEnglish) {
    return "english";
  }
  return "other";
}

function splitTabularLine(line: string): ImportedTranscriptRow | null {
  const columns = line.split(/\t+|\s{3,}/u).map(normalizeWhitespace).filter(Boolean);
  if (columns.length < 2) {
    return null;
  }
  const english = columns.find((column) => classifyLine(column) === "english");
  const chinese = columns.find((column) => classifyLine(column) === "chinese");
  return english && chinese ? { english, chinese } : null;
}

/**
 * 把粘贴文本或文档抽取出的段落整理为可编辑的中英行。
 * 表格行优先直接配对；普通文档按照英文段落和随后出现的中文段落配对。
 */
export function parseImportedBilingualText(value: string): ImportedTranscriptRow[] {
  const lines = value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map(normalizeWhitespace)
    .filter((line) => line !== "");
  const rows: ImportedTranscriptRow[] = [];
  const pendingEnglish: string[] = [];
  const pendingChinese: string[] = [];

  const flush = (): void => {
    const count = Math.max(pendingEnglish.length, pendingChinese.length);
    for (let index = 0; index < count; index += 1) {
      rows.push({
        english: pendingEnglish[index] ?? "",
        chinese: pendingChinese[index] ?? ""
      });
    }
    pendingEnglish.length = 0;
    pendingChinese.length = 0;
  };

  for (const line of lines) {
    const tabular = splitTabularLine(line);
    if (tabular) {
      flush();
      rows.push(tabular);
      continue;
    }
    const kind = classifyLine(line);
    if (kind === "english") {
      if (pendingChinese.length > 0) {
        flush();
      }
      pendingEnglish.push(...sentenceParts(line));
    } else if (kind === "chinese") {
      pendingChinese.push(...sentenceParts(line));
      if (pendingEnglish.length > 0 && pendingChinese.length >= pendingEnglish.length) {
        flush();
      }
    } else if (kind === "mixed") {
      const boundary = line.search(CJK_PATTERN);
      const english = normalizeWhitespace(line.slice(0, boundary));
      const chinese = normalizeWhitespace(line.slice(boundary));
      if (english !== "" && chinese !== "") {
        flush();
        rows.push({ english, chinese });
      }
    }
  }
  flush();

  return rows.filter((row) => row.english !== "" || row.chinese !== "");
}

export function normalizeAlignmentWords(value: string): string[] {
  const withoutSpeaker = value.replace(SPEAKER_PREFIX_PATTERN, "");
  return (withoutSpeaker.match(ENGLISH_WORD_PATTERN) ?? []).map((word) =>
    word.toLocaleLowerCase("en-US").replace(/’/gu, "'")
  );
}

function wordDistance(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitution = (previous[rightIndex] ?? 0) +
        (left[leftIndex] === right[rightIndex] ? 0 : 1);
      current.push(Math.min(
        (previous[rightIndex + 1] ?? 0) + 1,
        (current[rightIndex] ?? 0) + 1,
        substitution
      ));
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function sequenceSimilarity(left: readonly string[], right: readonly string[]): number {
  const size = Math.max(left.length, right.length);
  return size === 0 ? 0 : Math.max(0, 1 - wordDistance(left, right) / size);
}

/** 把只有片段时间的语音识别结果近似展开为单词时间，供同一套对齐算法使用。 */
export function recognitionSegmentsToTokens(
  segments: readonly TranscriptSegment[]
): TimedRecognitionToken[] {
  const tokens: TimedRecognitionToken[] = [];
  for (const segment of segments) {
    const words = normalizeAlignmentWords(segment.text);
    if (words.length === 0) {
      continue;
    }
    const duration = Math.max(0.05, segment.end - segment.start);
    words.forEach((text, index) => {
      tokens.push({
        text,
        start: segment.start + duration * index / words.length,
        end: segment.start + duration * (index + 1) / words.length
      });
    });
  }
  return tokens;
}

/**
 * 逐句在后续语音 token 中寻找最佳单调匹配，避免重复句倒序或跨场景回跳。
 * 低于 0.35 的结果不生成虚假的时间戳，必须由用户在预览中校正。
 */
export function alignImportedRows(
  rows: readonly ImportedTranscriptRow[],
  recognitionTokens: readonly TimedRecognitionToken[]
): TranscriptAlignmentResult {
  let cursor = 0;
  const aligned: TranscriptAlignmentRow[] = [];

  for (const row of rows) {
    const sourceWords = normalizeAlignmentWords(row.english);
    if (sourceWords.length === 0) {
      aligned.push({ ...row, start: null, end: null, confidence: 0 });
      continue;
    }
    // 允许识别稿在句子之间多出较长的片头、广告或漏配段落；仍然只向后搜索，
    // 因此不会把重复句错误地倒序匹配到已经使用过的时间点。
    const lookahead = Math.max(400, sourceWords.length * 12);
    const lastStart = Math.min(
      recognitionTokens.length - 1,
      cursor + lookahead
    );
    const minimumLength = Math.max(1, Math.floor(sourceWords.length * 0.55));
    const maximumLength = Math.max(minimumLength, Math.ceil(sourceWords.length * 1.55));
    let bestStart = -1;
    let bestEnd = -1;
    let bestScore = 0;

    for (let start = cursor; start <= lastStart; start += 1) {
      for (let length = minimumLength; length <= maximumLength; length += 1) {
        const end = start + length;
        if (end > recognitionTokens.length) {
          break;
        }
        const candidate = recognitionTokens.slice(start, end).map((token) => token.text);
        const similarity = sequenceSimilarity(sourceWords, candidate);
        const distancePenalty = Math.min(0.12, Math.max(0, start - cursor) * 0.002);
        const score = similarity - distancePenalty;
        if (score > bestScore) {
          bestScore = score;
          bestStart = start;
          bestEnd = end;
        }
      }
    }

    const confidence = Math.max(0, Math.min(1, bestScore));
    if (bestStart < 0 || bestEnd <= bestStart || confidence < 0.35) {
      aligned.push({ ...row, start: null, end: null, confidence });
      continue;
    }
    const first = recognitionTokens[bestStart];
    const last = recognitionTokens[bestEnd - 1];
    aligned.push({
      ...row,
      start: first?.start ?? null,
      end: last?.end ?? null,
      confidence
    });
    cursor = bestEnd;
  }

  const matched = aligned.filter((row) => row.start !== null && row.end !== null);
  return {
    rows: aligned,
    matchedCount: matched.length,
    lowConfidenceCount: aligned.filter((row) => row.confidence < 0.6).length,
    averageConfidence: matched.length === 0
      ? 0
      : matched.reduce((sum, row) => sum + row.confidence, 0) / matched.length
  };
}

export function alignmentRowsToSegments(
  rows: readonly TranscriptAlignmentRow[]
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let previousEnd = -1;
  for (const row of rows) {
    const text = normalizeWhitespace(row.english);
    if (
      text === "" || row.start === null || row.end === null ||
      !Number.isFinite(row.start) || !Number.isFinite(row.end) ||
      row.start < 0 || row.end <= row.start || row.start < previousEnd
    ) {
      throw new Error("时间轴仍有未对齐、重叠或无效的句子，请先在预览中修正。");
    }
    segments.push({ start: row.start, end: row.end, text });
    previousEnd = row.end;
  }
  if (segments.length === 0) {
    throw new Error("没有可以保存的英文字幕。");
  }
  return segments;
}
