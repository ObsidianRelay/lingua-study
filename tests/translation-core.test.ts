import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  buildTranslationRequestBody,
  createSegmentFingerprint,
  getTranslationCachePath,
  normalizeChatCompletionsUrl,
  parseTranslationResponse,
  readCompletionFinishReason,
  translationHttpError,
  validateTranslationConfiguration
} from "../src/translation-core";

test("标准化 API 地址并避免重复追加接口路径", () => {
  assert.equal(
    normalizeChatCompletionsUrl("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions"
  );
  assert.equal(
    normalizeChatCompletionsUrl("https://relay.example/v1/"),
    "https://relay.example/v1/chat/completions"
  );
  assert.equal(
    normalizeChatCompletionsUrl("https://relay.example/v1/chat/completions/"),
    "https://relay.example/v1/chat/completions"
  );
  assert.throws(() => normalizeChatCompletionsUrl("http://relay.example/v1"), /HTTPS/);
  assert.throws(() => normalizeChatCompletionsUrl("https://relay.example/v1?token=x"), /查询参数/);
});

test("校验 DeepSeek 和中转站配置", () => {
  assert.throws(
    () => validateTranslationConfiguration({
      translationProvider: "disabled",
      deepSeekModel: "deepseek-v4-flash",
      deepSeekSecretId: "",
      kimiModel: "kimi-k2.6",
      kimiSecretId: "",
      customBaseUrl: "",
      customModel: "",
      customSecretId: ""
    }),
    /尚未启用/
  );

  const deepSeek = validateTranslationConfiguration({
    translationProvider: "deepseek",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "evs-deepseek",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "",
    customBaseUrl: "",
    customModel: "",
    customSecretId: ""
  });
  assert.equal(deepSeek.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(deepSeek.secretId, "evs-deepseek");

  const kimi = validateTranslationConfiguration({
    translationProvider: "kimi",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "evs-kimi",
    customBaseUrl: "",
    customModel: "",
    customSecretId: ""
  });
  assert.equal(kimi.endpoint, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(kimi.model, "kimi-k2.6");
  assert.equal(kimi.secretId, "evs-kimi");
  assert.throws(() => validateTranslationConfiguration({
    translationProvider: "kimi",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "",
    customBaseUrl: "",
    customModel: "",
    customSecretId: ""
  }), /Kimi API Key/u);

  assert.throws(
    () => validateTranslationConfiguration({
      translationProvider: "openai-compatible",
      deepSeekModel: "deepseek-v4-flash",
      deepSeekSecretId: "",
      kimiModel: "kimi-k2.6",
      kimiSecretId: "",
      customBaseUrl: "https://relay.example/v1",
      customModel: "",
      customSecretId: "relay-key"
    }),
    /模型名称/
  );

  const relay = validateTranslationConfiguration({
    translationProvider: "openai-compatible",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "",
    customBaseUrl: "https://relay.example/v1",
    customModel: "relay-model",
    customSecretId: "relay-key"
  });
  assert.equal(relay.endpoint, "https://relay.example/v1/chat/completions");
  assert.equal(relay.model, "relay-model");
});

test("DeepSeek 与 Kimi 请求关闭思考模式，中转站请求不携带专属参数", () => {
  const deepSeek = buildTranslationRequestBody("deepseek", "deepseek-v4-flash", "Hello.");
  const kimi = buildTranslationRequestBody("kimi", "kimi-k2.6", "Hello.");
  const relay = buildTranslationRequestBody("openai-compatible", "relay-model", "Hello.");

  assert.deepEqual(deepSeek.thinking, { type: "disabled" });
  assert.deepEqual(kimi.thinking, { type: "disabled" });
  assert.equal("thinking" in relay, false);
  assert.equal(deepSeek.messages[1]?.content, "Hello.");
  assert.equal(deepSeek.stream, false);
});

test("解析字符串和文本分段格式的 OpenAI 兼容响应", () => {
  assert.equal(
    parseTranslationResponse({ choices: [{ message: { content: "  你好。  " } }] }),
    "你好。"
  );
  assert.equal(
    parseTranslationResponse({
      choices: [{ message: { content: [{ type: "text", text: "你" }, { type: "text", text: "好" }] } }]
    }),
    "你好"
  );
  assert.throws(() => parseTranslationResponse({ choices: [] }), /没有返回翻译结果/);
  assert.throws(
    () => parseTranslationResponse({ choices: [{ message: { content: " " } }] }),
    /空内容/
  );
});

test("读取模型结束原因以识别输出截断", () => {
  assert.equal(
    readCompletionFinishReason({ choices: [{ finish_reason: "length", message: { content: "x" } }] }),
    "length"
  );
  assert.equal(readCompletionFinishReason({ choices: [] }), null);
});

test("HTTP 错误映射不暴露服务端响应正文", () => {
  assert.match(translationHttpError(408), /HTTP 408/u);
  assert.match(translationHttpError(401), /API Key/);
  assert.match(translationHttpError(402), /余额不足/);
  assert.match(translationHttpError(429), /请求过于频繁/);
  assert.match(translationHttpError(503), /暂时不可用/);
});

test("字幕指纹稳定且会随时间或原文变化", async () => {
  const cryptoProvider = webcrypto as Crypto;
  const first = await createSegmentFingerprint(
    4,
    13,
    "Thank you for using Lingua Study.",
    cryptoProvider
  );
  const same = await createSegmentFingerprint(
    4,
    13,
    "Thank you for using Lingua Study.",
    cryptoProvider
  );
  const changed = await createSegmentFingerprint(
    4,
    14,
    "Thank you for using Lingua Study.",
    cryptoProvider
  );

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.equal(
    getTranslationCachePath("Language study/Transcripts/abcdefghijk.json"),
    "Language study/Transcripts/abcdefghijk.zh-CN.translations.json"
  );
});
