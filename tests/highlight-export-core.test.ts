import assert from "node:assert/strict";
import test from "node:test";
import {
  HIGHLIGHT_EXPORT_PATH,
  buildHighlightExportMarkdown,
  isHighlightExportMarkdown,
  writeHighlightExport,
  type HighlightExportStorage
} from "../src/highlight-export-core";
import type { HighlightAnnotation, HighlightBookFile, HighlightCategory } from "../src/highlight-core";

const categories: HighlightCategory[] = [
  { id: "expression", name: "重点表达", color: "#F2C94C" },
  { id: "grammar", name: "句型语法", color: "#56A3FF" }
];

function annotation(id: string, categoryIds: string[], overrides: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    id,
    targetType: "transcript",
    categoryIds,
    quote: `The *${id}* [line]`,
    note: "第一行\n第二行",
    sourcePath: "视频学习/课程.md",
    transcriptPath: "Lingua Study/Transcripts/test.json",
    videoId: "test",
    segmentIndex: 0,
    segmentStart: 65,
    segmentEnd: 68,
    startOffset: 0,
    endOffset: 5,
    prefix: "",
    suffix: "",
    createdAt: "2026-10-18T01:00:00.000Z",
    updatedAt: "2026-10-18T01:00:00.000Z",
    ...overrides
  };
}

function book(...items: HighlightAnnotation[]): HighlightBookFile {
  return { version: 3, annotations: Object.fromEntries(items.map((item) => [item.id, item])) };
}

class MemoryStorage implements HighlightExportStorage {
  nodes = new Map<string, { kind: "file" | "folder"; content?: string }>();
  inspect(path: string): "file" | "folder" | null { return this.nodes.get(path)?.kind ?? null; }
  async read(path: string): Promise<string> { return this.nodes.get(path)?.content ?? ""; }
  async createFolder(path: string): Promise<void> { this.nodes.set(path, { kind: "folder" }); }
  async createFile(path: string, content: string): Promise<void> { this.nodes.set(path, { kind: "file", content }); }
  async updateFile(path: string, content: string): Promise<void> { this.nodes.set(path, { kind: "file", content }); }
}

test("按当前类别顺序导出全部标注，多类别重复显示且保留笔记与来源", () => {
  const original = book(annotation("one", ["expression", "grammar"]),
    annotation("two", ["grammar"], { targetType: "study", studyTarget: { profile: null, field: "translation" } }));
  const snapshot = JSON.stringify(original);
  const markdown = buildHighlightExportMarkdown(original, categories, new Date("2026-10-18T02:00:00.000Z"));
  assert.ok(markdown.indexOf("## 重点表达（1）") < markdown.indexOf("## 句型语法（2）"));
  assert.equal(markdown.match(/### The \\\*one\\\* \\\[line\\\]/gu)?.length, 2);
  assert.match(markdown, /个人笔记：\n  第一行\n  第二行/u);
  assert.match(markdown, /\[\[视频学习\/课程\.md\|视频学习\/课程\]\] · 01:05/u);
  assert.match(markdown, /类型：知识点/u);
  assert.equal(JSON.stringify(original), snapshot);
});

test("失效类别仍导出，且标记必须位于 YAML 属性区", () => {
  const markdown = buildHighlightExportMarkdown(book(annotation("one", ["retired"])), categories, new Date(0));
  assert.match(markdown, /## 未分类（retired）（1）/u);
  assert.equal(isHighlightExportMarkdown(markdown), true);
  assert.equal(isHighlightExportMarkdown(`# 草稿\n${markdown}`), false);
  assert.equal(isHighlightExportMarkdown("---\nother: true\n---\nlingua-study-highlight-export: true"), false);
});

test("重复导出只更新插件文件，普通笔记和路径冲突不覆盖", async () => {
  const storage = new MemoryStorage();
  const first = await writeHighlightExport(storage, book(annotation("one", ["expression"])), categories, new Date(0));
  assert.deepEqual(first, { path: HIGHLIGHT_EXPORT_PATH, count: 1, created: true });
  const second = await writeHighlightExport(storage, book(annotation("two", ["grammar"])), categories, new Date(1_000));
  assert.deepEqual(second, { path: HIGHLIGHT_EXPORT_PATH, count: 1, created: false });
  assert.doesNotMatch(await storage.read(HIGHLIGHT_EXPORT_PATH), /### The \\\*one/u);
  storage.nodes.set(HIGHLIGHT_EXPORT_PATH, { kind: "file", content: "# 我的笔记\n" });
  await assert.rejects(writeHighlightExport(storage, book(annotation("one", ["expression"])), categories, new Date(0)), /已有普通笔记/u);
  assert.equal(await storage.read(HIGHLIGHT_EXPORT_PATH), "# 我的笔记\n");
  storage.nodes.set(HIGHLIGHT_EXPORT_PATH, { kind: "folder" });
  await assert.rejects(writeHighlightExport(storage, book(annotation("one", ["expression"])), categories, new Date(0)), /目标路径是文件夹/u);
});
