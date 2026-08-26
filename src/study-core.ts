import {
  parseTranslationResponse,
  readCompletionFinishReason,
  type TranslationProvider,
  type TranslationRequestBody
} from "./translation-core";

export const STUDY_PROFILES = ["cet4", "cet6", "tem4", "tem8", "ielts", "toefl"] as const;

export type StudyProfile = typeof STUDY_PROFILES[number];

export function isStudyProfile(value: unknown): value is StudyProfile {
  return typeof value === "string" && (STUDY_PROFILES as readonly string[]).includes(value);
}

export interface StudyKeyPoint {
  expression: string;
  meaning: string;
  note: string;
}

export interface StudyGrammarPoint {
  pattern: string;
  explanation: string;
}

export interface StudyExtensionPoint {
  anchor: string;
  expression: string;
  meaning: string;
  note: string;
  example: string;
  exampleTranslation: string;
}

export interface SentenceStudyAnalysis {
  translation: string;
  keyPoints: StudyKeyPoint[];
  grammar: StudyGrammarPoint[];
  examTip: string;
  /** 兼容旧缓存；新生成的知识卡始终写入该字段。 */
  extensions?: StudyExtensionPoint[];
}

export interface StudyAnalysisParseResult {
  translation: string;
  analysis: SentenceStudyAnalysis | null;
  warning: string | null;
}

interface ParsedStudyAnalysisObject {
  analysis: SentenceStudyAnalysis;
  rejectedKeyPointCount: number;
  rejectedGrammarCount: number;
}

export interface StudyDictionaryHint {
  word: string;
  tags: StudyProfile[];
}

export const STUDY_ANALYSIS_VERSION = 1;

export const STUDY_PROFILE_LABELS: Readonly<Record<StudyProfile, string>> = {
  cet4: "四级",
  cet6: "六级",
  tem4: "专四",
  tem8: "专八",
  ielts: "雅思",
  toefl: "托福"
};

export const STUDY_PROFILE_LONG_LABELS: Readonly<Record<StudyProfile, string>> = {
  cet4: "大学英语四级",
  cet6: "大学英语六级",
  tem4: "英语专业四级（TEM-4）",
  tem8: "英语专业八级（TEM-8）",
  ielts: "雅思",
  toefl: "托福（TOEFL）"
};

const PROFILE_INSTRUCTIONS: Readonly<Record<StudyProfile, string>> = {
  cet4: "面向大学英语四级考生，优先解释四级核心词汇、常用搭配和基础可复用句型，不罗列过于简单的词。",
  cet6: "面向大学英语六级考生，优先解释中高级词汇、固定搭配和长难句结构；基础四级词仅在用法特殊时解释。",
  tem4: "面向英语专业四级（TEM-4）学习者，优先解释准确词义、词形变化、固定搭配、语法辨析和可复用句型，突出英语专业基础能力；不得声称内容属于官方固定词表。",
  tem8: "面向英语专业八级（TEM-8）学习者，优先解释高级词汇、细微语义、修辞与文体、复杂句法以及翻译和写作中的自然用法；不得声称内容属于官方固定词表。",
  ielts: "面向雅思考生，优先解释学术词汇、自然搭配、同义改写及口语或写作用法；不得声称存在官方固定雅思词表。",
  toefl: "面向托福（TOEFL）学习者，优先解释学术词汇、讲座与讨论场景搭配、同义改写、逻辑关系和复杂句结构，并提示听说读写中的自然用法；不得声称内容属于官方固定词表。"
};

const STUDY_SYSTEM_PROMPT = [
  "你是一名严谨的英语备考教师。",
  "只分析用户给出的一个英文句子，不补写上下文，不虚构考试大纲归属。",
  "必须只输出一个 JSON 对象，不使用 Markdown 代码块或额外文字。",
  "JSON 结构必须为：",
  '{"translation":"自然中文译文","keyPoints":[{"expression":"原句中的词或搭配","meaning":"中文含义","note":"用法说明"}],"grammar":[{"pattern":"语法或可复用句型","explanation":"中文讲解"}],"examTip":"对应备考目标的简短提示","extensions":[{"anchor":"原句中确实存在的关联词或结构","expression":"由锚点延伸出的新表达","meaning":"中文含义","note":"它与原句锚点的关联及用法","example":"自然英文例句","exampleTranslation":"例句中文"}]}。',
  "keyPoints 最多 4 项；expression 应逐字出现在英文原句中。分析 from...to... 等非连续结构时，可用 ... 连接至少两个原句片段，但片段必须按原句顺序出现；grammar 最多 3 项。",
  "extensions 是延伸拓展，最多 2 项。每项 anchor 必须逐字出现在原句中；expression 可以不在原句中，但必须由 anchor 自然延伸，只选择近义表达、常用搭配、词形变化、易混用法或相关语境，不得添加与原句无明确关系的知识。",
  "保持内容简洁：translation 不超过 600 字；meaning 不超过 80 字；note 不超过 120 字；pattern 不超过 100 字；explanation 不超过 160 字；examTip 不超过 120 字；拓展例句及译文各不超过 160 字。",
  "没有值得讲解的项目时对应数组返回空数组，不要强行凑数；translation 和 examTip 不能省略。"
].join("");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`知识卡缺少${label}。`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw new Error(`知识卡中的${label}过长，未保存本次结果。`);
  }
  return text;
}

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("知识卡服务没有返回有效 JSON，请重试。");
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error("知识卡服务返回的 JSON 格式不正确，请重试。");
  }
}

function extractTranslationFromIncompleteJson(value: string): string | null {
  const match = /"translation"\s*:\s*/u.exec(value);
  if (!match) {
    return null;
  }
  const start = (match.index ?? 0) + match[0].length;
  if (value[start] !== "\"") {
    return null;
  }
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") {
      try {
        const parsed = JSON.parse(value.slice(start, index + 1)) as unknown;
        return typeof parsed === "string" && parsed.trim() !== "" ? parsed.trim() : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sourceContainsExpression(sourceText: string, expression: string): boolean {
  const foldedSource = sourceText.toLocaleLowerCase("en-US");
  const foldedExpression = expression.toLocaleLowerCase("en-US");
  if (foldedSource.includes(foldedExpression)) {
    return true;
  }

  // 模型有时会把非连续结构概括为 from...to... 或 not only…but also…。
  // 只接受至少两个非空片段，并逐段验证它们确实按顺序出现在原句中；这样既支持
  // 省略结构，也不会让单独的 “word...” 绕过原句校验。
  const fragments = foldedExpression
    .split(/(?:\.{3,}|…+)/u)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment !== "");
  if (fragments.length < 2) {
    return false;
  }

  let searchFrom = 0;
  for (const fragment of fragments) {
    const position = foldedSource.indexOf(fragment, searchFrom);
    if (position < 0) {
      return false;
    }
    searchFrom = position + fragment.length;
  }
  return true;
}

function parseStudyAnalysisObject(
  parsed: Record<string, unknown>,
  sourceText: string,
  translation: string
): ParsedStudyAnalysisObject {
  if (!Array.isArray(parsed.keyPoints) || parsed.keyPoints.length > 4) {
    throw new Error("知识卡的重点词汇数量或格式不正确。");
  }
  const rejectionReasons: string[] = [];
  const keyPoints: StudyKeyPoint[] = [];
  let rejectedKeyPointCount = 0;
  for (const [index, item] of parsed.keyPoints.entries()) {
    try {
      if (!isRecord(item)) {
        throw new Error(`知识卡的第 ${index + 1} 个重点词汇格式不正确。`);
      }
      const expression = boundedString(item.expression, "重点表达", 120);
      if (!sourceContainsExpression(sourceText, expression)) {
        throw new Error(`重点表达“${expression}”不在英文原句中。`);
      }
      keyPoints.push({
        expression,
        meaning: boundedString(item.meaning, "重点表达含义", 300),
        note: boundedString(item.note, "重点表达说明", 400)
      });
    } catch (caught) {
      rejectedKeyPointCount += 1;
      rejectionReasons.push(caught instanceof Error ? caught.message : "重点表达格式异常。");
    }
  }

  if (!Array.isArray(parsed.grammar) || parsed.grammar.length > 3) {
    throw new Error("知识卡的语法句型数量或格式不正确。");
  }
  const grammar: StudyGrammarPoint[] = [];
  let rejectedGrammarCount = 0;
  for (const [index, item] of parsed.grammar.entries()) {
    try {
      if (!isRecord(item)) {
        throw new Error(`知识卡的第 ${index + 1} 个语法句型格式不正确。`);
      }
      grammar.push({
        pattern: boundedString(item.pattern, "语法句型", 200),
        explanation: boundedString(item.explanation, "语法讲解", 500)
      });
    } catch (caught) {
      rejectedGrammarCount += 1;
      rejectionReasons.push(caught instanceof Error ? caught.message : "语法句型格式异常。");
    }
  }

  const extensions: StudyExtensionPoint[] = [];
  const extensionItems = Array.isArray(parsed.extensions) ? parsed.extensions.slice(0, 2) : [];
  for (const item of extensionItems) {
    try {
      if (!isRecord(item)) {
        continue;
      }
      const anchor = boundedString(item.anchor, "拓展关联词", 120);
      if (!sourceContainsExpression(sourceText, anchor)) {
        continue;
      }
      extensions.push({
        anchor,
        expression: boundedString(item.expression, "拓展表达", 120),
        meaning: boundedString(item.meaning, "拓展表达含义", 300),
        note: boundedString(item.note, "拓展说明", 500),
        example: boundedString(item.example, "拓展英文例句", 400),
        exampleTranslation: boundedString(item.exampleTranslation, "拓展例句译文", 400)
      });
    } catch {
      // 延伸内容不是核心结果；单项不合格时静默跳过，避免用户看到技术校验提示。
    }
  }

  const submittedItemCount = parsed.keyPoints.length + parsed.grammar.length;
  if (submittedItemCount > 0 && keyPoints.length + grammar.length + extensions.length === 0) {
    throw new Error(`${rejectionReasons[0] ?? "知识点格式异常。"}没有其他有效知识内容可保存。`);
  }

  return {
    analysis: {
      translation,
      keyPoints,
      grammar,
      examTip: boundedString(parsed.examTip, "备考提示", 600),
      extensions
    },
    rejectedKeyPointCount,
    rejectedGrammarCount
  };
}

export function buildStudyAnalysisRequestBody(
  provider: Exclude<TranslationProvider, "disabled">,
  model: string,
  sourceText: string,
  profile: StudyProfile,
  dictionaryHints: readonly StudyDictionaryHint[]
): TranslationRequestBody {
  const hints = dictionaryHints.slice(0, 12).map((hint) => ({
    word: hint.word,
    tags: hint.tags
  }));
  const body: TranslationRequestBody = {
    model,
    messages: [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          studyGoal: STUDY_PROFILE_LABELS[profile],
          instructions: PROFILE_INSTRUCTIONS[profile],
          dictionaryTagsForReferenceOnly: hints,
          sentence: sourceText
        })
      }
    ],
    stream: false,
    max_tokens: 1_600
  };
  if (provider === "deepseek" || provider === "kimi") {
    body.thinking = { type: "disabled" };
  }
  return body;
}

export function parseStudyAnalysisResult(
  response: unknown,
  sourceText: string
): StudyAnalysisParseResult {
  const content = parseTranslationResponse(response);
  const finishReason = readCompletionFinishReason(response);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(content);
  } catch (caught) {
    const partialTranslation = extractTranslationFromIncompleteJson(content);
    if (partialTranslation) {
      const translation = boundedString(partialTranslation, "中文译文", 2_000);
      return {
        translation,
        analysis: null,
        warning: finishReason === "length"
          ? "译文已生成，但知识点输出被截断；可点击“补充知识点”重试。"
          : "译文已生成，但知识点 JSON 格式异常；可点击“补充知识点”重试。"
      };
    }
    if (finishReason === "length") {
      throw new Error("知识卡输出被截断，未能读取完整译文；请点击重试翻译。");
    }
    throw caught;
  }
  if (!isRecord(parsed)) {
    throw new Error("知识卡最外层必须是 JSON 对象。");
  }
  const translation = boundedString(parsed.translation, "中文译文", 2_000);
  if (finishReason === "length") {
    return {
      translation,
      analysis: null,
      warning: "译文已生成，但知识点输出被截断；可点击“补充知识点”重试。"
    };
  }
  if (finishReason === "content_filter") {
    return {
      translation,
      analysis: null,
      warning: "译文已生成，但知识点被服务商内容过滤；可调整句子后重试。"
    };
  }
  try {
    const parsedAnalysis = parseStudyAnalysisObject(parsed, sourceText, translation);
    return {
      translation,
      analysis: parsedAnalysis.analysis,
      // 单个知识项未通过校验时静默过滤。只要仍有可用知识内容，
      // 就向用户展示完整结果，不暴露容易造成困惑的内部校验统计。
      warning: null
    };
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "知识点格式异常。";
    return {
      translation,
      analysis: null,
      warning: `译文已生成，但${reason}可点击“补充知识点”重试。`
    };
  }
}

export function parseStudyAnalysisResponse(
  response: unknown,
  sourceText: string
): SentenceStudyAnalysis {
  const result = parseStudyAnalysisResult(response, sourceText);
  if (!result.analysis) {
    throw new Error(result.warning ?? "知识卡生成失败，请重试。");
  }
  return result.analysis;
}

export async function createStudyFingerprint(
  start: number,
  end: number,
  text: string,
  profile: StudyProfile,
  cryptoProvider: Crypto = window.crypto
): Promise<string> {
  const input = JSON.stringify([
    STUDY_ANALYSIS_VERSION,
    profile,
    start,
    end,
    text
  ]);
  const bytes = new TextEncoder().encode(input);
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
