import assert from "node:assert/strict";
import test from "node:test";
import {
  VOCABULARY_EXPORT_MARKER,
  VOCABULARY_EXPORT_PATH,
  buildVocabularyExportMarkdown,
  isVocabularyExportMarkdown,
  writeVocabularyExport,
  type VocabularyExportNodeKind,
  type VocabularyExportStorage
} from "../src/vocabulary-export-core";
import type { VocabularyBookFile, VocabularyEntry } from "../src/vocabulary-core";

function entry(overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id: "study",
    word: "study",
    normalizedWord: "study",
    phonetic: "ˈstʌdi",
    partOfSpeech: "v. / n.",
    chineseTranslation: "学习；研究",
    englishDefinition: "learn about a subject",
    examTags: ["cet4", "cet6"],
    studyProfiles: ["cet4"],
    personalNote: "注意过去式 studied",
    contexts: [
      {
        sentence: "I *study* [every] day.",
        sourcePath: "视频学习/课程一.md",
        transcriptPath: "Lingua Study/Transcripts/test.json",
        videoId: "test",
        segmentIndex: 0,
        start: 6,
        end: 8,
        studyProfile: "cet4",
        addedAt: "2026-08-30T08:00:00.000Z"
      },
      {
        sentence: "We study together.",
        sourcePath: "视频学习/课程二.md",
        transcriptPath: "Lingua Study/Transcripts/test-2.json",
        videoId: "test-2",
        segmentIndex: 1,
        start: 3_661,
        end: 3_664,
        studyProfile: "cet6",
        addedAt: "2026-08-31T08:00:00.000Z"
      }
    ],
    createdAt: "2026-08-29T08:00:00.000Z",
    lastSeenAt: "2026-08-31T08:00:00.000Z",
    review: {
      phase: "review",
      introducedAt: "2026-08-29T08:00:00.000Z",
      dueAt: "2026-09-03T08:00:00.000Z",
      intervalDays: 3,
      reviewCount: 2,
      lapses: 0,
      lastReviewedAt: "2026-08-31T08:00:00.000Z"
    },
    ...overrides
  };
}

function book(entries: VocabularyEntry[]): VocabularyBookFile {
  return {
    version: 1,
    entries: Object.fromEntries(entries.map((item) => [item.id, item]))
  };
}

class MemoryExportStorage implements VocabularyExportStorage {
  readonly nodes = new Map<string, { kind: VocabularyExportNodeKind; content?: string }>();

  inspect(path: string): VocabularyExportNodeKind | null {
    return this.nodes.get(path)?.kind ?? null;
  }

  async read(path: string): Promise<string> {
    const node = this.nodes.get(path);
    if (node?.kind !== "file") {
      throw new Error("not a file");
    }
    return node.content ?? "";
  }

  async createFolder(path: string): Promise<void> {
    this.nodes.set(path, { kind: "folder" });
  }

  async createFile(path: string, content: string): Promise<void> {
    this.nodes.set(path, { kind: "file", content });
  }

  async updateFile(path: string, content: string): Promise<void> {
    const node = this.nodes.get(path);
    if (node?.kind !== "file") {
      throw new Error("not a file");
    }
    this.nodes.set(path, { kind: "file", content });
  }
}

test("完整学习卡按最近使用时间导出并保留全部视频语境", () => {
  const older = entry({
    id: "older",
    word: "older",
    normalizedWord: "older",
    lastSeenAt: "2026-08-30T08:00:00.000Z"
  });
  const markdown = buildVocabularyExportMarkdown(
    book([older, entry()]),
    new Date("2026-09-01T01:02:03.000Z")
  );
  assert.match(markdown, new RegExp(`${VOCABULARY_EXPORT_MARKER}: true`, "u"));
  assert.match(markdown, /generated-at: "2026-09-01T01:02:03\.000Z"/u);
  assert.match(markdown, /word-count: 2/u);
  assert.match(markdown, /cssclasses:\n  - lingua-vocabulary-export-note/u);
  assert.equal(markdown.match(/> \[!lingua-word\]/gu)?.length, 2);
  assert.ok(
    markdown.indexOf("> [!lingua-word] study")
      < markdown.indexOf("> [!lingua-word] older")
  );
  assert.match(markdown, /\*\*音标\*\*：\/ˈstʌdi\//u);
  assert.match(markdown, /\*\*词性\*\*：v\. \/ n\./u);
  assert.match(markdown, /\*\*中文释义\*\*：学习；研究/u);
  assert.match(markdown, /\*\*English definition\*\*：learn about a subject/u);
  assert.match(markdown, /\*\*学习目标\*\*：四级 · 六级/u);
  assert.match(markdown, /\*\*个人备注\*\*：注意过去式 studied/u);
  assert.ok(markdown.indexOf("We study together.") < markdown.indexOf("I \\*study\\* \\[every\\] day."));
  assert.match(markdown, /\[\[视频学习\/课程二\.md\|视频学习\/课程二\.md\]\] · 01:01:01/u);
});

test("空字段不会生成占位项，空生词本仍生成有效快照", () => {
  const sparse = entry({
    phonetic: "",
    partOfSpeech: "",
    chineseTranslation: "",
    englishDefinition: "",
    examTags: [],
    studyProfiles: [],
    personalNote: "",
    contexts: []
  });
  const sparseMarkdown = buildVocabularyExportMarkdown(book([sparse]), new Date(0));
  assert.match(sparseMarkdown, /> \[!lingua-word\] study/u);
  assert.doesNotMatch(sparseMarkdown, /音标|词性|中文释义|English definition|学习目标|个人备注|视频语境/u);
  const emptyMarkdown = buildVocabularyExportMarkdown(book([]), new Date(0));
  assert.match(emptyMarkdown, /word-count: 0/u);
  assert.match(emptyMarkdown, /共 0 个生词。/u);
  assert.equal(isVocabularyExportMarkdown(emptyMarkdown), true);
});

test("首次导出创建文件夹和笔记，再次导出安全更新固定笔记", async () => {
  const storage = new MemoryExportStorage();
  const original = book([entry()]);
  const snapshot = JSON.stringify(original);
  const first = await writeVocabularyExport(storage, original, new Date(0));
  assert.deepEqual(first, { path: VOCABULARY_EXPORT_PATH, count: 1, created: true });
  assert.equal(storage.inspect("Lingua Study"), "folder");
  assert.equal(storage.inspect("Lingua Study/Vocabulary"), "folder");
  assert.equal(isVocabularyExportMarkdown(await storage.read(VOCABULARY_EXPORT_PATH)), true);

  const secondBook = book([entry(), entry({ id: "focus", word: "focus", normalizedWord: "focus" })]);
  const second = await writeVocabularyExport(storage, secondBook, new Date(1_000));
  assert.deepEqual(second, { path: VOCABULARY_EXPORT_PATH, count: 2, created: false });
  assert.match(await storage.read(VOCABULARY_EXPORT_PATH), /word-count: 2/u);
  assert.equal(JSON.stringify(original), snapshot);
});

test("普通笔记和路径冲突都不会被覆盖", async () => {
  const ordinary = new MemoryExportStorage();
  ordinary.nodes.set("Lingua Study", { kind: "folder" });
  ordinary.nodes.set("Lingua Study/Vocabulary", { kind: "folder" });
  ordinary.nodes.set(VOCABULARY_EXPORT_PATH, { kind: "file", content: "# 我的手写笔记\n" });
  await assert.rejects(
    writeVocabularyExport(ordinary, book([entry()]), new Date(0)),
    /已有普通笔记/u
  );
  assert.equal(await ordinary.read(VOCABULARY_EXPORT_PATH), "# 我的手写笔记\n");

  const targetFolder = new MemoryExportStorage();
  targetFolder.nodes.set("Lingua Study", { kind: "folder" });
  targetFolder.nodes.set("Lingua Study/Vocabulary", { kind: "folder" });
  targetFolder.nodes.set(VOCABULARY_EXPORT_PATH, { kind: "folder" });
  await assert.rejects(
    writeVocabularyExport(targetFolder, book([entry()]), new Date(0)),
    /目标路径是文件夹/u
  );

  const occupiedParent = new MemoryExportStorage();
  occupiedParent.nodes.set("Lingua Study", { kind: "file", content: "occupied" });
  await assert.rejects(
    writeVocabularyExport(occupiedParent, book([entry()]), new Date(0)),
    /文件占用了目标文件夹路径/u
  );
});

test("导出标识必须位于正确闭合的 YAML 属性区", () => {
  assert.equal(isVocabularyExportMarkdown(`${VOCABULARY_EXPORT_MARKER}: true\n`), false);
  assert.equal(isVocabularyExportMarkdown(`---\n${VOCABULARY_EXPORT_MARKER}: true\n`), false);
  assert.equal(isVocabularyExportMarkdown(`---\ntitle: test\n---\n${VOCABULARY_EXPORT_MARKER}: true\n`), false);
  assert.equal(isVocabularyExportMarkdown(`\uFEFF---\n${VOCABULARY_EXPORT_MARKER}: true\n---\n`), true);
});
