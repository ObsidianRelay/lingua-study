import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentImportDraftKey,
  DocumentImportDraftStore,
  validateDocumentImportDraft
} from "../src/document-import-draft";

function createDraft(phase: "input" | "preview" | "aligning" | "result" = "result") {
  return {
    version: 1,
    sourceText: "Hello.\n你好。",
    rows: [{ english: "Hello.", chinese: "你好。" }],
    result: {
      rows: [{ english: "Hello.", chinese: "你好。", start: 1, end: 2, confidence: 0.9 }],
      matchedCount: 1,
      lowConfidenceCount: 0,
      averageConfidence: 0.9
    },
    timeInputs: [{ start: "00:01.00", end: "00:02.00", startInvalid: false, endInvalid: false }],
    manuallyCalibratedRows: [0],
    activeCalibrationIndex: 0,
    previewCurrentTime: 1,
    modalScrollTop: 10,
    previewListScrollTop: 20,
    resultListScrollTop: 30,
    phase,
    statusMessage: "已完成",
    statusError: false,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
}

test("字幕导入草稿按笔记和视频身份隔离", () => {
  const first = createDocumentImportDraftKey("视频学习/A.md", "bvid", "BV1234567890", 1);
  const second = createDocumentImportDraftKey("视频学习/B.md", "bvid", "BV1234567890", 1);
  const third = createDocumentImportDraftKey("视频学习/A.md", "bvid", "BV1234567890", 2);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
});

test("有效草稿完整恢复，运行中阶段在重启后退回可重试状态", () => {
  const restored = validateDocumentImportDraft(createDraft("aligning"));
  assert.ok(restored);
  assert.equal(restored.phase, "preview");
  assert.equal(restored.statusError, true);
  assert.match(restored.statusMessage, /中断/u);
  assert.equal(restored.result?.rows[0]?.start, 1);
});

test("损坏或版本不兼容的草稿会被拒绝", () => {
  assert.equal(validateDocumentImportDraft({ ...createDraft(), version: 2 }), null);
  assert.equal(validateDocumentImportDraft({ ...createDraft(), rows: [{ english: 1 }] }), null);
  assert.equal(validateDocumentImportDraft(null), null);
});

test("草稿存储会保留其他视频并只删除目标草稿", async () => {
  const files = new Map<string, string>();
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => files.get(path) ?? "",
        write: async (path: string, value: string) => {
          files.set(path, value);
        }
      }
    }
  };
  const store = new DocumentImportDraftStore(app as never, "lingua-study");
  const first = "first";
  const second = "second";
  const firstDraft = validateDocumentImportDraft(createDraft());
  const secondDraft = validateDocumentImportDraft({
    ...createDraft("preview"),
    sourceText: "Second"
  });
  assert.ok(firstDraft);
  assert.ok(secondDraft);
  await store.save(first, firstDraft);
  await store.save(second, secondDraft);
  assert.equal((await store.load(first)).draft?.sourceText, "Hello.\n你好。");
  assert.equal((await store.load(second)).draft?.sourceText, "Second");
  await store.remove(first);
  assert.equal((await store.load(first)).draft, null);
  assert.equal((await store.load(second)).draft?.sourceText, "Second");
});
