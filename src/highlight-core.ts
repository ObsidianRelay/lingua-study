import { isStudyProfile, type SentenceStudyAnalysis } from "./study-core";

export const HIGHLIGHT_BOOK_VERSION = 3 as const;
export const HIGHLIGHT_BOOK_PATH = "Lingua Study/Highlights/highlights.json";
export const HIGHLIGHT_BOOK_V1_BACKUP_PATH = "Lingua Study/Highlights/highlights.v1.backup.json";
export const HIGHLIGHT_BOOK_V2_BACKUP_PATH = "Lingua Study/Highlights/highlights.v2.backup.json";
export const MAX_HIGHLIGHT_CATEGORIES = 8;
export const MAX_HIGHLIGHT_NOTE_LENGTH = 2_000;
export const MAX_HIGHLIGHT_QUOTE_LENGTH = 1_000;
export const HIGHLIGHT_CONTEXT_LENGTH = 32;

export interface HighlightCategory {
  id: string;
  name: string;
  color: string;
}

export interface HighlightOffsetRange {
  startOffset: number;
  endOffset: number;
}

export const DEFAULT_HIGHLIGHT_CATEGORIES: readonly HighlightCategory[] = [
  { id: "expression", name: "重点表达", color: "#F2C94C" },
  { id: "grammar", name: "句型语法", color: "#56A3FF" },
  { id: "difficulty", name: "易错难点", color: "#EB6F92" }
];

export interface HighlightAnnotation {
  id: string;
  targetType: "transcript" | "study";
  studyTarget?: { profile: string | null; field: string };
  categoryIds: string[];
  quote: string;
  note: string;
  sourcePath: string;
  transcriptPath: string;
  videoId: string;
  segmentIndex: number;
  segmentStart: number;
  segmentEnd: number;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightBookFile {
  version: typeof HIGHLIGHT_BOOK_VERSION;
  annotations: Record<string, HighlightAnnotation>;
}

export interface HighlightAnchorInput {
  id: string;
  categoryIds: string[];
  note?: string;
  sourcePath: string;
  transcriptPath: string;
  videoId: string;
  segmentIndex: number;
  segmentStart: number;
  segmentEnd: number;
  segmentText: string;
  startOffset: number;
  endOffset: number;
  now: Date;
}

export interface StudyHighlightAnchorInput extends HighlightAnchorInput {
  studyTarget: { profile: string | null; field: string };
}

export interface HighlightSelectionActions {
  highlight: boolean;
  translate: boolean;
  showPopover: boolean;
}

export type HighlightAnchorResolution =
  | { status: "resolved"; startOffset: number; endOffset: number }
  | { status: "unresolved" };

export type StudyHighlightResolution =
  | { status: "resolved"; field: string; startOffset: number; endOffset: number }
  | { status: "unresolved" };

export interface ParsedHighlightBook {
  book: HighlightBookFile;
  migratedFromVersion: 1 | 2 | null;
}

export interface HighlightRenderSlice extends HighlightOffsetRange {
  annotationIds: string[];
  categoryId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximum = Number.POSITIVE_INFINITY): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isHighlightColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value);
}

/**
 * 将多个类别颜色转换为半透明荧光笔图层。图层总浓度保持稳定，避免重叠越多越发黑；
 * 传入顺序就是叠放顺序，因此设置页靠上的类别仍会略微占据视觉优先级。
 */
export function buildHighlightMarkerBackground(categoryColors: readonly string[]): string {
  const colors = categoryColors.filter(isHighlightColor);
  const normalizedColors = colors.length > 0 ? colors : ["#F2C94C"];
  const layerOpacity = (1 - Math.pow(0.66, 1 / normalizedColors.length)) * 100;
  const opacity = layerOpacity.toFixed(2).replace(/\.00$/u, "");
  return normalizedColors.map((color) => `linear-gradient(
    to bottom,
    transparent 4%,
    color-mix(in srgb, ${color} ${opacity}%, transparent) 10%,
    color-mix(in srgb, ${color} ${opacity}%, transparent) 90%,
    transparent 96%
  )`).join(", ");
}

export function sanitizeHighlightCategories(value: unknown): HighlightCategory[] {
  if (!Array.isArray(value)) {
    return DEFAULT_HIGHLIGHT_CATEGORIES.map((category) => ({ ...category }));
  }
  const categories: HighlightCategory[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of value.slice(0, MAX_HIGHLIGHT_CATEGORIES)) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const foldedName = name.toLocaleLowerCase("zh-CN");
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(id) ||
      name === "" || name.length > 24 ||
      !isHighlightColor(raw.color) ||
      ids.has(id) || names.has(foldedName)
    ) {
      continue;
    }
    ids.add(id);
    names.add(foldedName);
    categories.push({ id, name, color: raw.color.toUpperCase() });
  }
  return categories.length > 0
    ? categories
    : DEFAULT_HIGHLIGHT_CATEGORIES.map((category) => ({ ...category }));
}

export function createEmptyHighlightBook(): HighlightBookFile {
  return { version: HIGHLIGHT_BOOK_VERSION, annotations: {} };
}

function validateCategoryIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HIGHLIGHT_CATEGORIES) {
    throw new Error("高亮记录缺少有效类别");
  }
  const categoryIds = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (
    categoryIds.some((id) => !/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(id)) ||
    new Set(categoryIds).size !== categoryIds.length
  ) {
    throw new Error("高亮记录包含无效或重复类别");
  }
  return categoryIds;
}

function validateAnnotation(
  key: string,
  value: unknown,
  sourceVersion: 1 | 2 | typeof HIGHLIGHT_BOOK_VERSION
): HighlightAnnotation {
  if (!isRecord(value)) {
    throw new Error("高亮记录格式不正确");
  }
  const categoryIds = sourceVersion === 1
    ? validateCategoryIds([value.categoryId])
    : validateCategoryIds(value.categoryIds);
  const targetType = sourceVersion < 3 ? "transcript" : value.targetType;
  const studyTarget = value.studyTarget;
  if (
    !isNonEmptyString(value.id, 100) || value.id !== key ||
    !isNonEmptyString(value.quote, MAX_HIGHLIGHT_QUOTE_LENGTH) ||
    typeof value.note !== "string" || value.note.length > MAX_HIGHLIGHT_NOTE_LENGTH ||
    !isNonEmptyString(value.sourcePath, 2_000) ||
    !isNonEmptyString(value.transcriptPath, 2_000) ||
    !isNonEmptyString(value.videoId, 100) ||
    !Number.isSafeInteger(value.segmentIndex) || Number(value.segmentIndex) < 0 ||
    !isFiniteNonNegative(value.segmentStart) ||
    !isFiniteNonNegative(value.segmentEnd) || Number(value.segmentEnd) <= Number(value.segmentStart) ||
    !Number.isSafeInteger(value.startOffset) || Number(value.startOffset) < 0 ||
    !Number.isSafeInteger(value.endOffset) || Number(value.endOffset) <= Number(value.startOffset) ||
    typeof value.prefix !== "string" || value.prefix.length > HIGHLIGHT_CONTEXT_LENGTH ||
    typeof value.suffix !== "string" || value.suffix.length > HIGHLIGHT_CONTEXT_LENGTH ||
    !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt) ||
    (targetType !== "transcript" && targetType !== "study") ||
    (targetType === "study" && (
      !isRecord(studyTarget) ||
      (studyTarget.profile !== null && !isStudyProfile(studyTarget.profile)) ||
      !isNonEmptyString(studyTarget.field, 100) ||
      !/^(translation|examTip|keyPoints\.\d+\.(group|expression|meaning|note)|grammar\.\d+\.(group|pattern|explanation)|extensions\.\d+\.(group|anchor|expression|meaning|note|example|exampleTranslation))$/u.test(studyTarget.field)
    )) ||
    (targetType === "transcript" && studyTarget !== undefined)
  ) {
    throw new Error("高亮记录包含无效字段");
  }
  return {
    id: value.id,
    targetType,
    ...(targetType === "study" && isRecord(studyTarget)
      ? { studyTarget: { profile: studyTarget.profile as string | null, field: studyTarget.field as string } }
      : {}),
    categoryIds,
    quote: value.quote,
    note: value.note,
    sourcePath: value.sourcePath,
    transcriptPath: value.transcriptPath,
    videoId: value.videoId,
    segmentIndex: Number(value.segmentIndex),
    segmentStart: value.segmentStart,
    segmentEnd: value.segmentEnd,
    startOffset: Number(value.startOffset),
    endOffset: Number(value.endOffset),
    prefix: value.prefix,
    suffix: value.suffix,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

export function parseHighlightBook(value: unknown): ParsedHighlightBook {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== HIGHLIGHT_BOOK_VERSION) ||
    !isRecord(value.annotations)
  ) {
    throw new Error("高亮笔记版本或最外层格式不正确");
  }
  const sourceVersion = value.version;
  const annotations: Record<string, HighlightAnnotation> = {};
  for (const [key, raw] of Object.entries(value.annotations)) {
    annotations[key] = validateAnnotation(key, raw, sourceVersion);
  }
  return {
    book: { version: HIGHLIGHT_BOOK_VERSION, annotations },
    migratedFromVersion: sourceVersion === HIGHLIGHT_BOOK_VERSION ? null : sourceVersion
  };
}

export function validateHighlightBook(value: unknown): HighlightBookFile {
  return parseHighlightBook(value).book;
}

export function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

export function getHighlightSelectionActions(
  sourceText: string,
  desktop: boolean,
  highlightEnabled: boolean,
  translationEnabled: boolean
): HighlightSelectionActions {
  const hasText = sourceText.trim() !== "";
  const highlight = hasText && desktop && highlightEnabled;
  const translate = hasText && translationEnabled && /\s/u.test(sourceText);
  return { highlight, translate, showPopover: highlight || translate };
}

export function createHighlightAnnotation(input: HighlightAnchorInput): HighlightAnnotation {
  return createAnchoredAnnotation(input, "transcript");
}

export function createStudyHighlightAnnotation(input: StudyHighlightAnchorInput): HighlightAnnotation {
  return createAnchoredAnnotation(input, "study");
}

function createAnchoredAnnotation(
  input: HighlightAnchorInput | StudyHighlightAnchorInput,
  targetType: "transcript" | "study"
): HighlightAnnotation {
  const { segmentText, startOffset, endOffset } = input;
  if (
    !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
    startOffset < 0 || endOffset <= startOffset || endOffset > segmentText.length
  ) {
    throw new Error("选中的文字位置无效，请重新选择。");
  }
  const quote = segmentText.slice(startOffset, endOffset);
  if (quote.trim() === "" || quote.length > MAX_HIGHLIGHT_QUOTE_LENGTH) {
    throw new Error("请选择不超过 1000 个字符的有效文本。");
  }
  const now = input.now.toISOString();
  const annotation: HighlightAnnotation = {
    id: input.id,
    targetType,
    ...(targetType === "study" ? { studyTarget: (input as StudyHighlightAnchorInput).studyTarget } : {}),
    categoryIds: validateCategoryIds(input.categoryIds),
    quote,
    note: (input.note ?? "").trim(),
    sourcePath: input.sourcePath,
    transcriptPath: input.transcriptPath,
    videoId: input.videoId,
    segmentIndex: input.segmentIndex,
    segmentStart: input.segmentStart,
    segmentEnd: input.segmentEnd,
    startOffset,
    endOffset,
    prefix: segmentText.slice(Math.max(0, startOffset - HIGHLIGHT_CONTEXT_LENGTH), startOffset),
    suffix: segmentText.slice(endOffset, endOffset + HIGHLIGHT_CONTEXT_LENGTH),
    createdAt: now,
    updatedAt: now
  };
  return validateAnnotation(annotation.id, annotation, HIGHLIGHT_BOOK_VERSION);
}

export function addHighlightAnnotation(
  book: HighlightBookFile,
  annotation: HighlightAnnotation
): HighlightBookFile {
  if (book.annotations[annotation.id]) {
    throw new Error("这条高亮已经存在。");
  }
  const exact = Object.values(book.annotations).find((item) =>
    item.targetType === annotation.targetType &&
    (item.targetType !== "study" || (
      item.studyTarget?.profile === annotation.studyTarget?.profile &&
      item.studyTarget?.field === annotation.studyTarget?.field
    )) &&
    item.transcriptPath === annotation.transcriptPath &&
    item.segmentStart === annotation.segmentStart &&
    item.segmentEnd === annotation.segmentEnd &&
    item.startOffset === annotation.startOffset &&
    item.endOffset === annotation.endOffset &&
    item.quote === annotation.quote
  );
  if (exact) {
    const categoryIds = [...new Set([...exact.categoryIds, ...annotation.categoryIds])];
    const next = {
      ...exact,
      categoryIds,
      note: annotation.note || exact.note,
      updatedAt: annotation.updatedAt
    };
    return {
      ...book,
      annotations: { ...book.annotations, [exact.id]: next }
    };
  }
  return {
    ...book,
    annotations: { ...book.annotations, [annotation.id]: annotation }
  };
}

export function updateHighlightAnnotation(
  book: HighlightBookFile,
  id: string,
  changes: Pick<HighlightAnnotation, "categoryIds" | "note">,
  now: Date
): HighlightBookFile {
  const current = book.annotations[id];
  if (!current) throw new Error("找不到要修改的高亮笔记。");
  const note = changes.note.trim();
  const categoryIds = validateCategoryIds(changes.categoryIds);
  if (note.length > MAX_HIGHLIGHT_NOTE_LENGTH) {
    throw new Error("高亮笔记不能超过 2000 个字符。");
  }
  return {
    ...book,
    annotations: {
      ...book.annotations,
      [id]: { ...current, categoryIds, note, updatedAt: now.toISOString() }
    }
  };
}

export function removeHighlightAnnotation(book: HighlightBookFile, id: string): HighlightBookFile {
  if (!book.annotations[id]) return book;
  const annotations = { ...book.annotations };
  delete annotations[id];
  return { ...book, annotations };
}

export function migrateHighlightCategory(
  book: HighlightBookFile,
  fromCategoryId: string,
  toCategoryId: string,
  now: Date
): HighlightBookFile {
  if (fromCategoryId === toCategoryId) return book;
  const updatedAt = now.toISOString();
  let changed = false;
  const annotations = { ...book.annotations };
  for (const [id, item] of Object.entries(book.annotations)) {
    if (!item.categoryIds.includes(fromCategoryId)) continue;
    changed = true;
    annotations[id] = {
      ...item,
      categoryIds: [...new Set(item.categoryIds.map((categoryId) =>
        categoryId === fromCategoryId ? toCategoryId : categoryId
      ))],
      updatedAt
    };
  }
  return changed ? { ...book, annotations } : book;
}

function findOccurrences(text: string, quote: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    positions.push(index);
    from = index + Math.max(1, quote.length);
  }
  return positions;
}

export function resolveHighlightAnchor(
  annotation: HighlightAnnotation,
  segmentText: string
): HighlightAnchorResolution {
  if (segmentText.slice(annotation.startOffset, annotation.endOffset) === annotation.quote) {
    return {
      status: "resolved",
      startOffset: annotation.startOffset,
      endOffset: annotation.endOffset
    };
  }
  const occurrences = findOccurrences(segmentText, annotation.quote);
  if (occurrences.length === 1) {
    const startOffset = occurrences[0];
    return {
      status: "resolved",
      startOffset,
      endOffset: startOffset + annotation.quote.length
    };
  }
  if (occurrences.length === 0) return { status: "unresolved" };
  const contextMatches = occurrences.filter((startOffset) => {
    const prefix = segmentText.slice(Math.max(0, startOffset - annotation.prefix.length), startOffset);
    const suffix = segmentText.slice(
      startOffset + annotation.quote.length,
      startOffset + annotation.quote.length + annotation.suffix.length
    );
    return prefix === annotation.prefix && suffix === annotation.suffix;
  });
  if (contextMatches.length !== 1) return { status: "unresolved" };
  const startOffset = contextMatches[0];
  return {
    status: "resolved",
    startOffset,
    endOffset: startOffset + annotation.quote.length
  };
}

/** 只暴露知识卡中实际渲染的文本字段，避免将结构标题或按钮当成可标注内容。 */
export function getStudyHighlightFields(
  analysis: SentenceStudyAnalysis | null,
  translation: string | null
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (translation) fields.translation = translation;
  if (!analysis) return fields;
  analysis.keyPoints.forEach((item, index) => {
    fields[`keyPoints.${index}.group`] = `${item.expression}：${item.meaning} ${item.note}`;
    fields[`keyPoints.${index}.expression`] = item.expression;
    fields[`keyPoints.${index}.meaning`] = item.meaning;
    fields[`keyPoints.${index}.note`] = item.note;
  });
  analysis.grammar.forEach((item, index) => {
    fields[`grammar.${index}.group`] = `${item.pattern} ${item.explanation}`;
    fields[`grammar.${index}.pattern`] = item.pattern;
    fields[`grammar.${index}.explanation`] = item.explanation;
  });
  fields.examTip = analysis.examTip;
  (analysis.extensions ?? []).forEach((item, index) => {
    fields[`extensions.${index}.group`] = [
      `由原句中的“${item.anchor}”延伸`,
      `${item.expression}：${item.meaning}`,
      item.note,
      item.example,
      item.exampleTranslation
    ].join(" ");
    fields[`extensions.${index}.anchor`] = item.anchor;
    fields[`extensions.${index}.expression`] = item.expression;
    fields[`extensions.${index}.meaning`] = item.meaning;
    fields[`extensions.${index}.note`] = item.note;
    fields[`extensions.${index}.example`] = item.example;
    fields[`extensions.${index}.exampleTranslation`] = item.exampleTranslation;
  });
  return fields;
}

/** 内容重排后只在唯一匹配时移动；多处相同则留在库中等待用户重新定位。 */
export function resolveStudyHighlightAnchor(
  annotation: HighlightAnnotation,
  fields: Readonly<Record<string, string>>
): StudyHighlightResolution {
  const field = annotation.studyTarget?.field;
  if (annotation.targetType !== "study" || !field) return { status: "unresolved" };
  const originalText = fields[field];
  if (originalText !== undefined) {
    const original = resolveHighlightAnchor(annotation, originalText);
    if (original.status === "resolved") return { ...original, field };
  }
  const matches = Object.entries(fields).flatMap(([candidateField, text]) => {
    if (candidateField === field) return [];
    if (candidateField.endsWith(".group") !== field.endsWith(".group")) return [];
    const resolved = resolveHighlightAnchor(annotation, text);
    return resolved.status === "resolved" ? [{ ...resolved, field: candidateField }] : [];
  });
  return matches.length === 1 ? matches[0] : { status: "unresolved" };
}

/** 将跨标题与讲解的一条标注映射到各自的文字节点，仍只保存一条笔记。 */
export function projectStudyGroupHighlight(
  annotation: HighlightAnnotation,
  fieldText: string,
  fieldStartOffset: number
): HighlightAnnotation | null {
  if (annotation.targetType !== "study" || !annotation.studyTarget?.field.endsWith(".group")) {
    return null;
  }
  const startOffset = Math.max(0, annotation.startOffset - fieldStartOffset);
  const endOffset = Math.min(fieldText.length, annotation.endOffset - fieldStartOffset);
  if (startOffset >= endOffset) return null;
  return {
    ...annotation,
    quote: fieldText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    prefix: fieldText.slice(Math.max(0, startOffset - HIGHLIGHT_CONTEXT_LENGTH), startOffset),
    suffix: fieldText.slice(endOffset, endOffset + HIGHLIGHT_CONTEXT_LENGTH)
  };
}

export function annotationsForSegment(
  book: HighlightBookFile,
  transcriptPath: string,
  segmentStart: number,
  segmentEnd: number
): HighlightAnnotation[] {
  return Object.values(book.annotations)
    .filter((item) =>
      item.targetType === "transcript" &&
      item.transcriptPath === transcriptPath &&
      item.segmentStart === segmentStart &&
      item.segmentEnd === segmentEnd
    )
    .sort((left, right) => left.startOffset - right.startOffset);
}

export function buildHighlightRenderSlices(
  annotations: readonly HighlightAnnotation[],
  segmentText: string,
  categoryPriority: readonly string[]
): HighlightRenderSlice[] {
  const resolved = annotations.flatMap((annotation) => {
    const range = resolveHighlightAnchor(annotation, segmentText);
    return range.status === "resolved" ? [{ annotation, ...range }] : [];
  });
  const boundaries = [...new Set(resolved.flatMap((item) => [item.startOffset, item.endOffset]))]
    .sort((left, right) => left - right);
  const slices: HighlightRenderSlice[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startOffset = boundaries[index];
    const endOffset = boundaries[index + 1];
    const active = resolved.filter((item) =>
      item.startOffset < endOffset && item.endOffset > startOffset
    );
    if (active.length === 0) continue;
    const categoryId = categoryPriority.find((candidate) =>
      active.some((item) => item.annotation.categoryIds.includes(candidate))
    ) ?? active[0].annotation.categoryIds[0];
    const annotationIds = active
      .map((item) => item.annotation.id)
      .sort((left, right) => left.localeCompare(right));
    const previous = slices[slices.length - 1];
    if (
      previous && previous.endOffset === startOffset &&
      previous.categoryId === categoryId &&
      previous.annotationIds.join("\u0000") === annotationIds.join("\u0000")
    ) {
      previous.endOffset = endOffset;
    } else {
      slices.push({ startOffset, endOffset, categoryId, annotationIds });
    }
  }
  return slices;
}
