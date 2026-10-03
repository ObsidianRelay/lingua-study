import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "obsidian";
import { TFile, TFolder, normalizePath } from "./obsidian-vault-mock";
import { HighlightStore } from "../src/highlight-store";
import {
  HIGHLIGHT_BOOK_PATH,
  addHighlightAnnotation,
  createEmptyHighlightBook,
  createHighlightAnnotation
} from "../src/highlight-core";
import { VocabularyStore } from "../src/vocabulary-store";
import { TranslationCacheStore } from "../src/translation-cache";
import { StudyCacheStore } from "../src/study-cache";
import { getStudyCachePath, type StudyCacheEntry } from "../src/study-cache-core";
import { getTranslationCachePath } from "../src/translation-core";
import { createEmptyVocabularyBook, addVocabularyEntry, VOCABULARY_BOOK_PATH } from "../src/vocabulary-core";

class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  processCalls = 0;
  nextProcessRaw: string | null = null;
  readonly adapter = {
    exists: async (path: string) => this.files.has(normalizePath(path)),
    read: async (path: string) => this.files.get(normalizePath(path))!,
    list: async (path: string) => {
      const folder = normalizePath(path);
      const prefix = folder === "" ? "" : `${folder}/`;
      if (folder !== "" && !this.folders.has(folder) &&
          ![...this.files.keys()].some((file) => file.startsWith(prefix))) {
        throw new Error(`文件夹不存在：${folder}`);
      }
      return {
        files: [...this.files.keys()].filter((file) => file.startsWith(prefix) &&
          !file.slice(prefix.length).includes("/")),
        folders: [...this.folders].filter((folder) => folder.startsWith(prefix) &&
          !folder.slice(prefix.length).includes("/"))
      };
    }
  };

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) return new TFile(normalized);
    if (this.folders.has(normalized)) return new TFolder(normalized);
    return null;
  }

  async read(file: TFile): Promise<string> { return this.files.get(file.path)!; }
  async cachedRead(file: TFile): Promise<string> { return this.read(file); }
  async createFolder(path: string): Promise<TFolder> {
    this.folders.add(normalizePath(path));
    return new TFolder(normalizePath(path));
  }
  async create(path: string, content: string): Promise<TFile> {
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) throw new Error(`文件已存在：${normalized}`);
    this.files.set(normalized, content);
    return new TFile(normalized);
  }
  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }
  async process(file: TFile, update: (raw: string) => string): Promise<string> {
    this.processCalls += 1;
    if (this.nextProcessRaw !== null) {
      this.files.set(file.path, this.nextProcessRaw);
      this.nextProcessRaw = null;
    }
    const next = update(this.files.get(file.path)!);
    this.files.set(file.path, next);
    return next;
  }
}

function app(vault: FakeVault): App {
  const local = new Map<string, unknown>();
  return {
    vault,
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); }
  } as unknown as App;
}

function addInput() {
  return {
    rawWord: "study",
    dictionaryEntry: null,
    customMeaning: "学习",
    studyProfile: "cet4" as const,
    context: null,
    now: new Date("2026-10-02T00:00:00.000Z")
  };
}

test("首次缺失的生词本必须确认，曾见过的文件消失后拒绝重建", async () => {
  const vault = new FakeVault();
  const testApp = app(vault);
  let confirmations = 0;
  const store = new VocabularyStore(testApp, async () => {
    confirmations += 1;
    return confirmations > 1;
  });
  await assert.rejects(store.add(addInput()), /未创建生词本/u);
  assert.equal(vault.files.size, 0);
  await store.add(addInput());
  assert.equal(vault.files.has(VOCABULARY_BOOK_PATH), true);
  vault.files.delete(VOCABULARY_BOOK_PATH);
  await assert.rejects(store.add(addInput()), /曾存在但当前缺失/u);
  await assert.rejects(new VocabularyStore(testApp, async () => true).add(addInput()), /曾存在但当前缺失/u);
  assert.equal(confirmations, 2);
});

test("用户主动删除生词本后可通过明确确认重新建空库", async () => {
  const vault = new FakeVault();
  const testApp = app(vault);
  vault.files.set(VOCABULARY_BOOK_PATH, `${JSON.stringify(createEmptyVocabularyBook())}\n`);
  const first = new VocabularyStore(testApp);
  await first.load();
  vault.files.delete(VOCABULARY_BOOK_PATH);
  let previouslySeen = false;
  const store = new VocabularyStore(testApp, async (_path, seen) => {
    previouslySeen = seen === true;
    return true;
  });
  assert.match((await store.load()).warning ?? "", /重新建立空生词本/u);
  assert.equal(await store.recreateMissingFile(), true);
  assert.equal(previouslySeen, true);
  assert.deepEqual(JSON.parse(vault.files.get(VOCABULARY_BOOK_PATH)!), createEmptyVocabularyBook());
  await store.add(addInput());
  assert.equal(Object.keys((await store.load()).book.entries).length, 1);
});

test("确认期间同步文件出现时不覆盖生词本和高亮笔记", async () => {
  const vault = new FakeVault();
  const originalBook = `${JSON.stringify(createEmptyVocabularyBook())}\n`;
  const originalHighlights = `${JSON.stringify(createEmptyHighlightBook())}\n`;
  const testApp = app(vault);
  const vocabulary = new VocabularyStore(testApp, async () => {
    vault.files.set(VOCABULARY_BOOK_PATH, originalBook);
    return true;
  });
  const highlights = new HighlightStore(testApp, async () => {
    vault.files.set(HIGHLIGHT_BOOK_PATH, originalHighlights);
    return true;
  });
  assert.equal(await vocabulary.recreateMissingFile(), false);
  assert.equal(await highlights.recreateMissingFile(), false);
  assert.equal(vault.files.get(VOCABULARY_BOOK_PATH), originalBook);
  assert.equal(vault.files.get(HIGHLIGHT_BOOK_PATH), originalHighlights);
});

test("主动删除高亮笔记后可明确确认重建，普通写入仍拒绝", async () => {
  const vault = new FakeVault();
  const testApp = app(vault);
  vault.files.set(HIGHLIGHT_BOOK_PATH, `${JSON.stringify(createEmptyHighlightBook())}\n`);
  await new HighlightStore(testApp).load();
  vault.files.delete(HIGHLIGHT_BOOK_PATH);
  let previouslySeen = false;
  const store = new HighlightStore(testApp, async (_path, seen) => {
    previouslySeen = seen === true;
    return true;
  });
  assert.match((await store.load()).warning ?? "", /重新建立空高亮笔记/u);
  assert.equal(await store.recreateMissingFile(), true);
  assert.equal(previouslySeen, true);
  assert.deepEqual(JSON.parse(vault.files.get(HIGHLIGHT_BOOK_PATH)!), createEmptyHighlightBook());
});

test("坏词条恢复前留下完整原文和隔离文件", async () => {
  const vault = new FakeVault();
  const valid = addVocabularyEntry(createEmptyVocabularyBook(), addInput()).book;
  const raw = `${JSON.stringify({ ...valid, entries: {
    ...valid.entries,
    broken: { word: "broken", review: null }
  } }, null, 2)}\n`;
  vault.files.set(VOCABULARY_BOOK_PATH, raw);
  const store = new VocabularyStore(app(vault));
  const loaded = await store.load();
  assert.equal(Object.keys(loaded.book.entries).length, 1);
  assert.match(loaded.warning ?? "", /1 条格式错误/u);
  await store.updateNote("study", "已恢复");
  const paths = [...vault.files.keys()];
  const backup = paths.find((path) => path.endsWith(".backup.json"));
  const quarantine = paths.find((path) => path.endsWith(".quarantine.json"));
  assert.ok(backup);
  assert.ok(quarantine);
  assert.equal(vault.files.get(backup), raw);
  assert.match(vault.files.get(quarantine) ?? "", /"broken"/u);
  assert.equal(JSON.parse(vault.files.get(VOCABULARY_BOOK_PATH)!).entries.study.personalNote, "已恢复");
});

test("高亮文件缺失时也不会无提示创建", async () => {
  const vault = new FakeVault();
  const store = new HighlightStore(app(vault));
  await assert.rejects(store.add({
    id: "highlight-1",
    categoryIds: ["expression"],
    sourcePath: "a.md",
    transcriptPath: "a.json",
    videoId: "video",
    segmentIndex: 0,
    segmentStart: 0,
    segmentEnd: 2,
    segmentText: "Hi",
    startOffset: 0,
    endOffset: 2,
    now: new Date("2026-10-02T00:00:00.000Z")
  }), /未创建高亮笔记/u);
  assert.equal(vault.files.size, 0);
});

test("翻译缓存坏条目写回前保留原文件与隔离数据", async () => {
  const vault = new FakeVault();
  const transcriptPath = "Lingua Study/Transcripts/video.json";
  const cachePath = getTranslationCachePath(transcriptPath);
  const fingerprint = "a".repeat(64);
  const raw = `${JSON.stringify({
    version: 1,
    videoId: "video",
    targetLanguage: "zh-CN",
    translations: {
      [fingerprint]: { sourceText: "hello", text: "你好", provider: "baidu", model: "test", updatedAt: "now" },
      broken: { text: "bad" }
    }
  }, null, 2)}\n`;
  vault.files.set(cachePath, raw);
  const store = new TranslationCacheStore(app(vault));
  const loaded = await store.load(transcriptPath, "video");
  assert.equal(Object.keys(loaded.translations).length, 1);
  assert.match(loaded.warning ?? "", /1 条无效条目/u);
  await store.upsert(transcriptPath, "video", "b".repeat(64), {
    sourceText: "world", text: "世界", provider: "baidu", model: "test", updatedAt: "now"
  });
  const backup = [...vault.files.keys()].find((path) => path.endsWith(".backup.json"));
  assert.ok(backup);
  assert.equal(vault.files.get(backup), raw);
  assert.equal(Object.keys(JSON.parse(vault.files.get(cachePath)!).translations).length, 2);
});

test("写入冲突重试时同一份坏缓存只保留一份备份", async () => {
  const vault = new FakeVault();
  const transcriptPath = "Lingua Study/Transcripts/video.json";
  const cachePath = getTranslationCachePath(transcriptPath);
  const raw = `${JSON.stringify({ version: 1, videoId: "video", targetLanguage: "zh-CN",
    translations: { broken: { text: "bad" } } })}\n`;
  vault.files.set(cachePath, raw);
  vault.nextProcessRaw = `${raw} `;
  const store = new TranslationCacheStore(app(vault));
  const entry = { sourceText: "hello", text: "你好", provider: "baidu" as const,
    model: "test", updatedAt: "now" };
  await assert.rejects(store.upsert(transcriptPath, "video", "a".repeat(64), entry), /发生变化/u);
  vault.files.set(cachePath, raw);
  await store.upsert(transcriptPath, "video", "a".repeat(64), entry);
  assert.equal([...vault.files.keys()].filter((path) => path.endsWith(".backup.json")).length, 1);
  assert.equal([...vault.files.keys()].filter((path) => path.endsWith(".quarantine.json")).length, 1);
});

test("写入冲突重试时同一份坏生词本只保留一份备份", async () => {
  const vault = new FakeVault();
  const valid = addVocabularyEntry(createEmptyVocabularyBook(), addInput()).book;
  const raw = `${JSON.stringify({ ...valid, entries: { ...valid.entries, broken: { word: "broken" } } })}\n`;
  vault.files.set(VOCABULARY_BOOK_PATH, raw);
  vault.nextProcessRaw = `${raw} `;
  const store = new VocabularyStore(app(vault));
  await assert.rejects(store.updateNote("study", "test"), /发生变化/u);
  vault.files.set(VOCABULARY_BOOK_PATH, raw);
  await store.updateNote("study", "test");
  assert.equal([...vault.files.keys()].filter((path) => path.endsWith(".backup.json")).length, 1);
  assert.equal([...vault.files.keys()].filter((path) => path.endsWith(".quarantine.json")).length, 1);
});

test("翻译缓存外层不匹配和截断后仍可备份并继续写入", async () => {
  for (const [raw, useMany] of [
    [`${JSON.stringify({ version: 2, videoId: "old", targetLanguage: "zh-CN", translations: {} })}\n`, false],
    ["{\"version\":1,", true]
  ] as const) {
    const vault = new FakeVault();
    const transcriptPath = "Lingua Study/Transcripts/video.json";
    const cachePath = getTranslationCachePath(transcriptPath);
    vault.files.set(cachePath, raw);
    const store = new TranslationCacheStore(app(vault));
    const fingerprint = "c".repeat(64);
    const entry = { sourceText: "hello", text: "你好", provider: "baidu" as const,
      model: "test", updatedAt: "now" };
    if (useMany) await store.upsertMany(transcriptPath, "video", { [fingerprint]: entry });
    else await store.upsert(transcriptPath, "video", fingerprint, entry);
    const backup = [...vault.files.keys()].find((path) => path.endsWith(".backup.json"));
    assert.ok(backup);
    assert.equal(vault.files.get(backup), raw);
    assert.equal(JSON.parse(vault.files.get(cachePath)!).translations[fingerprint].text, "你好");
  }
});

test("根目录损坏缓存可备份并继续写入，重试复用同一份备份", async () => {
  const vault = new FakeVault();
  const transcriptPath = "wordbook.json";
  const cachePath = getTranslationCachePath(transcriptPath);
  const raw = "{\"version\":1,";
  vault.files.set(cachePath, raw);
  const store = new TranslationCacheStore(app(vault));
  const entry = { sourceText: "hello", text: "你好", provider: "baidu" as const,
    model: "test", updatedAt: "now" };
  vault.nextProcessRaw = `${raw} `;
  await assert.rejects(store.upsert(transcriptPath, "video", "a".repeat(64), entry), /发生变化/u);
  vault.files.set(cachePath, raw);
  await store.upsert(transcriptPath, "video", "a".repeat(64), entry);
  const backups = [...vault.files.keys()].filter((path) => path.endsWith(".backup.json"));
  assert.equal(backups.length, 1);
  assert.equal(vault.files.get(backups[0]!), raw);
  assert.equal(JSON.parse(vault.files.get(cachePath)!).translations["a".repeat(64)].text, "你好");
});

test("根目录知识卡缓存损坏后也可备份并继续写入", async () => {
  const vault = new FakeVault();
  const transcriptPath = "wordbook.json";
  const cachePath = getStudyCachePath(transcriptPath);
  const raw = "{\"version\":1,";
  vault.files.set(cachePath, raw);
  const entry: StudyCacheEntry = {
    sourceText: "I study English.", profile: "cet4", analysisVersion: 1,
    analysis: { translation: "我学习英语。", keyPoints: [], grammar: [], examTip: "掌握基本句型。" },
    provider: "deepseek", model: "test", updatedAt: "now"
  };
  const store = new StudyCacheStore(app(vault));
  await store.upsert(transcriptPath, "video", "b".repeat(64), entry);
  const backup = [...vault.files.keys()].find((path) => path.endsWith(".backup.json"));
  assert.ok(backup);
  assert.equal(vault.files.get(backup), raw);
  assert.equal(Object.keys((await store.load(transcriptPath, "video")).analyses).length, 1);
});

test("知识卡缓存外层视频不匹配后备份原文并重建", async () => {
  const vault = new FakeVault();
  const transcriptPath = "Lingua Study/Transcripts/video.json";
  const cachePath = getStudyCachePath(transcriptPath);
  const raw = `${JSON.stringify({ version: 1, videoId: "old", targetLanguage: "zh-CN", analyses: {} })}\n`;
  vault.files.set(cachePath, raw);
  const entry: StudyCacheEntry = {
    sourceText: "I study English.", profile: "cet4", analysisVersion: 1,
    analysis: { translation: "我学习英语。", keyPoints: [], grammar: [], examTip: "掌握基本句型。" },
    provider: "deepseek", model: "test", updatedAt: "now"
  };
  const store = new StudyCacheStore(app(vault));
  await store.upsert(transcriptPath, "video", "d".repeat(64), entry);
  const backup = [...vault.files.keys()].find((path) => path.endsWith(".backup.json"));
  assert.ok(backup);
  assert.equal(vault.files.get(backup), raw);
  assert.equal(JSON.parse(vault.files.get(cachePath)!).videoId, "video");
  assert.equal(Object.keys((await store.load(transcriptPath, "video")).analyses).length, 1);
});

test("字幕文件夹移动后更新生词语境中的路径", async () => {
  const vault = new FakeVault();
  const entry = addVocabularyEntry(createEmptyVocabularyBook(), {
    ...addInput(),
    context: {
      sentence: "I study English.",
      sourcePath: "Notes/video.md",
      transcriptPath: "Transcripts/video.json",
      videoId: "video",
      segmentIndex: 0,
      start: 1,
      end: 3
    }
  }).book;
  vault.files.set(VOCABULARY_BOOK_PATH, `${JSON.stringify(entry)}\n`);
  const store = new VocabularyStore(app(vault));
  assert.equal(await store.pathsRenamed("Unrelated", "Elsewhere"), false);
  assert.equal(vault.processCalls, 0);
  assert.equal(await store.pathsRenamed("Transcripts", "Study/Transcripts"), true);
  assert.equal((await store.load()).book.entries.study?.contexts[0]?.transcriptPath,
    "Study/Transcripts/video.json");
  assert.equal((await store.load()).book.entries.study?.contexts[0]?.sourcePath,
    "Notes/video.md");
});

test("来源笔记移动后更新高亮引用", async () => {
  const vault = new FakeVault();
  const annotation = createHighlightAnnotation({
    id: "highlight-1", categoryIds: ["expression"],
    sourcePath: "Notes/video.md", transcriptPath: "Transcripts/video.json",
    videoId: "video", segmentIndex: 0, segmentStart: 0, segmentEnd: 2,
    segmentText: "Hi", startOffset: 0, endOffset: 2,
    now: new Date("2026-10-02T00:00:00.000Z")
  });
  vault.files.set(HIGHLIGHT_BOOK_PATH, `${JSON.stringify(
    addHighlightAnnotation(createEmptyHighlightBook(), annotation))}\n`);
  const store = new HighlightStore(app(vault));
  assert.equal(await store.pathsRenamed("Notes", "Moved/Notes"), true);
  assert.equal((await store.load()).book.annotations["highlight-1"]?.sourcePath,
    "Moved/Notes/video.md");
});

test("含引号的路径重命名仍可更新 JSON 中转义的生词和高亮路径", async () => {
  const vault = new FakeVault();
  const oldPath = 'Notes/old"folder';
  const newPath = "Notes/new-folder";
  const entry = addVocabularyEntry(createEmptyVocabularyBook(), {
    ...addInput(),
    context: {
      sentence: "I study English.", sourcePath: `${oldPath}/video.md`,
      transcriptPath: "Transcripts/video.json", videoId: "video",
      segmentIndex: 0, start: 1, end: 3
    }
  }).book;
  const annotation = createHighlightAnnotation({
    id: "highlight-quote", categoryIds: ["expression"],
    sourcePath: `${oldPath}/video.md`, transcriptPath: "Transcripts/video.json",
    videoId: "video", segmentIndex: 0, segmentStart: 0, segmentEnd: 2,
    segmentText: "Hi", startOffset: 0, endOffset: 2,
    now: new Date("2026-10-02T00:00:00.000Z")
  });
  vault.files.set(VOCABULARY_BOOK_PATH, `${JSON.stringify(entry)}\n`);
  vault.files.set(HIGHLIGHT_BOOK_PATH, `${JSON.stringify(
    addHighlightAnnotation(createEmptyHighlightBook(), annotation))}\n`);
  assert.equal(await new VocabularyStore(app(vault)).pathsRenamed(oldPath, newPath), true);
  assert.equal(await new HighlightStore(app(vault)).pathsRenamed(oldPath, newPath), true);
  assert.match(vault.files.get(VOCABULARY_BOOK_PATH) ?? "", /Notes\/new-folder\/video.md/u);
  assert.match(vault.files.get(HIGHLIGHT_BOOK_PATH) ?? "", /Notes\/new-folder\/video.md/u);
});

test("高亮笔记在读取后被同步改动时拒绝覆盖", async () => {
  const vault = new FakeVault();
  const annotation = createHighlightAnnotation({
    id: "highlight-sync", categoryIds: ["expression"],
    sourcePath: "Notes/old/video.md", transcriptPath: "Transcripts/video.json",
    videoId: "video", segmentIndex: 0, segmentStart: 0, segmentEnd: 2,
    segmentText: "Hi", startOffset: 0, endOffset: 2,
    now: new Date("2026-10-02T00:00:00.000Z")
  });
  vault.files.set(HIGHLIGHT_BOOK_PATH, `${JSON.stringify(
    addHighlightAnnotation(createEmptyHighlightBook(), annotation))}\n`);
  const newer = `${vault.files.get(HIGHLIGHT_BOOK_PATH)!} `;
  vault.nextProcessRaw = newer;
  await assert.rejects(new HighlightStore(app(vault)).pathsRenamed("Notes/old", "Notes/new"), /发生变化/u);
  assert.equal(vault.files.get(HIGHLIGHT_BOOK_PATH), newer);
});
