import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  buildStudyAnalysisRequestBody,
  createStudyFingerprint,
  parseStudyAnalysisResult,
  parseStudyAnalysisResponse,
  STUDY_PROFILES,
  STUDY_PROFILE_LABELS
} from "../src/study-core";

function response(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

test("八个学习目标生成独立提示且 DeepSeek 与 Kimi 关闭思考模式", () => {
  assert.deepEqual(STUDY_PROFILES, ["zk", "gk", "cet4", "cet6", "tem4", "tem8", "ielts", "toefl"]);
  const cet4 = buildStudyAnalysisRequestBody("deepseek", "model", "I study English.", "cet4", [
    { word: "study", tags: ["cet4", "ielts"] }
  ]);
  assert.deepEqual(cet4.thinking, { type: "disabled" });
  const kimi = buildStudyAnalysisRequestBody("kimi", "kimi-k2.6", "I study English.", "cet4", []);
  assert.deepEqual(kimi.thinking, { type: "disabled" });
  const prompts = STUDY_PROFILES.map((profile) => {
    const body = buildStudyAnalysisRequestBody(
      "openai-compatible",
      "model",
      "I study English.",
      profile,
      []
    );
    assert.equal("thinking" in body, false);
    assert.match(body.messages[1]?.content ?? "", new RegExp(STUDY_PROFILE_LABELS[profile], "u"));
    return body.messages[1]?.content ?? "";
  });
  assert.equal(new Set(prompts).size, STUDY_PROFILES.length);
  assert.match(prompts[0] ?? "", /初中七至九年级/u);
  assert.match(prompts[1] ?? "", /普通高中/u);
  assert.equal(cet4.max_tokens, 1_600);
  assert.match(cet4.messages[0]?.content ?? "", /extensions/u);
});

test("解析完整知识卡并接受 JSON 代码围栏", () => {
  const parsed = parseStudyAnalysisResponse(response(`\n\`\`\`json\n${JSON.stringify({
    translation: "我学习英语。",
    keyPoints: [{ expression: "study English", meaning: "学习英语", note: "常见搭配" }],
    grammar: [{ pattern: "主语 + 动词 + 宾语", explanation: "基本句型" }],
    examTip: "注意 study 的动词用法。",
    extensions: [{
      anchor: "study",
      expression: "study for an exam",
      meaning: "为考试而学习",
      note: "由 study 的具体学习目标延伸。",
      example: "She is studying for an exam.",
      exampleTranslation: "她正在为考试学习。"
    }]
  })}\n\`\`\``), "I study English.");
  assert.equal(parsed.translation, "我学习英语。");
  assert.equal(parsed.keyPoints[0]?.expression, "study English");
  assert.equal(parsed.grammar[0]?.pattern, "主语 + 动词 + 宾语");
  assert.equal(parsed.extensions?.[0]?.expression, "study for an exam");
});

test("延伸拓展必须锚定原句且无效项会静默跳过", () => {
  const parsed = parseStudyAnalysisResult(response(JSON.stringify({
    translation: "我学习英语。",
    keyPoints: [{ expression: "study English", meaning: "学习英语", note: "常见搭配" }],
    grammar: [],
    examTip: "注意 study 的用法。",
    extensions: [
      {
        anchor: "study",
        expression: "study for an exam",
        meaning: "为考试而学习",
        note: "由 study 延伸出的常见搭配。",
        example: "I study for an exam every evening.",
        exampleTranslation: "我每天晚上为考试学习。"
      },
      {
        anchor: "French",
        expression: "French cuisine",
        meaning: "法国菜",
        note: "与原句无关。",
        example: "I like French cuisine.",
        exampleTranslation: "我喜欢法国菜。"
      }
    ]
  })), "I study English.");

  assert.ok(parsed.analysis);
  assert.deepEqual(parsed.analysis.extensions, [{
    anchor: "study",
    expression: "study for an exam",
    meaning: "为考试而学习",
    note: "由 study 延伸出的常见搭配。",
    example: "I study for an exam every evening.",
    exampleTranslation: "我每天晚上为考试学习。"
  }]);
  assert.equal(parsed.warning, null);
});

test("拒绝不在原句中的重点表达和异常知识卡", () => {
  assert.throws(() => parseStudyAnalysisResponse(response(JSON.stringify({
    translation: "我学习英语。",
    keyPoints: [{ expression: "learn French", meaning: "学习法语", note: "虚构内容" }],
    grammar: [],
    examTip: "提示"
  })), "I study English."), /不在英文原句/u);
  assert.throws(() => parseStudyAnalysisResponse(response("not json"), "Hello."), /有效 JSON/u);
  assert.throws(() => parseStudyAnalysisResponse(response(JSON.stringify({
    translation: "你好。",
    keyPoints: [],
    grammar: [],
    examTip: "x".repeat(601)
  })), "Hello."), /过长/u);
});

test("省略号连接的重点表达必须按顺序来自英文原句", () => {
  const source = "Perched at the crossroads of continents and cultures, it has seen massive changes from the name of the city where it stands, to its own structure and purpose.";
  const validExpressions = ["from...to...", "from…to…", "FROM...TO..."];

  for (const expression of validExpressions) {
    const parsed = parseStudyAnalysisResponse(response(JSON.stringify({
      translation: "它见证了从城市名称到自身结构和用途的巨大变化。",
      keyPoints: [{ expression, meaning: "从……到……", note: "表示变化的范围" }],
      grammar: [],
      examTip: "注意非连续结构中的两个对应部分。"
    })), source);
    assert.equal(parsed.keyPoints[0]?.expression, expression);
  }

  for (const expression of ["to...from...", "from...missing...", "from..."]) {
    assert.throws(() => parseStudyAnalysisResponse(response(JSON.stringify({
      translation: "译文",
      keyPoints: [{ expression, meaning: "含义", note: "说明" }],
      grammar: [],
      examTip: "提示"
    })), source), /不在英文原句/u);
  }
});

test("知识点格式异常时仍保留有效中文译文", () => {
  const parsed = parseStudyAnalysisResult(response(JSON.stringify({
    translation: "我学习英语。",
    keyPoints: [{ expression: "learn French", meaning: "学习法语", note: "虚构内容" }],
    grammar: [],
    examTip: "提示"
  })), "I study English.");

  assert.equal(parsed.translation, "我学习英语。");
  assert.equal(parsed.analysis, null);
  assert.match(parsed.warning ?? "", /译文已生成/u);
  assert.match(parsed.warning ?? "", /不在英文原句/u);
});

test("单个知识项校验失败时静默忽略该项并保留其余知识卡", () => {
  const parsed = parseStudyAnalysisResult(response(JSON.stringify({
    translation: "我学习英语。",
    keyPoints: [
      { expression: "study English", meaning: "学习英语", note: "有效搭配" },
      { expression: "learn French", meaning: "学习法语", note: "不在原句中" }
    ],
    grammar: [
      { pattern: "主语 + 动词 + 宾语", explanation: "有效句型" },
      { pattern: "", explanation: "缺少句型名称" }
    ],
    examTip: "注意动词和宾语的搭配。"
  })), "I study English.");

  assert.ok(parsed.analysis);
  assert.deepEqual(parsed.analysis.keyPoints, [
    { expression: "study English", meaning: "学习英语", note: "有效搭配" }
  ]);
  assert.deepEqual(parsed.analysis.grammar, [
    { pattern: "主语 + 动词 + 宾语", explanation: "有效句型" }
  ]);
  assert.equal(parsed.analysis.examTip, "注意动词和宾语的搭配。");
  assert.equal(parsed.warning, null);
});

test("输出被截断时从完整 translation 字段中恢复译文", () => {
  const parsed = parseStudyAnalysisResult({
    choices: [{
      finish_reason: "length",
      message: {
        content: '{"translation":"这是一条仍然有效的译文。","keyPoints":[{"expression":"unfinished"'
      }
    }]
  }, "This is a sentence.");

  assert.equal(parsed.translation, "这是一条仍然有效的译文。");
  assert.equal(parsed.analysis, null);
  assert.match(parsed.warning ?? "", /输出被截断/u);
});

test("知识卡指纹会按学习目标隔离", async () => {
  const cryptoProvider = webcrypto as Crypto;
  const fingerprints = await Promise.all(
    STUDY_PROFILES.map((profile) =>
      createStudyFingerprint(1, 2, "Hello.", profile, cryptoProvider)
    )
  );
  const cet4 = fingerprints[STUDY_PROFILES.indexOf("cet4")] ?? "";
  const same = await createStudyFingerprint(1, 2, "Hello.", "cet4", cryptoProvider);
  assert.match(cet4, /^[a-f0-9]{64}$/u);
  assert.equal(new Set(fingerprints).size, STUDY_PROFILES.length);
  assert.equal(cet4, same);
});
