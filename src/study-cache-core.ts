import {
  isStudyProfile,
  STUDY_ANALYSIS_VERSION,
  sourceContainsExpression,
  type SentenceStudyAnalysis,
  type StudyProfile
} from "./study-core";
import type { TranslationProvider } from "./translation-core";

export interface StudyCacheEntry {
  sourceText: string;
  profile: StudyProfile;
  analysisVersion: typeof STUDY_ANALYSIS_VERSION;
  analysis: SentenceStudyAnalysis;
  provider: Exclude<TranslationProvider, "disabled">;
  model: string;
  updatedAt: string;
}

export interface StudyCacheFile {
  version: 1;
  videoId: string;
  targetLanguage: "zh-CN";
  analyses: Record<string, StudyCacheEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim().length <= maximum;
}

function validAnalysis(value: unknown, sourceText: string): value is SentenceStudyAnalysis {
  if (!isRecord(value)) {
    return false;
  }
  return (
    validNonEmptyString(value.translation, 2_000) &&
    validNonEmptyString(value.examTip, 600) &&
    Array.isArray(value.keyPoints) && value.keyPoints.length <= 4 &&
    value.keyPoints.every((item) =>
      isRecord(item) &&
      validNonEmptyString(item.expression, 120) &&
      sourceContainsExpression(sourceText, item.expression) &&
      validNonEmptyString(item.meaning, 300) &&
      validNonEmptyString(item.note, 400)
    ) &&
    Array.isArray(value.grammar) && value.grammar.length <= 3 &&
    value.grammar.every((item) =>
      isRecord(item) &&
      validNonEmptyString(item.pattern, 200) &&
      validNonEmptyString(item.explanation, 500)
    ) &&
    (value.extensions === undefined || (
      Array.isArray(value.extensions) && value.extensions.length <= 2 &&
      value.extensions.every((item) =>
        isRecord(item) &&
        validNonEmptyString(item.anchor, 120) &&
        sourceContainsExpression(sourceText, item.anchor) &&
        validNonEmptyString(item.expression, 120) &&
        validNonEmptyString(item.meaning, 300) &&
        validNonEmptyString(item.note, 500) &&
        validNonEmptyString(item.example, 400) &&
        validNonEmptyString(item.exampleTranslation, 400)
      )
    ))
  );
}

export function getStudyCachePath(transcriptPath: string): string {
  const withoutJson = transcriptPath.toLowerCase().endsWith(".json")
    ? transcriptPath.slice(0, -5)
    : transcriptPath;
  return `${withoutJson}.zh-CN.study.json`;
}

export function createEmptyStudyCache(videoId: string): StudyCacheFile {
  return {
    version: 1,
    videoId,
    targetLanguage: "zh-CN",
    analyses: {}
  };
}

export function validateStudyCache(value: unknown, videoId: string): StudyCacheFile {
  if (!isRecord(value)) {
    throw new Error("知识卡缓存最外层不是 JSON 对象");
  }
  if (value.version !== 1 || value.videoId !== videoId || value.targetLanguage !== "zh-CN") {
    throw new Error("知识卡缓存版本、视频 ID 或目标语言不匹配");
  }
  if (!isRecord(value.analyses)) {
    throw new Error("知识卡缓存 analyses 字段格式不正确");
  }

  const analyses: Record<string, StudyCacheEntry> = {};
  for (const [fingerprint, rawEntry] of Object.entries(value.analyses)) {
    if (!/^[a-f0-9]{64}$/u.test(fingerprint) || !isRecord(rawEntry)) {
      throw new Error("知识卡缓存包含无效指纹或条目");
    }
    const profile = rawEntry.profile;
    const provider = rawEntry.provider;
    if (
      typeof rawEntry.sourceText !== "string" || rawEntry.sourceText.trim() === "" ||
      !isStudyProfile(profile) ||
      rawEntry.analysisVersion !== STUDY_ANALYSIS_VERSION ||
      !validAnalysis(rawEntry.analysis, rawEntry.sourceText) ||
      (provider !== "deepseek" && provider !== "kimi" && provider !== "openai-compatible") ||
      typeof rawEntry.model !== "string" || rawEntry.model.trim() === "" ||
      typeof rawEntry.updatedAt !== "string" || rawEntry.updatedAt.trim() === ""
    ) {
      throw new Error("知识卡缓存包含格式不正确的条目");
    }
    analyses[fingerprint] = {
      sourceText: rawEntry.sourceText,
      profile,
      analysisVersion: STUDY_ANALYSIS_VERSION,
      analysis: rawEntry.analysis,
      provider,
      model: rawEntry.model,
      updatedAt: rawEntry.updatedAt
    };
  }
  return {
    version: 1,
    videoId,
    targetLanguage: "zh-CN",
    analyses
  };
}

export function upsertStudyCacheEntry(
  current: StudyCacheFile,
  fingerprint: string,
  entry: StudyCacheEntry
): StudyCacheFile {
  return {
    ...current,
    analyses: {
      ...current.analyses,
      [fingerprint]: entry
    }
  };
}
