import { STUDY_PROFILE_LABELS, type StudyProfile } from "./study-core";
import type {
  VocabularyBookFile,
  VocabularyEntry
} from "./vocabulary-core";

export const VOCABULARY_IMAGE_EXPORT_DIR = "Lingua Study/Vocabulary/生词本长图";
export const VOCABULARY_IMAGE_MANIFEST_PATH = `${VOCABULARY_IMAGE_EXPORT_DIR}/导出信息.json`;
export const VOCABULARY_IMAGE_EXPORT_MARKER = "lingua-study-vocabulary-image-export";
export const VOCABULARY_IMAGE_WIDTH = 1_080;
export const VOCABULARY_IMAGE_MAX_HEIGHT = 12_000;

export type VocabularyImageNodeKind = "file" | "folder";

export type VocabularyImageBlock =
  | { kind: "field"; label: string; value: string }
  | { kind: "section"; label: string }
  | { kind: "context"; index: number; sentence: string };

export interface VocabularyImageCard {
  id: string;
  word: string;
  blocks: VocabularyImageBlock[];
}

export interface MeasuredVocabularyImageCard<T> {
  value: T;
  height: number;
}

export interface VocabularyImageExportStorage {
  inspect(path: string): VocabularyImageNodeKind | null;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  createFolder(path: string): Promise<void>;
  createText(path: string, content: string): Promise<void>;
  updateText(path: string, content: string): Promise<void>;
  createBinary(path: string, content: ArrayBuffer): Promise<void>;
  updateBinary(path: string, content: ArrayBuffer): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export interface VocabularyImageExportResult {
  paths: string[];
  pageCount: number;
  wordCount: number;
  removedPageCount: number;
  cleanupWarnings: string[];
}

interface VocabularyImageManifest {
  marker: typeof VOCABULARY_IMAGE_EXPORT_MARKER;
  version: 1;
  generatedAt: string;
  wordCount: number;
  files: string[];
}

function cleanText(value: string): string {
  return value.replace(/\r?\n/gu, " ").replace(/\s+/gu, " ").trim();
}

function uniqueProfileLabels(entry: VocabularyEntry): string[] {
  const profiles = new Set<StudyProfile>([...entry.studyProfiles, ...entry.examTags]);
  return [...profiles].map((profile) => STUDY_PROFILE_LABELS[profile]);
}

function entryCard(entry: VocabularyEntry): VocabularyImageCard {
  const blocks: VocabularyImageBlock[] = [];
  const addField = (label: string, value: string): void => {
    const cleaned = cleanText(value);
    if (cleaned !== "") {
      blocks.push({ kind: "field", label, value: cleaned });
    }
  };
  addField("音标", entry.phonetic.trim() === "" ? "" : `/${entry.phonetic}/`);
  addField("词性", entry.partOfSpeech);
  addField("中文释义", entry.chineseTranslation);
  addField("English definition", entry.englishDefinition);
  const profiles = uniqueProfileLabels(entry);
  addField("学习目标", profiles.join(" · "));
  addField("个人备注", entry.personalNote);
  if (entry.contexts.length > 0) {
    blocks.push({ kind: "section", label: "视频语境" });
    [...entry.contexts]
      .sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt))
      .forEach((context, index) => blocks.push({
        kind: "context",
        index: index + 1,
        sentence: cleanText(context.sentence)
      }));
  }
  return { id: entry.id, word: cleanText(entry.word), blocks };
}

/** 生成与 Markdown 生词本顺序一致、且不受当前 UI 筛选影响的长图卡片。 */
export function buildVocabularyImageCards(book: VocabularyBookFile): VocabularyImageCard[] {
  return Object.values(book.entries)
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .map(entryCard);
}

/** 按真实测量高度贪心分页；调用方应先把超高单卡拆成续页卡。 */
export function paginateMeasuredVocabularyImageCards<T>(
  cards: readonly MeasuredVocabularyImageCard<T>[],
  availableHeight: number,
  gap: number
): T[][] {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
    throw new Error("长图分页高度必须大于 0");
  }
  const safeGap = Math.max(0, gap);
  const pages: T[][] = [];
  let page: T[] = [];
  let usedHeight = 0;
  for (const card of cards) {
    if (!Number.isFinite(card.height) || card.height <= 0) {
      throw new Error("长图卡片高度必须大于 0");
    }
    const nextHeight = page.length === 0 ? card.height : usedHeight + safeGap + card.height;
    if (page.length > 0 && nextHeight > availableHeight) {
      pages.push(page);
      page = [];
      usedHeight = 0;
    }
    if (card.height > availableHeight) {
      throw new Error("存在未拆分的超高单词卡片");
    }
    page.push(card.value);
    usedHeight = page.length === 1 ? card.height : usedHeight + safeGap + card.height;
  }
  if (page.length > 0) {
    pages.push(page);
  }
  return pages;
}

export function vocabularyImagePagePath(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("长图页码无效");
  }
  return `${VOCABULARY_IMAGE_EXPORT_DIR}/生词本-${String(index + 1).padStart(2, "0")}.png`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const imagePathPattern = new RegExp(
  `^${VOCABULARY_IMAGE_EXPORT_DIR.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/生词本-\\d{2,}\\.png$`,
  "u"
);

function isManagedImagePath(value: unknown): value is string {
  return typeof value === "string" && imagePathPattern.test(value);
}

function parseManifest(content: string): VocabularyImageManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("长图导出清单格式损坏，已停止覆盖现有图片。");
  }
  if (
    !isRecord(value) ||
    value.marker !== VOCABULARY_IMAGE_EXPORT_MARKER ||
    value.version !== 1 ||
    typeof value.generatedAt !== "string" ||
    !Number.isSafeInteger(value.wordCount) || Number(value.wordCount) < 0 ||
    !Array.isArray(value.files) ||
    !value.files.every(isManagedImagePath)
  ) {
    throw new Error("目标位置已有非 Lingua Study 生成的导出清单，已停止覆盖。");
  }
  return {
    marker: VOCABULARY_IMAGE_EXPORT_MARKER,
    version: 1,
    generatedAt: value.generatedAt,
    wordCount: Number(value.wordCount),
    files: [...new Set(value.files.filter(isManagedImagePath))]
  };
}

async function ensureExportFolder(storage: VocabularyImageExportStorage): Promise<void> {
  const parts = VOCABULARY_IMAGE_EXPORT_DIR.split("/");
  let current = "";
  for (const part of parts) {
    current = current === "" ? part : `${current}/${part}`;
    const node = storage.inspect(current);
    if (node === "file") {
      throw new Error(`无法导出长图：文件占用了目标文件夹路径 ${current}`);
    }
    if (node === null) {
      await storage.createFolder(current);
    }
  }
}

function manifestText(files: string[], wordCount: number, generatedAt: Date): string {
  const manifest: VocabularyImageManifest = {
    marker: VOCABULARY_IMAGE_EXPORT_MARKER,
    version: 1,
    generatedAt: generatedAt.toISOString(),
    wordCount,
    files
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 安全刷新固定长图；仅覆盖清单确认属于插件的图片。 */
export async function writeVocabularyImageExport(
  storage: VocabularyImageExportStorage,
  pages: readonly ArrayBuffer[],
  wordCount: number,
  generatedAt: Date
): Promise<VocabularyImageExportResult> {
  if (pages.length === 0) {
    throw new Error("没有可以写入的生词本长图。");
  }
  await ensureExportFolder(storage);
  const manifestNode = storage.inspect(VOCABULARY_IMAGE_MANIFEST_PATH);
  if (manifestNode === "folder") {
    throw new Error(`无法导出长图：目标路径是文件夹 ${VOCABULARY_IMAGE_MANIFEST_PATH}`);
  }
  const previousManifestText = manifestNode === "file"
    ? await storage.readText(VOCABULARY_IMAGE_MANIFEST_PATH)
    : null;
  const previousManifest = previousManifestText === null
    ? null
    : parseManifest(previousManifestText);
  const previousFiles = new Set(previousManifest?.files ?? []);
  const paths = pages.map((_page, index) => vocabularyImagePagePath(index));

  for (const path of paths) {
    const node = storage.inspect(path);
    if (node === "folder") {
      throw new Error(`无法导出长图：目标图片路径是文件夹 ${path}`);
    }
    if (node === "file" && !previousFiles.has(path)) {
      throw new Error(`目标位置已有非 Lingua Study 管理的图片，已停止覆盖：${path}`);
    }
  }

  const backups = new Map<string, ArrayBuffer>();
  const created: string[] = [];
  for (const path of paths) {
    if (storage.inspect(path) === "file") {
      backups.set(path, await storage.readBinary(path));
    }
  }

  try {
    for (let index = 0; index < pages.length; index += 1) {
      const path = paths[index];
      const page = pages[index];
      if (storage.inspect(path) === "file") {
        await storage.updateBinary(path, page);
      } else {
        await storage.createBinary(path, page);
        created.push(path);
      }
    }
    const nextManifest = manifestText(paths, wordCount, generatedAt);
    if (manifestNode === "file") {
      await storage.updateText(VOCABULARY_IMAGE_MANIFEST_PATH, nextManifest);
    } else {
      await storage.createText(VOCABULARY_IMAGE_MANIFEST_PATH, nextManifest);
    }
  } catch (caught) {
    const rollbackFailures: string[] = [];
    for (const [path, content] of backups) {
      try {
        await storage.updateBinary(path, content);
      } catch {
        rollbackFailures.push(path);
      }
    }
    for (const path of created) {
      try {
        if (storage.inspect(path) === "file") {
          await storage.removeFile(path);
        }
      } catch {
        rollbackFailures.push(path);
      }
    }
    try {
      if (previousManifestText !== null) {
        await storage.updateText(VOCABULARY_IMAGE_MANIFEST_PATH, previousManifestText);
      } else if (storage.inspect(VOCABULARY_IMAGE_MANIFEST_PATH) === "file") {
        await storage.removeFile(VOCABULARY_IMAGE_MANIFEST_PATH);
      }
    } catch {
      rollbackFailures.push(VOCABULARY_IMAGE_MANIFEST_PATH);
    }
    if (rollbackFailures.length > 0) {
      throw new Error(`长图写入失败，且部分临时文件未能恢复：${rollbackFailures.join("、")}`);
    }
    throw caught;
  }

  const cleanupWarnings: string[] = [];
  let removedPageCount = 0;
  for (const path of previousFiles) {
    if (paths.includes(path) || storage.inspect(path) !== "file") {
      continue;
    }
    try {
      await storage.removeFile(path);
      removedPageCount += 1;
    } catch {
      cleanupWarnings.push(`旧分页未能清理：${path}`);
    }
  }
  return {
    paths,
    pageCount: paths.length,
    wordCount,
    removedPageCount,
    cleanupWarnings
  };
}
