import type { HighlightAnnotation, HighlightBookFile, HighlightCategory } from "./highlight-core";

export const HIGHLIGHT_EXPORT_PATH = "Lingua Study/Highlights/高亮笔记.md";
export const HIGHLIGHT_EXPORT_MARKER = "lingua-study-highlight-export";

export interface HighlightExportStorage {
  inspect(path: string): "file" | "folder" | null;
  read(path: string): Promise<string>;
  createFolder(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  updateFile(path: string, content: string): Promise<void>;
}

export interface HighlightExportWriteResult {
  path: string;
  count: number;
  created: boolean;
}

function escapeText(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/([`*_[\]<>|])/gu, "\\$1");
}

function textLines(value: string): string[] {
  return value.replace(/\r\n?/gu, "\n").split("\n").map(escapeText);
}

function sourceLink(path: string): string {
  const target = path.replace(/\|/gu, "\\|").replace(/\]/gu, "\\]");
  const label = escapeText(path.replace(/\.md$/iu, ""));
  return `[[${target}|${label}]]`;
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(whole / 3600), Math.floor(whole % 3600 / 60), whole % 60];
  return (parts[0] > 0 ? parts : parts.slice(1)).map((part) => String(part).padStart(2, "0")).join(":");
}

function renderAnnotation(annotation: HighlightAnnotation): string[] {
  const lines = [
    `### ${escapeText(annotation.quote.replace(/\s+/gu, " ").trim())}`,
    "",
    ...textLines(annotation.quote).map((line) => `> ${line}`),
    "",
    `- 来源：${sourceLink(annotation.sourcePath)}${annotation.targetType === "transcript" ? ` · ${timestamp(annotation.segmentStart)}` : ""}`,
    `- 类型：${annotation.targetType === "study" ? "知识点" : "字幕"}`
  ];
  if (annotation.note.trim()) {
    lines.push("- 个人笔记：", ...textLines(annotation.note).map((line) => `  ${line}`));
  }
  return lines;
}

/** 使用当前类别顺序生成完整 Markdown 快照；多类别标注在相应章节各出现一次。 */
export function buildHighlightExportMarkdown(
  book: HighlightBookFile,
  categories: readonly HighlightCategory[],
  generatedAt: Date
): string {
  const annotations = Object.values(book.annotations).sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id));
  const knownIds = new Set(categories.map((category) => category.id));
  const unknownIds = [...new Set(annotations.flatMap((annotation) => annotation.categoryIds))]
    .filter((id) => !knownIds.has(id));
  const sections = [
    ...categories.map((category) => ({ id: category.id, name: category.name })),
    ...unknownIds.map((id) => ({ id, name: `未分类（${id}）` }))
  ];
  const lines = [
    "---",
    `${HIGHLIGHT_EXPORT_MARKER}: true`,
    `generated-at: ${JSON.stringify(generatedAt.toISOString())}`,
    `highlight-count: ${annotations.length}`,
    "---",
    "",
    "# Lingua Study 高亮笔记",
    "",
    "> [!info] 自动生成",
    "> 再次导出会刷新这篇笔记。请在其他笔记中保存你对导出内容的修改。",
    "",
    `共 ${annotations.length} 条高亮笔记。多类别标注会在对应章节重复显示。`
  ];
  for (const section of sections) {
    const matches = annotations.filter((annotation) => annotation.categoryIds.includes(section.id));
    if (matches.length === 0) continue;
    lines.push("", `## ${escapeText(section.name.replace(/\s+/gu, " ").trim())}（${matches.length}）`);
    for (const annotation of matches) lines.push("", ...renderAnnotation(annotation));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 只识别 YAML 属性中的插件标记，防止覆盖同名手写笔记。 */
export function isHighlightExportMarkdown(markdown: string): boolean {
  const lines = markdown.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return false;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end > 0 && lines.slice(1, end).some((line) =>
    new RegExp(`^${HIGHLIGHT_EXPORT_MARKER}:\\s*true\\s*$`, "u").test(line.trim()));
}

/** 只写导出笔记，不修改 highlights.json。 */
export async function writeHighlightExport(
  storage: HighlightExportStorage,
  book: HighlightBookFile,
  categories: readonly HighlightCategory[],
  generatedAt: Date
): Promise<HighlightExportWriteResult> {
  const parentParts = HIGHLIGHT_EXPORT_PATH.split("/").slice(0, -1);
  let current = "";
  for (const part of parentParts) {
    current = current ? `${current}/${part}` : part;
    const kind = storage.inspect(current);
    if (kind === "file") throw new Error(`无法导出高亮笔记：文件占用了文件夹路径 ${current}`);
    if (kind === null) await storage.createFolder(current);
  }
  const content = buildHighlightExportMarkdown(book, categories, generatedAt);
  const kind = storage.inspect(HIGHLIGHT_EXPORT_PATH);
  if (kind === "folder") throw new Error(`无法导出高亮笔记：目标路径是文件夹 ${HIGHLIGHT_EXPORT_PATH}`);
  if (kind === "file") {
    const existing = await storage.read(HIGHLIGHT_EXPORT_PATH);
    if (!isHighlightExportMarkdown(existing)) {
      throw new Error("目标位置已有普通笔记，已停止覆盖。请先移动或重命名该笔记。");
    }
    await storage.updateFile(HIGHLIGHT_EXPORT_PATH, content);
    return { path: HIGHLIGHT_EXPORT_PATH, count: Object.keys(book.annotations).length, created: false };
  }
  await storage.createFile(HIGHLIGHT_EXPORT_PATH, content);
  return { path: HIGHLIGHT_EXPORT_PATH, count: Object.keys(book.annotations).length, created: true };
}
