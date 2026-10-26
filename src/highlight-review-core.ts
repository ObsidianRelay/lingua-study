/**
 * highlight-review-core.ts
 *
 * 高亮卡片复习 —— 纯逻辑层（不 import obsidian，可被 node:test 直接测试）。
 *
 * 输入：HighlightStore 里的 annotations（`book.annotations`）+ 字幕 + 机翻表
 * 输出：ReviewCard[]、复习状态迁移、队列、统计、热力图
 *
 * 设计取舍：
 * - 卡片内容完全由高亮本身推导（quote 里形如「词条：释义 讲解」的写法在导出时被拼成一条，
 *   这里用 splitQuote 反推正面词条 / 中文释义 / 讲解），所以不需要改动 Lingua Study 的数据结构。
 * - 复习状态按 annotation id 存，重导出笔记不会丢进度。
 */

/** 三档评分：忘记 / 模糊 / 记住 */
export type ReviewGrade = "forgot" | "fuzzy" | "know";

export type CardCategory = "expression" | "grammar" | "difficulty" | "other";

export type CardKind = "point" | "sentence";

/** 正面文字是从哪条规则来的（用于界面上决定要不要额外展示原文） */
export type FrontSource = "colon" | "boundary" | "quoted" | "run" | "full";

export interface CategoryMeta {
  key: CardCategory;
  label: string;
  color: string;
}

export const CATEGORY_META: Record<CardCategory, CategoryMeta> = {
  expression: { key: "expression", label: "重点表达", color: "amber" },
  grammar: { key: "grammar", label: "句型语法", color: "indigo" },
  difficulty: { key: "difficulty", label: "易错难点", color: "rose" },
  other: { key: "other", label: "其他", color: "slate" },
};

export const CATEGORY_ORDER: readonly CardCategory[] = ["expression", "grammar", "difficulty", "other"];

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptFile {
  videoId?: string;
  segments?: readonly TranscriptSegment[];
}

/** 原文 → 译文（由 *.zh-CN.translations.json 的 translations 表压平而来） */
export type TranslationTable = Record<string, string>;

/**
 * 只声明用得到的字段，结构上兼容 `HighlightAnnotation`：
 * 调用方直接传 `Object.values(book.annotations)` 即可，不需要做类型转换。
 */
export interface HighlightLike {
  id?: string;
  quote?: string;
  targetType?: string;
  categoryIds?: readonly string[];
  sourcePath?: string;
  transcriptPath?: string;
  videoId?: string;
  segmentIndex?: number;
  segmentStart?: number;
  segmentEnd?: number;
  createdAt?: string;
  updatedAt?: string;
  note?: string;
}

export interface CardContext {
  /** 命中的字幕段下标，-1 表示没有字幕上下文 */
  index: number;
  text: string;
  translation: string;
  start: number;
  end: number;
}

export interface ReviewCard {
  id: string;
  kind: CardKind;
  category: CardCategory;
  categoryLabel: string;
  /** 完整的原始高亮文本 */
  quote: string;
  /** 卡片正面（词条 / 句子） */
  front: string;
  /** 中文释义（可能为空） */
  gloss: string;
  /** 讲解 / 用法说明（可能为空） */
  explain: string;
  frontSource: FrontSource;
  sourcePath: string;
  sourceAlias: string;
  videoId: string;
  transcriptPath: string;
  segmentIndex: number;
  segmentStart: number;
  segmentEnd: number;
  createdAt: string;
  updatedAt: string;
  note: string;
  context: CardContext;
  /** 同一个字幕段上其它高亮的 id */
  relatedIds: string[];
}

export interface BuildCardsInput {
  annotations: readonly HighlightLike[];
  transcripts?: Record<string, TranscriptFile>;
  translations?: Record<string, TranslationTable>;
}

export interface BuildCardsResult {
  cards: ReviewCard[];
  warnings: string[];
}

const SECTION_TO_CATEGORY: Record<string, CardCategory> = {
  重点表达: "expression",
  表达: "expression",
  亮点表达: "expression",
  句型语法: "grammar",
  语法: "grammar",
  句型: "grammar",
  易错难点: "difficulty",
  易错点: "difficulty",
  难点: "difficulty",
};

const CJK_START_RE = /^[\u4e00-\u9fff]/;

/* ------------------------------------------------------------------ 文本工具 */

export function collapse(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function hashString(text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function basenameNoExt(path: string): string {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  const base = i >= 0 ? s.slice(i + 1) : s;
  return base.replace(/\.md$/i, "");
}

/** 秒 → `m:ss` / `h:mm:ss` */
export function mmss(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 找到「词条：释义」的分隔冒号；跳过 `http://` 与 `01:32` 这类时间戳 */
function findColon(quote: string): number {
  for (let i = 0; i < quote.length && i <= 80; i++) {
    if (quote[i] === "：") return i;
  }
  for (let i = 0; i < quote.length && i <= 60; i++) {
    if (quote[i] !== ":") continue;
    const next = quote[i + 1] || "";
    if (next === "/" || next === "\\") continue;
    if (/\d/.test(quote[i - 1] || "") && /\d/.test(next)) continue;
    return i;
  }
  return -1;
}

/** 中文句子里被引号括起来的英文结构，如 “the + 最高级 + of which” */
function extractLatinQuoted(quote: string): string {
  const re = /[“"「『]([^”"」』]{2,90})[”"」』]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(quote))) {
    const inner = m[1].trim();
    if (/[A-Za-z]/.test(inner) && /[A-Za-z]{2,}/.test(inner)) return inner;
  }
  return "";
}

/** 中文句子里出现的第一段英文（"可用 vibe 替换 atmosphere" → "vibe"） */
function firstLatinRun(quote: string): string {
  const m = /[A-Za-z][A-Za-z0-9'’\-]*(?:\s+[A-Za-z0-9'’\-+]+){0,4}/.exec(quote);
  if (!m) return "";
  const run = m[0].trim().replace(/[.,;:，。；：]+$/, "");
  return run.length >= 3 ? run : "";
}

export interface SplitQuoteResult {
  quote: string;
  front: string;
  gloss: string;
  explain: string;
  hasColon: boolean;
  frontSource: FrontSource;
}

/**
 * 把一条高亮文本拆成「正面词条 / 中文释义 / 讲解」。
 *
 *   "top 11 most competitive：最激烈的11个 top + 数字 + 形容词最高级 表示…"
 *   "also 连接并联成分 also 在此连接 purchasing behaviors 与 …"        （无冒号，英文→中文边界）
 *   "六级口语与写作中可用 vibe 替换 atmosphere，但正式议论文慎用…"      （纯中文提示，抽英文锚点）
 */
export function splitQuote(raw: string): SplitQuoteResult {
  const quote = collapse(raw);
  let front = quote;
  let rest = "";
  let hasColon = false;
  let frontSource: FrontSource = "full";

  const colon = findColon(quote);
  if (colon > 0) {
    front = quote.slice(0, colon).trim();
    rest = quote.slice(colon + 1).trim();
    hasColon = true;
    frontSource = "colon";
  } else if (/^[A-Za-z]/.test(quote)) {
    const m = /^([\s\S]*?[A-Za-z0-9'"”’)\]])\s*([\u4e00-\u9fff][\s\S]*)$/.exec(quote);
    if (m) {
      front = m[1].trim();
      rest = m[2].trim();
      frontSource = "boundary";
    }
  }

  if (frontSource === "full" && CJK_START_RE.test(quote)) {
    const quoted = extractLatinQuoted(quote);
    if (quoted) {
      front = quoted;
      frontSource = "quoted";
    } else {
      const run = firstLatinRun(quote);
      if (run) {
        front = run;
        frontSource = "run";
      }
    }
    if (frontSource !== "full") rest = "";
  }

  let gloss = "";
  let explain = "";
  if (hasColon && rest) {
    const sp = rest.search(/\s/);
    if (sp > 0) {
      gloss = rest.slice(0, sp).trim();
      explain = rest.slice(sp + 1).trim();
    } else {
      gloss = rest.trim();
    }
    // 中文释义一般很短；过长说明整段都是讲解
    if (gloss.length > 40) {
      explain = [gloss, explain].filter(Boolean).join(" ");
      gloss = "";
    }
  } else if (rest) {
    explain = rest;
  }

  if (!front) {
    front = quote;
    frontSource = "full";
  }

  return { quote, front, gloss, explain, hasColon, frontSource };
}

/** 把 *.zh-CN.translations.json 压平成 { 原文 : 译文 } */
export function buildTranslationTable(raw: unknown): TranslationTable {
  const table: TranslationTable = Object.create(null) as TranslationTable;
  if (!raw || typeof raw !== "object") return table;
  const root = raw as { translations?: Record<string, { sourceText?: string; text?: string }> };
  const entries = root.translations || (raw as Record<string, { sourceText?: string; text?: string }>);
  for (const key of Object.keys(entries)) {
    const item = entries[key];
    if (!item || typeof item !== "object") continue;
    const source = collapse(item.sourceText || item.text);
    const translated = collapse(item.text || "");
    if (source && translated) table[source] = translated;
  }
  return table;
}

export function lookupTranslation(table: TranslationTable, text: string): string {
  const key = collapse(text);
  if (!key) return "";
  if (table[key]) return table[key];
  // 容错：句末标点差异
  const alt = key.replace(/[.。!！?？;；]+$/, "");
  if (table[alt]) return table[alt];
  for (const k of Object.keys(table)) {
    if (k.replace(/[.。!！?？;；]+$/, "") === alt) return table[k];
  }
  return "";
}

/* ------------------------------------------------------------------ 卡片构建 */

/**
 * 从「路径 → 数据」的表里取一条：先按完整路径，再退回同名文件。
 * 高亮里存的是 vault 相对路径（`Lingua Study/Transcripts/BV…-p1.json`），
 * 而调用方可能只按文件名建表，两种都接受。
 */
function resolveEntry<T>(map: Record<string, T>, path: string): T | null {
  if (!path) return null;
  const direct = map[path];
  if (direct) return direct;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const byBase = map[base];
  if (byBase) return byBase;
  for (const key of Object.keys(map)) {
    if (key.slice(key.lastIndexOf("/") + 1) === base) return map[key];
  }
  return null;
}

function findSegmentIndex(annotation: HighlightLike, segments: readonly TranscriptSegment[]): number {  if (!segments.length) return -1;
  const idx = Number(annotation.segmentIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < segments.length) return idx;

  const start = Number(annotation.segmentStart);
  if (Number.isFinite(start)) {
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < segments.length; i++) {
      const s = Number(segments[i].start);
      const e = Number(segments[i].end);
      if (!Number.isFinite(s)) continue;
      const gap = start >= s - 0.01 && start <= e + 0.01 ? 0 : Math.abs(s - start);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best >= 0 && bestGap < 3) return best;
  }
  return -1;
}

function buildContext(
  annotation: HighlightLike,
  transcript: TranscriptFile | null,
  translations: TranslationTable | null
): CardContext {
  const segments = transcript && Array.isArray(transcript.segments) ? transcript.segments : [];
  const index = findSegmentIndex(annotation, segments);
  const seg = index >= 0 ? segments[index] : null;
  const text = seg ? collapse(seg.text) : "";
  const fallbackStart = Number(annotation.segmentStart) || 0;
  const fallbackEnd = Number(annotation.segmentEnd) || 0;
  return {
    index,
    text,
    translation: text ? lookupTranslation(translations || (Object.create(null) as TranslationTable), text) : "",
    start: seg && Number.isFinite(Number(seg.start)) ? Number(seg.start) : fallbackStart,
    end: seg && Number.isFinite(Number(seg.end)) ? Number(seg.end) : fallbackEnd,
  };
}

export function categoryMeta(key: string): CategoryMeta {
  const known = CATEGORY_META[key as CardCategory];
  return known || CATEGORY_META.other;
}

export function categoryFromSection(section: string): CardCategory {
  const name = collapse(section)
    .replace(/[（(].*?[)）]/g, "")
    .trim();
  const direct = SECTION_TO_CATEGORY[name];
  if (direct) return direct;
  for (const key of Object.keys(SECTION_TO_CATEGORY)) {
    if (name.includes(key)) return SECTION_TO_CATEGORY[key];
  }
  return "other";
}

/**
 * 主入口：把高亮 annotations 转成可复习的卡片。
 * 传进来的顺序不重要，输出按「分类顺序 → 创建时间」排序。
 */
export function buildCards(input: BuildCardsInput): BuildCardsResult {
  const annotations = input.annotations || [];
  const transcripts = input.transcripts || {};
  const translations = input.translations || {};
  const warnings: string[] = [];
  const cards: ReviewCard[] = [];
  const seen = new Set<string>();

  if (!annotations.length) warnings.push("没有高亮数据");

  for (const annotation of annotations) {
    const quote = collapse(annotation.quote);
    if (!quote) continue;

    const id = annotation.id ? String(annotation.id) : "card-" + hashString(`${quote}|${annotation.sourcePath || ""}`);
    if (seen.has(id)) continue;
    seen.add(id);

    const kind: CardKind = annotation.targetType === "transcript" ? "sentence" : "point";
    const categoryKey =
      Array.isArray(annotation.categoryIds) && annotation.categoryIds.length ? annotation.categoryIds[0] : "other";
    const meta = categoryMeta(categoryKey);

    const parts: Pick<SplitQuoteResult, "front" | "gloss" | "explain" | "frontSource"> =
      kind === "sentence"
        ? { front: quote, gloss: "", explain: "", frontSource: "full" }
        : splitQuote(quote);

    const transcriptPath = annotation.transcriptPath || "";
    const transcript = resolveEntry(transcripts, transcriptPath);
    const translationTable = resolveEntry(translations, transcriptPath);
    const context = buildContext(annotation, transcript, translationTable);

    const sourcePath = annotation.sourcePath || "";
    cards.push({
      id,
      kind,
      category: meta.key,
      categoryLabel: meta.label,
      quote,
      front: parts.front || quote,
      gloss: parts.gloss || "",
      explain: parts.explain || "",
      frontSource: parts.frontSource || "full",
      sourcePath,
      sourceAlias: basenameNoExt(sourcePath),
      videoId: annotation.videoId || (transcript && transcript.videoId) || "",
      transcriptPath,
      segmentIndex: context.index,
      segmentStart: context.start,
      segmentEnd: context.end,
      createdAt: annotation.createdAt || "",
      updatedAt: annotation.updatedAt || "",
      note: collapse(annotation.note || ""),
      context,
      relatedIds: [],
    });
  }

  // 同一段字幕上的多张卡互相成为「相关高亮」
  const groups: Record<string, ReviewCard[]> = {};
  for (const card of cards) {
    if (!card.transcriptPath || card.segmentIndex < 0) continue;
    const key = `${card.transcriptPath}#${card.segmentIndex}`;
    const group = groups[key];
    if (group) group.push(card);
    else groups[key] = [card];
  }
  for (const key of Object.keys(groups)) {
    const group = groups[key];
    for (const card of group) {
      card.relatedIds = group.filter((c) => c.id !== card.id).map((c) => c.id);
    }
  }

  cards.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return { cards, warnings };
}

/* ------------------------------------------------------------------ 日期工具 */

export const INTERVALS: readonly number[] = [0, 1, 2, 4, 7, 15, 30, 60, 120];
export const REVIEW_GRADES: readonly ReviewGrade[] = ["forgot", "fuzzy", "know"];
const DAY_MS = 86400000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地时区的 YYYY-MM-DD */
export function dayKey(date?: Date | number): string {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function keyToDate(key: string): Date {
  const parts = String(key || "").split("-").map(Number);
  return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
}

export function addDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + (Number(days) || 0));
  return dayKey(d);
}

export function diffDays(fromKey: string, toKey: string): number {
  return Math.round((keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / DAY_MS);
}

/* ------------------------------------------------------------------ 复习状态 */

export interface ReviewState {
  level: number;
  due: string;
  last: string;
  reps: number;
  lapses: number;
  starred: boolean;
  /** 用户自己造的句子 */
  sentence: string;
  updatedAt: number;
}

export type ReviewStore = Record<string, ReviewState>;

export interface DayLog {
  total: number;
  forgot: number;
  fuzzy: number;
  know: number;
  newIds: string[];
}

export type ReviewLog = Record<string, DayLog>;

export function emptyState(): ReviewState {
  return { level: 0, due: "", last: "", reps: 0, lapses: 0, starred: false, sentence: "", updatedAt: 0 };
}

export function normalizeState(raw: Partial<ReviewState> | null | undefined): ReviewState {
  const merged: ReviewState = Object.assign(emptyState(), raw || {});
  merged.level = Math.max(0, Math.min(INTERVALS.length - 1, Number(merged.level) || 0));
  merged.reps = Math.max(0, Number(merged.reps) || 0);
  merged.lapses = Math.max(0, Number(merged.lapses) || 0);
  merged.starred = !!merged.starred;
  merged.sentence = typeof merged.sentence === "string" ? merged.sentence : "";
  return merged;
}

export function isNew(state: ReviewState | null | undefined): boolean {
  return !state || !state.reps;
}

export function isDue(state: ReviewState | null | undefined, today: string): boolean {
  if (!state || isNew(state)) return false;
  if (!state.due) return true;
  return state.due <= today;
}

export function intervalFor(level: number): number {
  const idx = Math.max(0, Math.min(INTERVALS.length - 1, Number(level) || 0));
  return INTERVALS[idx];
}

/**
 * 评分并返回新状态（不修改入参）。
 *
 *   忘记 → 回到第 0 档，今天再来一次（lapses+1）
 *   模糊 → 保持档位，间隔取当前档位的一半（至少 1 天）
 *   记住 → 升一档，间隔按 INTERVALS 拉长
 */
export function applyGrade(state: Partial<ReviewState> | null | undefined, grade: ReviewGrade, today?: string): ReviewState {
  const now = today || dayKey();
  const next = normalizeState(state);
  if (!REVIEW_GRADES.includes(grade)) throw new Error(`unknown grade: ${grade}`);

  next.reps += 1;
  next.last = now;

  if (grade === "forgot") {
    next.lapses += 1;
    next.level = 0;
    next.due = now;
  } else if (grade === "fuzzy") {
    next.level = Math.max(1, next.level);
    next.due = addDays(now, Math.max(1, Math.round(intervalFor(next.level) / 2)));
  } else {
    next.level = Math.min(INTERVALS.length - 1, next.level + 1);
    next.due = addDays(now, Math.max(1, intervalFor(next.level)));
  }

  next.updatedAt = Date.now();
  return next;
}

export function toggleStar(state: Partial<ReviewState> | null | undefined): ReviewState {
  const next = normalizeState(state);
  next.starred = !next.starred;
  next.updatedAt = Date.now();
  return next;
}

export function setSentence(state: Partial<ReviewState> | null | undefined, sentence: string): ReviewState {
  const next = normalizeState(state);
  next.sentence = String(sentence == null ? "" : sentence);
  next.updatedAt = Date.now();
  return next;
}

/* ------------------------------------------------------------------ 复习队列 */

export interface QueueOptions {
  today?: string;
  /** 每天最多引入多少张新卡 */
  newPerDay?: number;
  /** 今天已经引入过的新卡 id */
  introducedToday?: readonly string[];
  category?: CardCategory | "";
  sourcePath?: string;
  starredOnly?: boolean;
  /** 默认 true：只排到期卡；false：到期卡复习完后自由复习 */
  onlyDue?: boolean;
  search?: string;
}

export interface QueueCounts {
  pool: number;
  due: number;
  fresh: number;
  later: number;
  newAllowed: number;
}

export interface QueueResult {
  queue: ReviewCard[];
  counts: QueueCounts;
}

function matchSearch(card: ReviewCard, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  const hay = [card.front, card.gloss, card.explain, card.quote, card.sourceAlias, card.categoryLabel]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * 生成复习队列：到期卡（逾期最久优先）→ 新卡（按创建时间）→（没有到期卡时）自由复习。
 */
export function buildReviewQueue(cards: readonly ReviewCard[], store: ReviewStore, options: QueueOptions = {}): QueueResult {
  const today = options.today || dayKey();
  const newPerDay = Number.isFinite(Number(options.newPerDay)) ? Number(options.newPerDay) : 20;
  const introducedToday = options.introducedToday || [];
  const onlyDue = options.onlyDue !== false;
  const starredOnly = !!options.starredOnly;
  const category = options.category || "";
  const sourcePath = options.sourcePath || "";
  const search = options.search || "";

  const pool = cards.filter((card) => {
    if (category && card.category !== category) return false;
    if (sourcePath && card.sourcePath !== sourcePath) return false;
    if (starredOnly) {
      const st = store[card.id];
      if (!st || !st.starred) return false;
    }
    return matchSearch(card, search);
  });

  const due: Array<{ card: ReviewCard; state: ReviewState }> = [];
  const fresh: ReviewCard[] = [];
  const later: Array<{ card: ReviewCard; state: ReviewState }> = [];

  for (const card of pool) {
    const raw = store[card.id];
    const st = raw ? normalizeState(raw) : null;
    if (isNew(st)) {
      fresh.push(card);
      continue;
    }
    const state = st as ReviewState;
    if (isDue(state, today)) due.push({ card, state });
    else later.push({ card, state });
  }

  due.sort((a, b) => {
    const d = a.state.due.localeCompare(b.state.due);
    if (d !== 0) return d;
    return a.state.level - b.state.level;
  });
  fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const newAllowed = Math.max(0, newPerDay - introducedToday.length);
  // 到期 → 今日新卡（受每日上限约束）→（关闭「只看到期」时）其余卡片自由复习
  const queue: ReviewCard[] = due.map((x) => x.card).concat(fresh.slice(0, newAllowed));

  if (!onlyDue) {
    const rest = later
      .map((x) => x.card)
      .sort((a, b) => {
        const sa = store[a.id];
        const sb = store[b.id];
        return String(sa ? sa.last : "").localeCompare(String(sb ? sb.last : ""));
      });
    queue.push(...rest);
  }

  return {
    queue,
    counts: { pool: pool.length, due: due.length, fresh: fresh.length, later: later.length, newAllowed },
  };
}

export function appendReviewLog(log: ReviewLog, today: string, grade: ReviewGrade, cardId: string): DayLog {
  const key = today || dayKey();
  const day = log[key] || { total: 0, forgot: 0, fuzzy: 0, know: 0, newIds: [] };
  day.total += 1;
  if (grade === "forgot") day.forgot += 1;
  else if (grade === "fuzzy") day.fuzzy += 1;
  else day.know += 1;
  if (cardId && !day.newIds.includes(cardId) && day.newIds.length < 500) day.newIds.push(cardId);
  log[key] = day;
  return day;
}

/* ------------------------------------------------------------------ 统计 */

export interface ReviewStats {
  today: string;
  todayTotal: number;
  todayKnow: number;
  todayAccuracy: number;
  totalReviews: number;
  totalAccuracy: number;
  streak: number;
  learned: number;
  mastered: number;
  starred: number;
  sentences: number;
  dueToday: number;
  total: number;
  newToday: number;
}

export function computeReviewStats(
  store: ReviewStore,
  log: ReviewLog,
  cards: readonly ReviewCard[],
  options: { today?: string } = {}
): ReviewStats {
  const today = options.today || dayKey();
  let learned = 0;
  let mastered = 0;
  let starred = 0;
  let sentences = 0;
  let dueToday = 0;

  for (const card of cards) {
    const st = store[card.id];
    if (!st) continue;
    if (st.starred) starred += 1;
    if (st.sentence && st.sentence.trim()) sentences += 1;
    if (st.reps > 0) {
      learned += 1;
      if (st.level >= 3) mastered += 1;
      if (isDue(st, today)) dueToday += 1;
    }
  }

  const todayLog = log[today] || { total: 0, forgot: 0, fuzzy: 0, know: 0, newIds: [] };
  const all = Object.values(log);
  const totalReviews = all.reduce((sum, d) => sum + (d.total || 0), 0);
  const totalKnow = all.reduce((sum, d) => sum + (d.know || 0), 0);

  let streak = 0;
  let cursor = today;
  if (!(log[cursor] && log[cursor].total > 0)) cursor = addDays(today, -1);
  while (log[cursor] && log[cursor].total > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
    if (streak > 3650) break;
  }

  return {
    today,
    todayTotal: todayLog.total || 0,
    todayKnow: todayLog.know || 0,
    todayAccuracy: todayLog.total ? Math.round((todayLog.know / todayLog.total) * 100) : 0,
    totalReviews,
    totalAccuracy: totalReviews ? Math.round((totalKnow / totalReviews) * 100) : 0,
    streak,
    learned,
    mastered,
    starred,
    sentences,
    dueToday,
    total: cards.length,
    newToday: (todayLog.newIds || []).length,
  };
}

export interface HeatmapCell {
  date: string;
  count: number;
  know: number;
  future: boolean;
}

export interface HeatmapResult {
  weeks: number;
  cells: HeatmapCell[];
  max: number;
  start: string;
  end: string;
  today: string;
}

/** 最近 n 周的热力图数据：列=周，行=星期（周一为 0） */
export function buildHeatmap(log: ReviewLog, options: { weeks?: number; today?: string } = {}): HeatmapResult {
  const weeks = Number(options.weeks) || 26;
  const today = options.today || dayKey();
  const weekday = (keyToDate(today).getDay() + 6) % 7; // 周一 = 0
  const end = addDays(today, 6 - weekday); // 本周周日
  const start = addDays(end, -(weeks * 7 - 1));

  const cells: HeatmapCell[] = [];
  let max = 0;
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(start, i);
    const entry = log[key];
    const count = entry ? entry.total || 0 : 0;
    if (count > max) max = count;
    cells.push({ date: key, count, know: entry ? entry.know || 0 : 0, future: key > today });
  }
  return { weeks, cells, max, start, end, today };
}
