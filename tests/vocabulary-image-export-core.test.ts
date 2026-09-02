import assert from "node:assert/strict";
import test from "node:test";
import {
  VOCABULARY_IMAGE_EXPORT_DIR,
  VOCABULARY_IMAGE_EXPORT_MARKER,
  VOCABULARY_IMAGE_MANIFEST_PATH,
  buildVocabularyImageCards,
  paginateMeasuredVocabularyImageCards,
  vocabularyImagePagePath,
  writeVocabularyImageExport,
  type VocabularyImageExportStorage,
  type VocabularyImageNodeKind
} from "../src/vocabulary-image-export-core";
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
        sentence: "I study every day.",
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

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

function byteValues(value: ArrayBuffer): number[] {
  return [...new Uint8Array(value)];
}

class MemoryImageStorage implements VocabularyImageExportStorage {
  readonly nodes = new Map<string, {
    kind: VocabularyImageNodeKind;
    text?: string;
    binary?: ArrayBuffer;
  }>();
  failNextBinaryUpdatePath: string | null = null;

  inspect(path: string): VocabularyImageNodeKind | null {
    return this.nodes.get(path)?.kind ?? null;
  }

  async readText(path: string): Promise<string> {
    const node = this.nodes.get(path);
    if (node?.kind !== "file" || node.text === undefined) {
      throw new Error("not a text file");
    }
    return node.text;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const node = this.nodes.get(path);
    if (node?.kind !== "file" || node.binary === undefined) {
      throw new Error("not a binary file");
    }
    return node.binary.slice(0);
  }

  async createFolder(path: string): Promise<void> {
    this.nodes.set(path, { kind: "folder" });
  }

  async createText(path: string, content: string): Promise<void> {
    this.nodes.set(path, { kind: "file", text: content });
  }

  async updateText(path: string, content: string): Promise<void> {
    if (this.inspect(path) !== "file") {
      throw new Error("not a file");
    }
    this.nodes.set(path, { kind: "file", text: content });
  }

  async createBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.nodes.set(path, { kind: "file", binary: content.slice(0) });
  }

  async updateBinary(path: string, content: ArrayBuffer): Promise<void> {
    if (this.failNextBinaryUpdatePath === path) {
      this.failNextBinaryUpdatePath = null;
      throw new Error("simulated binary write failure");
    }
    if (this.inspect(path) !== "file") {
      throw new Error("not a file");
    }
    this.nodes.set(path, { kind: "file", binary: content.slice(0) });
  }

  async removeFile(path: string): Promise<void> {
    if (this.inspect(path) !== "file") {
      throw new Error("not a file");
    }
    this.nodes.delete(path);
  }
}

test("长图卡片包含完整字段、按最近使用和语境时间排序", () => {
  const older = entry({
    id: "older",
    word: "older",
    normalizedWord: "older",
    lastSeenAt: "2026-08-30T08:00:00.000Z"
  });
  const cards = buildVocabularyImageCards(book([older, entry()]));
  assert.deepEqual(cards.map((card) => card.word), ["study", "older"]);
  assert.deepEqual(
    cards[0]?.blocks.filter((block) => block.kind === "field"),
    [
      { kind: "field", label: "音标", value: "/ˈstʌdi/" },
      { kind: "field", label: "词性", value: "v. / n." },
      { kind: "field", label: "中文释义", value: "学习；研究" },
      { kind: "field", label: "English definition", value: "learn about a subject" },
      { kind: "field", label: "学习目标", value: "四级 · 六级" },
      { kind: "field", label: "个人备注", value: "注意过去式 studied" }
    ]
  );
  const contexts = cards[0]?.blocks.filter((block) => block.kind === "context") ?? [];
  assert.equal(contexts[0]?.kind === "context" ? contexts[0].sentence : "", "We study together.");
  assert.equal(contexts[1]?.kind === "context" ? contexts[1].sentence : "", "I study every day.");
  assert.equal(JSON.stringify(contexts).includes("sourcePath"), false);
  assert.equal(JSON.stringify(contexts).includes("timestamp"), false);
});

test("空字段不生成占位内容，特殊字符作为普通文本保留", () => {
  const cards = buildVocabularyImageCards(book([entry({
    word: "<study & learn>",
    phonetic: "",
    partOfSpeech: "",
    chineseTranslation: "",
    englishDefinition: "",
    examTags: [],
    studyProfiles: [],
    personalNote: "",
    contexts: []
  })]));
  assert.equal(cards[0]?.word, "<study & learn>");
  assert.deepEqual(cards[0]?.blocks, []);
});

test("真实测量高度按卡片边界分页并拒绝未拆分超高卡", () => {
  assert.deepEqual(
    paginateMeasuredVocabularyImageCards(
      [
        { value: "one", height: 40 },
        { value: "two", height: 50 },
        { value: "three", height: 60 }
      ],
      100,
      10
    ),
    [["one", "two"], ["three"]]
  );
  assert.throws(
    () => paginateMeasuredVocabularyImageCards([{ value: "too-tall", height: 101 }], 100, 10),
    /未拆分的超高/u
  );
});

test("首次生成固定图片和清单，再次导出刷新并清理多余分页", async () => {
  const storage = new MemoryImageStorage();
  const first = await writeVocabularyImageExport(
    storage,
    [bytes(1), bytes(2), bytes(3)],
    8,
    new Date("2026-09-01T01:02:03.000Z")
  );
  assert.deepEqual(first.paths, [
    `${VOCABULARY_IMAGE_EXPORT_DIR}/生词本-01.png`,
    `${VOCABULARY_IMAGE_EXPORT_DIR}/生词本-02.png`,
    `${VOCABULARY_IMAGE_EXPORT_DIR}/生词本-03.png`
  ]);
  assert.equal(first.pageCount, 3);
  assert.match(await storage.readText(VOCABULARY_IMAGE_MANIFEST_PATH), new RegExp(VOCABULARY_IMAGE_EXPORT_MARKER, "u"));
  assert.equal(storage.inspect("Lingua Study"), "folder");
  assert.equal(storage.inspect("Lingua Study/Vocabulary"), "folder");

  const second = await writeVocabularyImageExport(
    storage,
    [bytes(9)],
    2,
    new Date("2026-09-02T01:02:03.000Z")
  );
  assert.equal(second.removedPageCount, 2);
  assert.deepEqual(byteValues(await storage.readBinary(vocabularyImagePagePath(0))), [9]);
  assert.equal(storage.inspect(vocabularyImagePagePath(1)), null);
  assert.equal(storage.inspect(vocabularyImagePagePath(2)), null);
});

test("无插件清单的同名图片和损坏清单均拒绝覆盖", async () => {
  const occupied = new MemoryImageStorage();
  occupied.nodes.set("Lingua Study", { kind: "folder" });
  occupied.nodes.set("Lingua Study/Vocabulary", { kind: "folder" });
  occupied.nodes.set(VOCABULARY_IMAGE_EXPORT_DIR, { kind: "folder" });
  occupied.nodes.set(vocabularyImagePagePath(0), { kind: "file", binary: bytes(7) });
  await assert.rejects(
    writeVocabularyImageExport(occupied, [bytes(1)], 1, new Date(0)),
    /非 Lingua Study 管理的图片/u
  );
  assert.deepEqual(byteValues(await occupied.readBinary(vocabularyImagePagePath(0))), [7]);

  const damaged = new MemoryImageStorage();
  damaged.nodes.set("Lingua Study", { kind: "folder" });
  damaged.nodes.set("Lingua Study/Vocabulary", { kind: "folder" });
  damaged.nodes.set(VOCABULARY_IMAGE_EXPORT_DIR, { kind: "folder" });
  damaged.nodes.set(VOCABULARY_IMAGE_MANIFEST_PATH, { kind: "file", text: "{}" });
  await assert.rejects(
    writeVocabularyImageExport(damaged, [bytes(1)], 1, new Date(0)),
    /非 Lingua Study 生成的导出清单/u
  );
});

test("分页写入失败时恢复上一版图片且不修改原始生词数据", async () => {
  const storage = new MemoryImageStorage();
  const originalBook = book([entry()]);
  const snapshot = JSON.stringify(originalBook);
  await writeVocabularyImageExport(storage, [bytes(1), bytes(2)], 1, new Date(0));
  storage.failNextBinaryUpdatePath = vocabularyImagePagePath(1);
  await assert.rejects(
    writeVocabularyImageExport(storage, [bytes(8), bytes(9)], 1, new Date(1_000)),
    /simulated binary write failure/u
  );
  assert.deepEqual(byteValues(await storage.readBinary(vocabularyImagePagePath(0))), [1]);
  assert.deepEqual(byteValues(await storage.readBinary(vocabularyImagePagePath(1))), [2]);
  assert.equal(JSON.stringify(originalBook), snapshot);
});

test("空页面和无效页码会被拒绝", async () => {
  await assert.rejects(
    writeVocabularyImageExport(new MemoryImageStorage(), [], 0, new Date(0)),
    /没有可以写入/u
  );
  assert.throws(() => vocabularyImagePagePath(-1), /页码无效/u);
});
