import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  buildBaiduTranslationForm,
  buildTranslationRequestBody,
  createMd5Hex,
  createSegmentFingerprint,
  getTranslationCachePath,
  normalizeChatCompletionsUrl,
  parseBaiduTranslationResponse,
  parseTranslationResponse,
  readCompletionFinishReason,
  translationHttpError,
  validateBaiduSourceText,
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
      baiduAppId: "",
      baiduSecretId: "",
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
    baiduAppId: "",
    baiduSecretId: "",
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
    baiduAppId: "",
    baiduSecretId: "",
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
    baiduAppId: "",
    baiduSecretId: "",
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
      baiduAppId: "",
      baiduSecretId: "",
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
    baiduAppId: "",
    baiduSecretId: "",
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

test("校验百度翻译配置并使用独立安全凭据", () => {
  assert.throws(() => validateTranslationConfiguration({
    translationProvider: "baidu",
    baiduAppId: "",
    baiduSecretId: "",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "",
    customBaseUrl: "",
    customModel: "",
    customSecretId: ""
  }), /AppID/u);

  const baidu = validateTranslationConfiguration({
    translationProvider: "baidu",
    baiduAppId: " 123456 ",
    baiduSecretId: "evs-baidu",
    deepSeekModel: "deepseek-v4-flash",
    deepSeekSecretId: "",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "",
    customBaseUrl: "",
    customModel: "",
    customSecretId: ""
  });
  assert.equal(baidu.provider, "baidu");
  assert.equal(baidu.appId, "123456");
  assert.equal(baidu.secretId, "evs-baidu");
  assert.equal(baidu.model, "general");
});

test("构建并解析百度通用翻译请求", () => {
  assert.equal(
    createMd5Hex("2015063000000001apple654781234567890"),
    "a1a7461d92e5194c5cae3182b5b24de1"
  );
  assert.equal(createMd5Hex("你好"), "7eca689f0d3389d9dea66ae112e5cfd7");
  const body = new URLSearchParams(buildBaiduTranslationForm(
    "2015063000000001",
    "Hello & welcome.",
    "65478",
    "abc123"
  ));
  assert.equal(body.get("q"), "Hello & welcome.");
  assert.equal(body.get("from"), "en");
  assert.equal(body.get("to"), "zh");
  assert.equal(body.get("appid"), "2015063000000001");
  assert.equal(body.get("sign"), "abc123");

  assert.equal(parseBaiduTranslationResponse({
    from: "en",
    to: "zh",
    trans_result: [{ src: "Hello.", dst: " 你好。 " }]
  }), "你好。");
  assert.equal(parseBaiduTranslationResponse({
    trans_result: [{ dst: "第一行" }, { dst: "第二行" }]
  }), "第一行\n第二行");
  assert.throws(
    () => parseBaiduTranslationResponse({ error_code: "54001", error_msg: "Invalid Sign" }),
    /AppID、密钥或签名/u
  );
  assert.throws(() => parseBaiduTranslationResponse({ trans_result: [] }), /没有返回译文/u);
});

test("百度翻译拒绝空文本和超过 6000 字节的原文", () => {
  assert.equal(validateBaiduSourceText("  Hello.  "), "Hello.");
  assert.throws(() => validateBaiduSourceText("   "), /没有可翻译/u);
  assert.throws(() => validateBaiduSourceText("中".repeat(2_001)), /6000 字节/u);
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
