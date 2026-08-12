export type TranslationProvider = "disabled" | "deepseek" | "openai-compatible";

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface TranslationConfigurationInput {
  translationProvider: TranslationProvider;
  deepSeekModel: DeepSeekModel;
  deepSeekSecretId: string;
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

  // DeepSeek V4 默认可能启用思考模式。逐句翻译无需思考过程，显式关闭可减少等待和费用。
  if (provider === "deepseek") {
    body.thinking = { type: "disabled" };
  }

  return body;
}

/** 从 OpenAI 兼容响应中安全提取最终文本。 */
export function parseTranslationResponse(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error("翻译服务返回了无法识别的数据。");
  }

  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("翻译服务没有返回翻译结果。");
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new Error("翻译服务返回了无法识别的数据。");
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error("翻译服务没有返回翻译结果。");
  }

  const content = (message as Record<string, unknown>).content;
  let text = "";

  if (typeof content === "string") {
    text = content.trim();
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const partText = (part as Record<string, unknown>).text;
        return typeof partText === "string" ? partText : "";
      })
      .join("")
      .trim();
  }

  if (text === "") {
    throw new Error("翻译服务返回了空内容，请稍后重试。");
  }

  return text;
}

/** 把常见 HTTP 状态转换成不会泄露服务端原文的中文提示。 */
export function translationHttpError(status: number): string {
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
  text: string
): Promise<string> {
  const input = JSON.stringify([start, end, text]);
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
