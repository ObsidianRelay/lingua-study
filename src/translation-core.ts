export type TranslationProvider =
  | "disabled"
  | "baidu"
  | "deepseek"
  | "kimi"
  | "openai-compatible";

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type KimiModel = "kimi-k2.6";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const KIMI_BASE_URL = "https://api.moonshot.cn/v1";
export const BAIDU_TRANSLATION_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
export const BAIDU_TRANSLATION_MODEL = "general";
export const BAIDU_MAX_QUERY_BYTES = 6_000;

export interface TranslationConfigurationInput {
  translationProvider: TranslationProvider;
  baiduAppId: string;
  baiduSecretId: string;
  deepSeekModel: DeepSeekModel;
  deepSeekSecretId: string;
  kimiModel: KimiModel;
  kimiSecretId: string;
  customBaseUrl: string;
  customModel: string;
  customSecretId: string;
}

export interface ValidatedTranslationConfiguration {
  provider: Exclude<TranslationProvider, "disabled">;
  endpoint: string;
  model: string;
  secretId: string;
  secretLabel: string;
  appId?: string;
}

export interface TranslationRequestBody {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  stream: false;
  max_tokens: number;
  thinking?: {
    type: "disabled";
  };
}

const TRANSLATION_SYSTEM_PROMPT = [
  "你是一名专业英语翻译。",
  "请把用户提供的英文字幕翻译成自然、准确、易懂的简体中文。",
  "保留人名、数字和必要的专业术语，不要解释，不要加引号，只输出翻译结果。"
].join("");

/** Array.isArray 默认会把元素收窄为 any；这个守卫保留 unknown，便于安全解析外部响应。 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * 把用户填写的 API 地址转换为 OpenAI Chat Completions 完整地址。
 * 第一版只接受 HTTPS，并拒绝容易造成误配置的账号、查询参数和锚点。
 */
export function normalizeChatCompletionsUrl(input: string): string {
  const raw = input.trim();
  if (raw === "") {
    throw new Error("请填写 API 地址。");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API 地址格式不正确，请填写完整的 HTTPS 地址。");
  }

  if (url.protocol !== "https:") {
    throw new Error("API 地址必须使用 HTTPS。");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("API 地址不能包含用户名或密码。");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("API 地址不能包含查询参数或锚点。");
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions")
    ? path
    : `${path}/chat/completions`;

  return url.toString();
}

/** 在读取真实密钥之前完成所有不涉及秘密值的配置校验。 */
export function validateTranslationConfiguration(
  settings: TranslationConfigurationInput
): ValidatedTranslationConfiguration {
  if (settings.translationProvider === "disabled") {
    throw new Error("翻译功能尚未启用，请先在插件设置中选择翻译服务。");
  }

  if (settings.translationProvider === "baidu") {
    const appId = settings.baiduAppId.trim();
    if (appId === "") {
      throw new Error("请先在插件设置中填写百度翻译 AppID。");
    }
    if (settings.baiduSecretId.trim() === "") {
      throw new Error("请先在插件设置中选择或创建百度翻译密钥安全凭据。");
    }

    return {
      provider: "baidu",
      endpoint: BAIDU_TRANSLATION_ENDPOINT,
      model: BAIDU_TRANSLATION_MODEL,
      secretId: settings.baiduSecretId,
      secretLabel: "百度翻译",
      appId
    };
  }

  if (settings.translationProvider === "deepseek") {
    if (settings.deepSeekSecretId.trim() === "") {
      throw new Error("请先在插件设置中选择或创建 DeepSeek API Key 安全凭据。");
    }

    return {
      provider: "deepseek",
      endpoint: normalizeChatCompletionsUrl(DEEPSEEK_BASE_URL),
      model: settings.deepSeekModel,
      secretId: settings.deepSeekSecretId,
      secretLabel: "DeepSeek"
    };
  }

  if (settings.translationProvider === "kimi") {
    if (settings.kimiSecretId.trim() === "") {
      throw new Error("请先在插件设置中选择或创建 Kimi API Key 安全凭据。");
    }

    return {
      provider: "kimi",
      endpoint: normalizeChatCompletionsUrl(KIMI_BASE_URL),
      model: settings.kimiModel,
      secretId: settings.kimiSecretId,
      secretLabel: "Kimi"
    };
  }

  const model = settings.customModel.trim();
  if (model === "") {
    throw new Error("请先在插件设置中填写中转站模型名称。");
  }
  if (settings.customSecretId.trim() === "") {
    throw new Error("请先在插件设置中选择或创建中转站 API Key 安全凭据。");
  }

  return {
    provider: "openai-compatible",
    endpoint: normalizeChatCompletionsUrl(settings.customBaseUrl),
    model,
    secretId: settings.customSecretId,
    secretLabel: "中转站"
  };
}

/** 百度通用翻译以表单方式接收参数；签名必须基于未编码的原文预先生成。 */
export function buildBaiduTranslationForm(
  appId: string,
  sourceText: string,
  salt: string,
  sign: string
): string {
  return new URLSearchParams({
    q: sourceText,
    from: "en",
    to: "zh",
    appid: appId,
    salt,
    sign
  }).toString();
}

const MD5_ROTATIONS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
] as const;
const MD5_CONSTANTS = Array.from({ length: 64 }, (_unused, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0
);

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

/** 百度鉴权协议要求 MD5；这里只用于签名兼容，不用于密码存储。 */
export function createMd5Hex(input: string): string {
  const source = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const bitLength = source.length * 8;
  for (let index = 0; index < 8; index += 1) {
    bytes[paddedLength - 8 + index] = Math.floor(bitLength / (2 ** (index * 8))) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        (bytes[wordOffset] ?? 0) |
        ((bytes[wordOffset + 1] ?? 0) << 8) |
        ((bytes[wordOffset + 2] ?? 0) << 16) |
        ((bytes[wordOffset + 3] ?? 0) << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed: number;
      let wordIndex: number;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const sum = (a + mixed + (MD5_CONSTANTS[index] ?? 0) + (words[wordIndex] ?? 0)) >>> 0;
      b = (b + rotateLeft(sum, MD5_ROTATIONS[index] ?? 0)) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map((word) =>
    [0, 8, 16, 24]
      .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0"))
      .join("")
  ).join("");
}

function baiduTranslationError(code: string): string {
  if (code === "52001") {
    return "百度翻译请求超时，请缩短原文或稍后重试。";
  }
  if (code === "52002") {
    return "百度翻译服务暂时异常，请稍后重试。";
  }
  if (code === "52003") {
    return "百度翻译 AppID 未授权，或尚未开通通用文本翻译服务。";
  }
  if (code === "54000") {
    return "百度翻译请求缺少必要参数，请重新加载插件后重试。";
  }
  if (code === "54001") {
    return "百度翻译 AppID、密钥或签名不正确，请检查设置。";
  }
  if (code === "54003") {
    return "百度翻译调用过于频繁，请稍后重试。";
  }
  if (code === "54004") {
    return "百度翻译账户余额不足，请先检查开放平台账户。";
  }
  if (code === "54005") {
    return "百度翻译长文本请求过于频繁，请缩短原文并稍后重试。";
  }
  if (code === "58000") {
    return "百度翻译拒绝了当前 IP，请检查开放平台中的服务器地址限制。";
  }
  return `百度翻译请求失败（错误码 ${code}）。`;
}

/** 安全解析百度响应，不把服务端原始错误文本直接展示给用户。 */
export function parseBaiduTranslationResponse(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("百度翻译返回了无法识别的数据。");
  }
  const data = value as Record<string, unknown>;
  const errorCode = data.error_code;
  if (typeof errorCode === "string" || typeof errorCode === "number") {
    const code = String(errorCode);
    if (code !== "52000") {
      throw new Error(baiduTranslationError(code));
    }
  }

  const results = data.trans_result;
  if (!isUnknownArray(results) || results.length === 0) {
    throw new Error("百度翻译没有返回译文，请稍后重试。");
  }
  const translated = results.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "";
    }
    const dst = (item as Record<string, unknown>).dst;
    return typeof dst === "string" ? dst.trim() : "";
  }).filter((item) => item !== "");
  if (translated.length === 0) {
    throw new Error("百度翻译返回了空译文，请稍后重试。");
  }
  return translated.join("\n");
}

/** 百度官方限制单次 query 不超过 6000 字节。 */
export function validateBaiduSourceText(sourceText: string): string {
  const text = sourceText.trim();
  if (text === "") {
    throw new Error("没有可翻译的英文内容。");
  }
  if (new TextEncoder().encode(text).byteLength > BAIDU_MAX_QUERY_BYTES) {
    throw new Error("百度翻译单次原文不能超过 6000 字节，请缩短选中内容后重试。");
  }
  return text;
}

/** 生成 OpenAI Chat Completions 兼容请求体。 */
export function buildTranslationRequestBody(
  provider: Exclude<TranslationProvider, "disabled">,
  model: string,
  sourceText: string
): TranslationRequestBody {
  const body: TranslationRequestBody = {
    model,
    messages: [
      { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: sourceText }
    ],
    stream: false,
    max_tokens: 512
  };

  // 翻译与知识卡需要直接、稳定的结构化结果；关闭可选思考过程可减少等待和输出干扰。
  if (provider === "deepseek" || provider === "kimi") {
    body.thinking = { type: "disabled" };
  }

  return body;
}

function parseResponseText(
  value: unknown,
  missingMessage: string,
  emptyMessage: string
): string {
  if (!value || typeof value !== "object") {
    throw new Error("AI 服务返回了无法识别的数据。");
  }

  const choices = (value as Record<string, unknown>).choices;
  if (!isUnknownArray(choices) || choices.length === 0) {
    throw new Error(missingMessage);
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new Error("AI 服务返回了无法识别的数据。");
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error(missingMessage);
  }

  const content = (message as Record<string, unknown>).content;
  const text = typeof content === "string"
    ? content.trim()
    : isUnknownArray(content)
      ? content.map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const partText = (part as Record<string, unknown>).text;
        return typeof partText === "string" ? partText : "";
      }).join("").trim()
      : "";

  if (text === "") {
    throw new Error(emptyMessage);
  }
  return text;
}

/** 从 OpenAI 兼容响应中安全提取最终文本。 */
export function parseTranslationResponse(value: unknown): string {
  return parseResponseText(
    value,
    "翻译服务没有返回翻译结果。",
    "翻译服务返回了空内容，请稍后重试。"
  );
}

/** 读取 OpenAI Chat Completions 的结束原因，用于区分正常结束和输出截断。 */
export function readCompletionFinishReason(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const choices = (value as Record<string, unknown>).choices;
  if (!isUnknownArray(choices) || choices.length === 0) {
    return null;
  }
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }
  const finishReason = (firstChoice as Record<string, unknown>).finish_reason;
  return typeof finishReason === "string" && finishReason.trim() !== ""
    ? finishReason.trim()
    : null;
}

/** 把常见 HTTP 状态转换成不会泄露服务端原文的中文提示。 */
export function translationHttpError(status: number): string {
  if (status === 408) {
    return "翻译服务提前终止了请求（HTTP 408），请稍后重试。";
  }
  if (status === 400) {
    return "请求格式不兼容，请检查模型名称和中转站接口类型。";
  }
  if (status === 401 || status === 403) {
    return "API Key 无效或没有使用该模型的权限。";
  }
  if (status === 402) {
    return "API 账户余额不足，请先充值或更换服务。";
  }
  if (status === 404) {
    return "没有找到接口或模型，请检查 API 地址和模型名称。";
  }
  if (status === 429) {
    return "请求过于频繁或额度已用完，请稍后重试。";
  }
  if (status >= 500) {
    return "翻译服务暂时不可用，请稍后重试。";
  }

  return `翻译请求失败（HTTP ${status}）。`;
}

/** 根据字幕路径生成独立的简体中文翻译缓存路径。 */
export function getTranslationCachePath(transcriptPath: string): string {
  const withoutJson = transcriptPath.toLowerCase().endsWith(".json")
    ? transcriptPath.slice(0, -5)
    : transcriptPath;
  return `${withoutJson}.zh-CN.translations.json`;
}

/**
 * 时间和英文原文共同参与指纹。字幕有任何修改时，旧翻译不会被错误复用。
 */
export async function createSegmentFingerprint(
  start: number,
  end: number,
  text: string,
  cryptoProvider: Crypto = window.crypto
): Promise<string> {
  const input = JSON.stringify([start, end, text]);
  const bytes = new TextEncoder().encode(input);
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
