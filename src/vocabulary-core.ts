import type { DictionaryEntry } from "./dictionary-core";
import { normalizeLookupWord } from "./dictionary-core";
import { isStudyProfile, type StudyProfile } from "./study-core";

export const VOCABULARY_BOOK_VERSION = 1 as const;
export const VOCABULARY_BOOK_PATH = "Lingua Study/Vocabulary/wordbook.json";
export const MAX_REVIEW_INTERVAL_DAYS = 3_650;

export type ReviewRating = "again" | "hard" | "good" | "easy";
export type VocabularyReviewPhase = "new" | "learning" | "review";

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

export interface DailyReviewSummary {
  dueLearning: number;
  dueReview: number;
  availableNew: number;
  total: number;
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
  return {
    phase: value.phase,
    introducedAt: value.introducedAt,
    dueAt: value.dueAt,
    intervalDays: Number(value.intervalDays),
    reviewCount: Number(value.reviewCount),
    lapses: Number(value.lapses),
    lastReviewedAt: value.lastReviewedAt
  };
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
    const entry: VocabularyEntry = {
      ...current,
      word: dictionaryEntry?.word ?? current.word,
      phonetic: dictionaryEntry?.phonetic ?? current.phonetic,
      partOfSpeech: dictionaryEntry?.partOfSpeech ?? current.partOfSpeech,
      chineseTranslation:
        dictionaryEntry?.chineseTranslation || input.customMeaning.trim() || current.chineseTranslation,
      englishDefinition: dictionaryEntry?.englishDefinition ?? current.englishDefinition,
      examTags: dictionaryEntry ? uniqueProfiles(dictionaryEntry.examTags) : current.examTags,
      studyProfiles: uniqueProfiles([...current.studyProfiles, input.studyProfile]),
      personalNote: input.personalNote?.trim() || current.personalNote,
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
      lastReviewedAt: null
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
        review: { ...current.review, introducedAt: timestamp, dueAt: timestamp }
      }
    }
  };
}

function addCalendarDays(now: Date, days: number): Date {
  const due = new Date(now.getTime());
  due.setDate(due.getDate() + days);
  return due;
}

function nextInterval(current: number, rating: Exclude<ReviewRating, "again">): number {
  if (current <= 0) {
    return rating === "hard" ? 1 : rating === "good" ? 3 : 7;
  }
  const multiplier = rating === "hard" ? 1.2 : rating === "good" ? 2.5 : 3.5;
  return Math.min(MAX_REVIEW_INTERVAL_DAYS, Math.max(1, Math.ceil(current * multiplier)));
}

export function rateVocabularyEntry(
  book: VocabularyBookFile,
  id: string,
  rating: ReviewRating,
  now: Date
): VocabularyBookFile {
  const current = book.entries[id];
  if (!current) {
    throw new Error("要复习的生词已经不存在");
  }
  const reviewedAt = now.toISOString();
  let review: VocabularyReviewState;
  if (rating === "again") {
    review = {
      ...current.review,
      phase: "learning",
      introducedAt: current.review.introducedAt ?? reviewedAt,
      dueAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
      intervalDays: 0,
      reviewCount: current.review.reviewCount + 1,
      lapses: current.review.lapses + 1,
      lastReviewedAt: reviewedAt
    };
  } else {
    const intervalDays = nextInterval(current.review.intervalDays, rating);
    review = {
      ...current.review,
      phase: "review",
      introducedAt: current.review.introducedAt ?? reviewedAt,
      dueAt: addCalendarDays(now, intervalDays).toISOString(),
      intervalDays,
      reviewCount: current.review.reviewCount + 1,
      lastReviewedAt: reviewedAt
    };
  }
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
