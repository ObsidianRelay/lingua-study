import { STUDY_PROFILE_LABELS, type StudyProfile } from "./study-core";
import type {
  VocabularyBookFile,
  VocabularyContext,
  VocabularyEntry
} from "./vocabulary-core";

export const VOCABULARY_EXPORT_PATH = "Lingua Study/Vocabulary/生词本.md";
export const VOCABULARY_EXPORT_MARKER = "lingua-study-vocabulary-export";

export type VocabularyExportNodeKind = "file" | "folder";

export interface VocabularyExportStorage {
  inspect(path: string): VocabularyExportNodeKind | null;
  read(path: string): Promise<string>;
  createFolder(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  updateFile(path: string, content: string): Promise<void>;
}

export interface VocabularyExportWriteResult {
  path: string;
  count: number;
  created: boolean;
}

function inlineText(value: string): string {
  return value
    .replace(/\r?\n/gu, " ")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]<>])/gu, "\\$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function headingText(value: string): string {
  return inlineText(value).replace(/^#+\s*/u, "");
}

function wikiLinkTarget(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\]/gu, "\\]");
}

function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part) => part.toString().padStart(2, "0"))
      .join(":");
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function uniqueProfileLabels(entry: VocabularyEntry): string[] {
  const profiles = new Set<StudyProfile>([...entry.studyProfiles, ...entry.examTags]);
  return [...profiles].map((profile) => STUDY_PROFILE_LABELS[profile]);
}

function renderContext(context: VocabularyContext, index: number): string[] {
  const source = wikiLinkTarget(context.sourcePath);
  return [
    `${index + 1}. ${inlineText(context.sentence)}`,
    `   - 来源：[[${source}|${inlineText(context.sourcePath)}]] · ${formatTimestamp(context.start)}`
  ];
}

function renderEntry(entry: VocabularyEntry): string[] {
  const content: string[] = [];
  if (entry.phonetic.trim() !== "") {
    content.push(`- **音标**：/${inlineText(entry.phonetic)}/`);
  }
  if (entry.partOfSpeech.trim() !== "") {
    content.push(`- **词性**：${inlineText(entry.partOfSpeech)}`);
  }
  if (entry.chineseTranslation.trim() !== "") {
    content.push(`- **中文释义**：${inlineText(entry.chineseTranslation)}`);
  }
  if (entry.englishDefinition.trim() !== "") {
    content.push(`- **English definition**：${inlineText(entry.englishDefinition)}`);
  }
  const profileLabels = uniqueProfileLabels(entry);
  if (profileLabels.length > 0) {
    content.push(`- **学习目标**：${profileLabels.join(" · ")}`);
  }
  if (entry.personalNote.trim() !== "") {
    content.push(`- **个人备注**：${inlineText(entry.personalNote)}`);
  }
  if (entry.contexts.length > 0) {
    content.push("", "**视频语境**", "");
    const contexts = [...entry.contexts]
      .sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt));
    contexts.forEach((context, index) => content.push(...renderContext(context, index)));
  }
  return [
    `> [!lingua-word] ${headingText(entry.word)}`,
    ...content.map((line) => line === "" ? ">" : `> ${line}`)
  ];
}

/** 生成可直接写入 Obsidian 的完整生词本 Markdown 快照。 */
export function buildVocabularyExportMarkdown(
  book: VocabularyBookFile,
  generatedAt: Date
): string {
  const entries = Object.values(book.entries)
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  const lines = [
    "---",
    `${VOCABULARY_EXPORT_MARKER}: true`,
    `generated-at: ${JSON.stringify(generatedAt.toISOString())}`,
    `word-count: ${entries.length}`,
    "cssclasses:",
    "  - lingua-vocabulary-export-note",
    "---",
    "",
    "# Lingua Study 生词本",
    "",
    "> [!info] 自动生成",
    "> 本笔记由 Lingua Study 生词本生成，再次导出会刷新插件生成的内容。",
    "",
    `共 ${entries.length} 个生词。`
  ];
  for (const entry of entries) {
    lines.push("", ...renderEntry(entry));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 仅承认 YAML 属性区中的插件标识，避免误覆盖普通笔记。 */
export function isVocabularyExportMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/^\uFEFF/u, "");
  const lines = normalized.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return false;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    return false;
  }
  return lines
    .slice(1, closingIndex)
    .some((line) => new RegExp(`^${VOCABULARY_EXPORT_MARKER}:\\s*true\\s*$`, "u").test(line.trim()));
}

/** 创建或安全更新固定导出笔记；不会写回 wordbook.json。 */
export async function writeVocabularyExport(
  storage: VocabularyExportStorage,
  book: VocabularyBookFile,
  generatedAt: Date
): Promise<VocabularyExportWriteResult> {
  const parentParts = VOCABULARY_EXPORT_PATH.split("/").slice(0, -1);
  let current = "";
  for (const part of parentParts) {
    current = current === "" ? part : `${current}/${part}`;
    const node = storage.inspect(current);
    if (node === "file") {
      throw new Error(`无法导出生词本：文件占用了目标文件夹路径 ${current}`);
    }
    if (node === null) {
      await storage.createFolder(current);
    }
  }

  const content = buildVocabularyExportMarkdown(book, generatedAt);
  const target = storage.inspect(VOCABULARY_EXPORT_PATH);
  if (target === "folder") {
    throw new Error(`无法导出生词本：目标路径是文件夹 ${VOCABULARY_EXPORT_PATH}`);
  }
  if (target === "file") {
    const existing = await storage.read(VOCABULARY_EXPORT_PATH);
    if (!isVocabularyExportMarkdown(existing)) {
      throw new Error("目标位置已有普通笔记，已停止覆盖。请先移动或重命名该笔记。");
    }
    await storage.updateFile(VOCABULARY_EXPORT_PATH, content);
    return { path: VOCABULARY_EXPORT_PATH, count: Object.keys(book.entries).length, created: false };
  }
  await storage.createFile(VOCABULARY_EXPORT_PATH, content);
  return { path: VOCABULARY_EXPORT_PATH, count: Object.keys(book.entries).length, created: true };
}
