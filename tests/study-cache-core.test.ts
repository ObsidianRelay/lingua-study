import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyStudyCache,
  getStudyCachePath,
  upsertStudyCacheEntry,
  validateStudyCache,
  type StudyCacheEntry
} from "../src/study-cache-core";

const entry: StudyCacheEntry = {
  sourceText: "I study English.",
  profile: "cet4",
  analysisVersion: 1,
  analysis: {
    translation: "我学习英语。",
    keyPoints: [],
    grammar: [],
    examTip: "掌握基本句型。",
    extensions: [{
      anchor: "study",
      expression: "study for an exam",
      meaning: "为考试学习",
      note: "由原句动词延伸。",
      example: "I study for an exam.",
      exampleTranslation: "我为考试学习。"
    }]
  },
  provider: "deepseek",
  model: "test-model",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

test("知识卡缓存使用独立路径并保留不同指纹", () => {
  assert.equal(
    getStudyCachePath("Lingua Study/Transcripts/video.json"),
    "Lingua Study/Transcripts/video.zh-CN.study.json"
  );
  let cache = createEmptyStudyCache("video");
  cache = upsertStudyCacheEntry(cache, "a".repeat(64), entry);
  cache = upsertStudyCacheEntry(cache, "b".repeat(64), { ...entry, profile: "ielts" });
  cache = upsertStudyCacheEntry(cache, "d".repeat(64), { ...entry, profile: "tem8" });
  cache = upsertStudyCacheEntry(cache, "e".repeat(64), { ...entry, profile: "toefl" });
  const validated = validateStudyCache(cache, "video");
  assert.equal(Object.keys(validated.analyses).length, 4);
  assert.equal(validated.analyses["a".repeat(64)]?.profile, "cet4");
  assert.equal(validated.analyses["b".repeat(64)]?.profile, "ielts");
  assert.equal(validated.analyses["d".repeat(64)]?.profile, "tem8");
  assert.equal(validated.analyses["e".repeat(64)]?.profile, "toefl");
  assert.equal(validated.analyses["a".repeat(64)]?.analysis.extensions?.length, 1);
  const kimiCache = upsertStudyCacheEntry(
    createEmptyStudyCache("video"),
    "f".repeat(64),
    { ...entry, provider: "kimi", model: "kimi-k2.6" }
  );
  assert.equal(validateStudyCache(kimiCache, "video").analyses["f".repeat(64)]?.provider, "kimi");
  const legacy = validateStudyCache({
    ...cache,
    analyses: {
      ["c".repeat(64)]: {
        ...entry,
        analysis: { ...entry.analysis, extensions: undefined }
      }
    }
  }, "video");
  assert.equal(legacy.analyses["c".repeat(64)]?.analysis.extensions, undefined);
});

test("知识卡缓存拒绝错误视频、条目和超量内容", () => {
  const cache = upsertStudyCacheEntry(createEmptyStudyCache("video"), "a".repeat(64), entry);
  assert.throws(() => validateStudyCache(cache, "other"), /不匹配/u);
  assert.throws(() => validateStudyCache({
    ...cache,
    analyses: { ["a".repeat(64)]: { ...entry, profile: "gre" } }
  }, "video"), /格式不正确/u);
  assert.throws(() => validateStudyCache({
    ...cache,
    analyses: {
      ["a".repeat(64)]: {
        ...entry,
        analysis: {
          ...entry.analysis,
          keyPoints: [{ expression: "absent", meaning: "未出现", note: "无效" }]
        }
      }
    }
  }, "video"), /格式不正确/u);
  assert.throws(() => validateStudyCache({
    ...cache,
    analyses: {
      ["a".repeat(64)]: {
        ...entry,
        analysis: { ...entry.analysis, examTip: "a".repeat(601) }
      }
    }
  }, "video"), /格式不正确/u);
  assert.throws(() => validateStudyCache({
    ...cache,
    analyses: {
      ["a".repeat(64)]: {
        ...entry,
        analysis: {
          ...entry.analysis,
          extensions: [{
            ...(entry.analysis.extensions?.[0] ?? {}),
            anchor: "absent"
          }]
        }
      }
    }
  }, "video"), /格式不正确/u);
});
