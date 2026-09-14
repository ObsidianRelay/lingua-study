import type { DictionaryEntry } from "./dictionary-core";
import { extractLookupWord, normalizeLookupWord } from "./dictionary-core";
import { isStudyProfile, type StudyProfile } from "./study-core";
import {
  Rating,
  S_MIN,
  State,
  createEmptyCard,
  default_w,
  fsrs,
  type Card,
  type CardInput,
  type Grade,
  type ReviewLog
} from "ts-fsrs";

export const VOCABULARY_BOOK_VERSION = 1 as const;
export const VOCABULARY_BOOK_PATH = "Lingua Study/Vocabulary/wordbook.json";
export const MAX_REVIEW_INTERVAL_DAYS = 3_650;
export const FSRS_ALGORITHM_VERSION = "FSRS-6" as const;
export const DEFAULT_FSRS_REQUEST_RETENTION = 0.9;
export const MIN_FSRS_REQUEST_RETENTION = 0.7;
export const MAX_FSRS_REQUEST_RETENTION = 0.99;

export type ReviewRating = "again" | "hard" | "good" | "easy";
export type VocabularyReviewPhase = "new" | "learning" | "review";

export interface VocabularyFsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: string;
}

export interface VocabularyFsrsReviewLog {
  rating: Rating;
  state: State;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  review: string;
}

export interface VocabularyContext {
  sentence: string;
  sourcePath: string;
  transcriptPath: string;
  videoId: string;
  segmentIndex: number;
  start: number;
  end: number;
  studyProfile: StudyProfile;
  addedAt: string;
}

export interface VocabularyReviewState {
  phase: VocabularyReviewPhase;
  introducedAt: string | null;
  dueAt: string;
  intervalDays: number;
  reviewCount: number;
  lapses: number;
  lastReviewedAt: string | null;
  /** FSRS-6 的完整记忆状态；旧生词会在下一次评分时自动补齐。 */
  fsrsCard?: VocabularyFsrsCard;
  /** 保留原始评分历史，便于以后调优参数或排查复习结果。 */
  reviewLogs?: VocabularyFsrsReviewLog[];
}

export interface VocabularyEntry {
  id: string;
  word: string;
  normalizedWord: string;
  phonetic: string;
  partOfSpeech: string;
  chineseTranslation: string;
  englishDefinition: string;
  examTags: StudyProfile[];
  studyProfiles: StudyProfile[];
  personalNote: string;
  /** 用户通过完整编辑窗口确认过内容；再次加入时不再用词典字段覆盖。 */
  userEdited: boolean;
  contexts: VocabularyContext[];
  createdAt: string;
  lastSeenAt: string;
  review: VocabularyReviewState;
}

export interface VocabularyBookFile {
  version: typeof VOCABULARY_BOOK_VERSION;
  entries: Record<string, VocabularyEntry>;
}

export interface VocabularyAddInput {
  rawWord: string;
  dictionaryEntry: DictionaryEntry | null;
  customMeaning: string;
  personalNote?: string;
  studyProfile: StudyProfile;
  context: Omit<VocabularyContext, "studyProfile" | "addedAt"> | null;
  now: Date;
}

export interface VocabularyEditInput {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  chineseTranslation: string;
  englishDefinition: string;
  examTags: StudyProfile[];
  personalNote: string;
}

export interface DailyReviewSummary {
  dueLearning: number;
  dueReview: number;
  availableNew: number;
  total: number;
}

export interface VocabularyRatingPreview {
  dueAt: string;
  intervalLabel: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFsrsState(value: unknown): value is State {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3;
}

function isFsrsRating(value: unknown): value is Rating {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 4;
}

function validateFsrsCard(value: unknown): VocabularyFsrsCard {
  if (!isRecord(value)) {
    throw new Error("FSRS-6 卡片状态格式不正确");
  }
  if (
    !isIsoDate(value.due) ||
    !isNonNegativeFinite(value.stability) ||
    !isNonNegativeFinite(value.difficulty) ||
    !isNonNegativeFinite(value.elapsed_days) ||
    !isNonNegativeFinite(value.scheduled_days) ||
    !isNonNegativeFinite(value.learning_steps) ||
    !Number.isSafeInteger(value.reps) || Number(value.reps) < 0 ||
    !Number.isSafeInteger(value.lapses) || Number(value.lapses) < 0 ||
    !isFsrsState(value.state) ||
    (value.last_review !== undefined && !isIsoDate(value.last_review))
  ) {
    throw new Error("FSRS-6 卡片状态包含无效字段");
  }
  return {
    due: value.due,
    stability: value.stability,
    difficulty: value.difficulty,
    elapsed_days: value.elapsed_days,
    scheduled_days: value.scheduled_days,
    learning_steps: value.learning_steps,
    reps: Number(value.reps),
    lapses: Number(value.lapses),
    state: value.state,
    ...(value.last_review === undefined ? {} : { last_review: value.last_review })
  };
}

function validateFsrsReviewLog(value: unknown): VocabularyFsrsReviewLog {
  if (!isRecord(value)) {
    throw new Error("FSRS-6 复习日志格式不正确");
  }
  if (
    !isFsrsRating(value.rating) ||
    !isFsrsState(value.state) ||
    !isIsoDate(value.due) ||
    !isNonNegativeFinite(value.stability) ||
    !isNonNegativeFinite(value.difficulty) ||
    !isNonNegativeFinite(value.elapsed_days) ||
    !isNonNegativeFinite(value.last_elapsed_days) ||
    !isNonNegativeFinite(value.scheduled_days) ||
    !isNonNegativeFinite(value.learning_steps) ||
    !isIsoDate(value.review)
  ) {
    throw new Error("FSRS-6 复习日志包含无效字段");
  }
  return {
    rating: value.rating,
    state: value.state,
    due: value.due,
    stability: value.stability,
    difficulty: value.difficulty,
    elapsed_days: value.elapsed_days,
    last_elapsed_days: value.last_elapsed_days,
    scheduled_days: value.scheduled_days,
    learning_steps: value.learning_steps,
    review: value.review
  };
}

function validateContext(value: unknown): VocabularyContext {
  if (!isRecord(value)) {
    throw new Error("生词语境格式不正确");
  }
  if (
    !isNonEmptyString(value.sentence) ||
    !isNonEmptyString(value.sourcePath) ||
    !isNonEmptyString(value.transcriptPath) ||
    !isNonEmptyString(value.videoId) ||
    !Number.isSafeInteger(value.segmentIndex) || Number(value.segmentIndex) < 0 ||
    !isNonNegativeFinite(value.start) ||
    !isNonNegativeFinite(value.end) || Number(value.end) < Number(value.start) ||
    !isStudyProfile(value.studyProfile) ||
    !isIsoDate(value.addedAt)
  ) {
    throw new Error("生词语境包含无效字段");
  }
  return {
    sentence: value.sentence,
    sourcePath: value.sourcePath,
    transcriptPath: value.transcriptPath,
    videoId: value.videoId,
    segmentIndex: Number(value.segmentIndex),
    start: value.start,
    end: value.end,
    studyProfile: value.studyProfile,
    addedAt: value.addedAt
  };
}

function validateReview(value: unknown): VocabularyReviewState {
  if (!isRecord(value)) {
    throw new Error("生词复习状态格式不正确");
  }
  if (
    (value.phase !== "new" && value.phase !== "learning" && value.phase !== "review") ||
    (value.introducedAt !== null && !isIsoDate(value.introducedAt)) ||
    !isIsoDate(value.dueAt) ||
    !Number.isSafeInteger(value.intervalDays) || Number(value.intervalDays) < 0 ||
    !Number.isSafeInteger(value.reviewCount) || Number(value.reviewCount) < 0 ||
    !Number.isSafeInteger(value.lapses) || Number(value.lapses) < 0 ||
    (value.lastReviewedAt !== null && !isIsoDate(value.lastReviewedAt))
  ) {
    throw new Error("生词复习状态包含无效字段");
  }
  const review: VocabularyReviewState = {
    phase: value.phase,
    introducedAt: value.introducedAt,
    dueAt: value.dueAt,
    intervalDays: Number(value.intervalDays),
    reviewCount: Number(value.reviewCount),
    lapses: Number(value.lapses),
    lastReviewedAt: value.lastReviewedAt
  };
  if (value.fsrsCard !== undefined) {
    review.fsrsCard = validateFsrsCard(value.fsrsCard);
  }
  if (value.reviewLogs !== undefined) {
    if (!Array.isArray(value.reviewLogs)) {
      throw new Error("FSRS-6 复习日志格式不正确");
    }
    review.reviewLogs = value.reviewLogs.map(validateFsrsReviewLog);
  }
  return review;
}

function validateEntry(key: string, value: unknown): VocabularyEntry {
  if (!isRecord(value)) {
    throw new Error("生词条目格式不正确");
  }
  const normalizedWord = normalizeLookupWord(
    typeof value.normalizedWord === "string" ? value.normalizedWord : ""
  );
  if (
    !isNonEmptyString(value.id) || value.id !== key ||
    !isNonEmptyString(value.word) || normalizedWord === "" || normalizedWord !== key ||
    typeof value.phonetic !== "string" ||
    typeof value.partOfSpeech !== "string" ||
    typeof value.chineseTranslation !== "string" ||
    typeof value.englishDefinition !== "string" ||
    !Array.isArray(value.examTags) || !value.examTags.every(isStudyProfile) ||
    !Array.isArray(value.studyProfiles) || !value.studyProfiles.every(isStudyProfile) ||
    typeof value.personalNote !== "string" ||
    (value.userEdited !== undefined && typeof value.userEdited !== "boolean") ||
    !Array.isArray(value.contexts) ||
    !isIsoDate(value.createdAt) || !isIsoDate(value.lastSeenAt)
  ) {
    throw new Error("生词条目包含无效字段");
  }
  return {
    id: value.id,
    word: value.word,
    normalizedWord,
    phonetic: value.phonetic,
    partOfSpeech: value.partOfSpeech,
    chineseTranslation: value.chineseTranslation,
    englishDefinition: value.englishDefinition,
    examTags: [...new Set(value.examTags)],
    studyProfiles: [...new Set(value.studyProfiles)],
    personalNote: value.personalNote,
    userEdited: value.userEdited === true,
    contexts: value.contexts.map(validateContext),
    createdAt: value.createdAt,
    lastSeenAt: value.lastSeenAt,
    review: validateReview(value.review)
  };
}

export function createEmptyVocabularyBook(): VocabularyBookFile {
  return { version: VOCABULARY_BOOK_VERSION, entries: {} };
}

export function validateVocabularyBook(value: unknown): VocabularyBookFile {
  if (!isRecord(value) || value.version !== VOCABULARY_BOOK_VERSION || !isRecord(value.entries)) {
    throw new Error("生词本版本或最外层格式不正确");
  }
  const entries: Record<string, VocabularyEntry> = {};
  for (const [key, rawEntry] of Object.entries(value.entries)) {
    entries[key] = validateEntry(key, rawEntry);
  }
  return { version: VOCABULARY_BOOK_VERSION, entries };
}

function vocabularyContextKey(context: VocabularyContext): string {
  return [
    context.sourcePath,
    context.transcriptPath,
    context.videoId,
    context.start.toString(),
    context.end.toString(),
    context.sentence
  ].join("\u0000");
}

function uniqueProfiles(values: readonly StudyProfile[]): StudyProfile[] {
  return [...new Set(values)];
}

interface FsrsCompatibilityFields {
  elapsed_days: number;
  last_elapsed_days?: number;
}

function serializeFsrsCard(card: Card): VocabularyFsrsCard {
  const compatibility = card as unknown as FsrsCompatibilityFields;
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    // ts-fsrs 5.4.2 仍要求该字段，下次升级主版本时再随官方迁移。
    elapsed_days: compatibility.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {})
  };
}

function serializeFsrsReviewLog(log: ReviewLog): VocabularyFsrsReviewLog {
  const compatibility = log as unknown as Required<FsrsCompatibilityFields>;
  return {
    rating: log.rating,
    state: log.state,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: compatibility.elapsed_days,
    last_elapsed_days: compatibility.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps,
    review: log.review.toISOString()
  };
}

function fsrsCardInput(review: VocabularyReviewState): CardInput {
  if (review.fsrsCard) {
    return review.fsrsCard;
  }
  if (review.phase === "new" && review.reviewCount === 0) {
    return createEmptyCard(new Date(review.dueAt));
  }

  // 旧版只保存间隔天数，无法还原出完整 FSRS 记忆状态。
  // 以当前间隔作为保守的稳定性起点，并保留原到期日，不在升级时批量改期。
  return {
    due: review.dueAt,
    stability: Math.max(S_MIN, review.intervalDays || 1),
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: review.intervalDays,
    learning_steps: 0,
    reps: review.reviewCount,
    lapses: review.lapses,
    state: review.phase === "learning" ? State.Learning : State.Review,
    ...(review.lastReviewedAt || review.introducedAt
      ? { last_review: review.lastReviewedAt ?? review.introducedAt }
      : {})
  };
}

function schedulerFor(requestRetention: number) {
  if (default_w.length !== 21) {
    throw new Error("FSRS-6 默认参数未能正确加载");
  }
  return fsrs({
    request_retention: sanitizeFsrsRequestRetention(requestRetention),
    maximum_interval: MAX_REVIEW_INTERVAL_DAYS,
    enable_fuzz: false
  });
}

function gradeFor(rating: ReviewRating): Grade {
  if (rating === "again") return Rating.Again;
  if (rating === "hard") return Rating.Hard;
  if (rating === "good") return Rating.Good;
  return Rating.Easy;
}

function reviewPhaseFor(state: State): VocabularyReviewPhase {
  if (state === State.New) return "new";
  if (state === State.Review) return "review";
  return "learning";
}

export function sanitizeFsrsRequestRetention(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FSRS_REQUEST_RETENTION;
  }
  return Math.min(
    MAX_FSRS_REQUEST_RETENTION,
    Math.max(MIN_FSRS_REQUEST_RETENTION, Math.round(value * 100) / 100)
  );
}

export function addVocabularyEntry(
  book: VocabularyBookFile,
  input: VocabularyAddInput
): { book: VocabularyBookFile; entry: VocabularyEntry; created: boolean } {
  const dictionaryWord = input.dictionaryEntry?.word ?? input.rawWord;
  const normalizedWord = normalizeLookupWord(dictionaryWord);
  if (normalizedWord === "") {
    throw new Error("无法把空单词加入生词本");
  }
  const now = input.now.toISOString();
  const nextContext: VocabularyContext | null = input.context
    ? { ...input.context, studyProfile: input.studyProfile, addedAt: now }
    : null;
  const current = book.entries[normalizedWord];
  if (current) {
    const knownContexts = new Set(current.contexts.map(vocabularyContextKey));
    const contexts = nextContext && !knownContexts.has(vocabularyContextKey(nextContext))
      ? [...current.contexts, nextContext]
      : current.contexts;
    const dictionaryEntry = input.dictionaryEntry;
    const preservePersonalVersion = current.userEdited;
    const entry: VocabularyEntry = {
      ...current,
      word: preservePersonalVersion ? current.word : dictionaryEntry?.word ?? current.word,
      phonetic: preservePersonalVersion
        ? current.phonetic
        : dictionaryEntry?.phonetic ?? current.phonetic,
      partOfSpeech: preservePersonalVersion
        ? current.partOfSpeech
        : dictionaryEntry?.partOfSpeech ?? current.partOfSpeech,
      chineseTranslation: preservePersonalVersion
        ? current.chineseTranslation
        : dictionaryEntry?.chineseTranslation || input.customMeaning.trim() || current.chineseTranslation,
      englishDefinition: preservePersonalVersion
        ? current.englishDefinition
        : dictionaryEntry?.englishDefinition ?? current.englishDefinition,
      examTags: preservePersonalVersion || !dictionaryEntry
        ? current.examTags
        : uniqueProfiles(dictionaryEntry.examTags),
      studyProfiles: uniqueProfiles([...current.studyProfiles, input.studyProfile]),
      personalNote: preservePersonalVersion
        ? current.personalNote
        : input.personalNote?.trim() || current.personalNote,
      contexts,
      lastSeenAt: now
    };
    return {
      book: { ...book, entries: { ...book.entries, [normalizedWord]: entry } },
      entry,
      created: false
    };
  }

  const dictionaryEntry = input.dictionaryEntry;
  const emptyFsrsCard = createEmptyCard(input.now);
  const entry: VocabularyEntry = {
    id: normalizedWord,
    word: dictionaryEntry?.word ?? input.rawWord.trim(),
    normalizedWord,
    phonetic: dictionaryEntry?.phonetic ?? "",
    partOfSpeech: dictionaryEntry?.partOfSpeech ?? "",
    chineseTranslation: dictionaryEntry?.chineseTranslation ?? input.customMeaning.trim(),
    englishDefinition: dictionaryEntry?.englishDefinition ?? "",
    examTags: uniqueProfiles(dictionaryEntry?.examTags ?? []),
    studyProfiles: [input.studyProfile],
    personalNote: input.personalNote?.trim() ?? "",
    userEdited: false,
    contexts: nextContext ? [nextContext] : [],
    createdAt: now,
    lastSeenAt: now,
    review: {
      phase: "new",
      introducedAt: null,
      dueAt: now,
      intervalDays: 0,
      reviewCount: 0,
      lapses: 0,
      lastReviewedAt: null,
      fsrsCard: serializeFsrsCard(emptyFsrsCard),
      reviewLogs: []
    }
  };
  return {
    book: { ...book, entries: { ...book.entries, [normalizedWord]: entry } },
    entry,
    created: true
  };
}

export function removeVocabularyEntry(
  book: VocabularyBookFile,
  id: string
): VocabularyBookFile {
  if (!book.entries[id]) {
    return book;
  }
  const entries = { ...book.entries };
  delete entries[id];
  return { ...book, entries };
}

export function updateVocabularyNote(
  book: VocabularyBookFile,
  id: string,
  note: string
): VocabularyBookFile {
  const current = book.entries[id];
  if (!current) {
    throw new Error("要修改的生词已经不存在");
  }
  return {
    ...book,
    entries: {
      ...book.entries,
      [id]: { ...current, personalNote: note.trim() }
    }
  };
}

function boundedVocabularyField(value: string, label: string, maximum: number): string {
  const cleaned = value.trim();
  if (cleaned.length > maximum) {
    throw new Error(`${label}不能超过 ${maximum.toLocaleString()} 个字符`);
  }
  return cleaned;
}

/**
 * 编辑可见学习字段；语境、复习状态和创建时间保持不变。
 * 单词变化时同步迁移 entries 的键和条目 id，避免出现键值不一致的数据文件。
 */
export function updateVocabularyEntry(
  book: VocabularyBookFile,
  id: string,
  input: VocabularyEditInput
): VocabularyBookFile {
  const current = book.entries[id];
  if (!current) {
    throw new Error("要修改的生词已经不存在");
  }
  const word = input.word.normalize("NFKC").trim();
  const normalizedWord = extractLookupWord(word);
  if (!normalizedWord) {
    throw new Error("单词只能包含英文字母，可使用撇号或连字符");
  }
  if (word.length > 120) {
    throw new Error("单词不能超过 120 个字符");
  }
  if (normalizedWord !== id && book.entries[normalizedWord]) {
    throw new Error(`生词本中已经存在“${book.entries[normalizedWord].word}”，请先处理重复条目`);
  }
  const phonetic = boundedVocabularyField(input.phonetic, "音标", 200);
  const partOfSpeech = boundedVocabularyField(input.partOfSpeech, "词性", 200);
  const chineseTranslation = boundedVocabularyField(
    input.chineseTranslation,
    "中文释义",
    10_000
  );
  const englishDefinition = boundedVocabularyField(
    input.englishDefinition,
    "英文释义",
    10_000
  );
  const personalNote = boundedVocabularyField(input.personalNote, "个人备注", 10_000);
  if (chineseTranslation === "" && englishDefinition === "" && personalNote === "") {
    throw new Error("中文释义、英文释义和个人备注至少填写一项");
  }
  if (!input.examTags.every(isStudyProfile)) {
    throw new Error("考试标签包含不支持的选项");
  }
  const updated: VocabularyEntry = {
    ...current,
    id: normalizedWord,
    word,
    normalizedWord,
    phonetic,
    partOfSpeech,
    chineseTranslation,
    englishDefinition,
    examTags: uniqueProfiles(input.examTags),
    personalNote,
    userEdited: true
  };
  const entries = { ...book.entries };
  if (normalizedWord !== id) {
    delete entries[id];
  }
  entries[normalizedWord] = updated;
  return { ...book, entries };
}

export function introduceVocabularyEntry(
  book: VocabularyBookFile,
  id: string,
  now: Date
): VocabularyBookFile {
  const current = book.entries[id];
  if (!current || current.review.phase !== "new" || current.review.introducedAt !== null) {
    return book;
  }
  const timestamp = now.toISOString();
  return {
    ...book,
    entries: {
      ...book.entries,
      [id]: {
        ...current,
        review: {
          ...current.review,
          introducedAt: timestamp,
          dueAt: timestamp,
          ...(current.review.fsrsCard
            ? { fsrsCard: { ...current.review.fsrsCard, due: timestamp } }
            : {})
        }
      }
    }
  };
}

function formatReviewInterval(now: Date, due: Date): string {
  const milliseconds = Math.max(0, due.getTime() - now.getTime());
  const minutes = Math.max(1, Math.round(milliseconds / (60 * 1_000)));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  return `${Math.max(1, Math.round(hours / 24))} 天`;
}

export function previewVocabularyRating(
  entry: VocabularyEntry,
  rating: ReviewRating,
  now: Date,
  requestRetention = DEFAULT_FSRS_REQUEST_RETENTION
): VocabularyRatingPreview {
  const result = schedulerFor(requestRetention).next(fsrsCardInput(entry.review), now, gradeFor(rating));
  return {
    dueAt: result.card.due.toISOString(),
    intervalLabel: formatReviewInterval(now, result.card.due)
  };
}

export function rateVocabularyEntry(
  book: VocabularyBookFile,
  id: string,
  rating: ReviewRating,
  now: Date,
  requestRetention = DEFAULT_FSRS_REQUEST_RETENTION
): VocabularyBookFile {
  const current = book.entries[id];
  if (!current) {
    throw new Error("要复习的生词已经不存在");
  }
  const reviewedAt = now.toISOString();
  const result = schedulerFor(requestRetention).next(
    fsrsCardInput(current.review),
    now,
    gradeFor(rating)
  );
  const fsrsCard = serializeFsrsCard(result.card);
  const review: VocabularyReviewState = {
    ...current.review,
    phase: reviewPhaseFor(result.card.state),
    introducedAt: current.review.introducedAt ?? reviewedAt,
    dueAt: fsrsCard.due,
    intervalDays: result.card.scheduled_days,
    reviewCount: result.card.reps,
    lapses: result.card.lapses,
    lastReviewedAt: result.card.last_review?.toISOString() ?? reviewedAt,
    fsrsCard,
    reviewLogs: [
      ...(current.review.reviewLogs ?? []),
      serializeFsrsReviewLog(result.log)
    ]
  };
  return {
    ...book,
    entries: { ...book.entries, [id]: { ...current, review } }
  };
}

export function localDateKey(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0")
  ].join("-");
}

function introducedOn(entry: VocabularyEntry, dateKey: string): boolean {
  const introducedAt = entry.review.introducedAt;
  return introducedAt !== null && localDateKey(new Date(introducedAt)) === dateKey;
}

function byDueThenCreated(left: VocabularyEntry, right: VocabularyEntry): number {
  const due = Date.parse(left.review.dueAt) - Date.parse(right.review.dueAt);
  return due !== 0 ? due : Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

export function buildDailyReviewQueue(
  book: VocabularyBookFile,
  dailyNewLimit: number,
  now: Date
): string[] {
  const entries = Object.values(book.entries);
  const nowTime = now.getTime();
  const today = localDateKey(now);
  const unfinishedNew = entries
    .filter((entry) => entry.review.phase === "new" && entry.review.introducedAt !== null)
    .sort(byDueThenCreated);
  const dueLearning = entries
    .filter((entry) =>
      entry.review.phase === "learning" && Date.parse(entry.review.dueAt) <= nowTime
    )
    .sort(byDueThenCreated);
  const dueReview = entries
    .filter((entry) =>
      entry.review.phase === "review" && Date.parse(entry.review.dueAt) <= nowTime
    )
    .sort(byDueThenCreated);
  const introducedToday = entries.filter((entry) => introducedOn(entry, today)).length;
  const remainingNew = Math.max(0, Math.floor(dailyNewLimit) - introducedToday);
  const freshNew = entries
    .filter((entry) => entry.review.phase === "new" && entry.review.introducedAt === null)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(0, remainingNew);
  return [...unfinishedNew, ...dueLearning, ...dueReview, ...freshNew].map((entry) => entry.id);
}

export function getDailyReviewSummary(
  book: VocabularyBookFile,
  dailyNewLimit: number,
  now: Date
): DailyReviewSummary {
  const queue = buildDailyReviewQueue(book, dailyNewLimit, now);
  let dueLearning = 0;
  let dueReview = 0;
  let availableNew = 0;
  for (const id of queue) {
    const entry = book.entries[id];
    if (entry?.review.phase === "review") {
      dueReview += 1;
    } else if (entry?.review.phase === "learning") {
      dueLearning += 1;
    } else if (entry) {
      availableNew += 1;
    }
  }
  return {
    dueLearning,
    dueReview,
    availableNew,
    total: dueLearning + dueReview + availableNew
  };
}
