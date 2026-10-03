import { App, requestUrl } from "obsidian";
import type { LinguaStudySettings } from "./settings";
import {
  buildBaiduTranslationForm,
  buildTranslationRequestBody,
  createMd5Hex,
  parseBaiduTranslationResponse,
  parseTranslationResponse,
  translationHttpError,
  validateBaiduSourceText,
  validateTranslationConfiguration,
  type TranslationRequestBody,
  type TranslationProvider
} from "./translation-core";
import {
  buildStudyAnalysisRequestBody,
  parseStudyAnalysisResult,
  type SentenceStudyAnalysis,
  type StudyDictionaryHint,
  type StudyProfile
} from "./study-core";
import {
  buildStudyChatRequestBody,
  validateLocalChatConfiguration,
  type StudyChatContext,
  type StudyChatMessage
} from "./study-chat-core";
import { streamStudyChat, StudyChatHttpError } from "./study-chat-stream";

const REQUEST_TIMEOUT_MS = 30_000;
const BAIDU_MIN_REQUEST_INTERVAL_MS = 1_100;

interface ResolvedTranslationConfig {
  provider: Exclude<TranslationProvider, "disabled">;
  endpoint: string;
  model: string;
  apiKey: string;
  appId: string | null;
}

export interface TranslationResult {
  text: string;
  provider: Exclude<TranslationProvider, "disabled">;
  model: string;
}

export interface StudyAnalysisResult {
  translation: string;
  analysis: SentenceStudyAnalysis | null;
  warning: string | null;
  provider: Exclude<TranslationProvider, "disabled">;
  model: string;
}

export class TranslationService {
  private baiduRequestQueue: Promise<void> = Promise.resolve();
  private baiduLastRequestStartedAt = 0;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async translate(sourceText: string): Promise<TranslationResult> {
    const config = this.resolveConfig();
    if (config.provider === "baidu") {
      const text = validateBaiduSourceText(sourceText);
      return {
        text: await this.queueBaiduTranslation(config, text),
        provider: config.provider,
        model: config.model
      };
    }
    const body = buildTranslationRequestBody(config.provider, config.model, sourceText);
    const payload = await this.request(config, body, "翻译");

    return {
      text: parseTranslationResponse(payload),
      provider: config.provider,
      model: config.model
    };
  }

  /** 标准版默认每秒只允许一次请求；所有入口共用队列，避免整篇翻译或连点触发限流。 */
  private queueBaiduTranslation(
    config: ResolvedTranslationConfig,
    sourceText: string
  ): Promise<string> {
    const request = this.baiduRequestQueue.then(async () => {
      const waitMs = Math.max(
        0,
        this.baiduLastRequestStartedAt + BAIDU_MIN_REQUEST_INTERVAL_MS - Date.now()
      );
      if (waitMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
      }
      this.baiduLastRequestStartedAt = Date.now();
      return this.requestBaiduTranslation(config, sourceText);
    });
    this.baiduRequestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  async analyzeSentence(
    sourceText: string,
    profile: StudyProfile,
    dictionaryHints: readonly StudyDictionaryHint[]
  ): Promise<StudyAnalysisResult> {
    const config = this.resolveConfig();
    if (config.provider === "baidu") {
      throw new Error("百度翻译只能生成中文译文；学习知识卡需要切换到 DeepSeek、Kimi 或 OpenAI 兼容中转站。");
    }
    const body = buildStudyAnalysisRequestBody(
      config.provider,
      config.model,
      sourceText,
      profile,
      dictionaryHints
    );
    const payload = await this.request(config, body, "知识卡");
    const parsed = parseStudyAnalysisResult(payload, sourceText);
    return {
      ...parsed,
      provider: config.provider,
      model: config.model
    };
  }

  async chat(
    profile: StudyProfile,
    context: StudyChatContext | null,
    history: readonly StudyChatMessage[],
    question: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
    onReasoning?: () => void
  ): Promise<string> {
    const settings = this.getSettings();
    if (settings.chatProvider === "disabled") {
      throw new Error("请先在插件设置中选择聊天服务。");
    }
    const config = settings.chatProvider === "local"
      ? this.resolveLocalChatConfig()
      : this.resolveConfig(settings.chatProvider);
    const model = settings.chatProvider === "deepseek" ? settings.chatDeepSeekModel : config.model;
    const effort = settings.chatProvider === "deepseek"
      ? settings.chatDeepSeekEffort
      : settings.chatProvider === "kimi" && settings.chatKimiThinking ? "high" : "none";
    const body = buildStudyChatRequestBody(
      settings.chatProvider, model, profile, context, history, question, effort
    );
    const requestBody = { ...body, stream: true };
    if (settings.chatProvider !== "local") {
      return streamStudyChat(config.endpoint, config.apiKey, requestBody, onDelta, signal);
    }
    try {
      // Ollama 等兼容接口可关闭推理，避免短学习问题只生成推理而没有正文。
      return await streamStudyChat(config.endpoint, config.apiKey,
        { ...requestBody, reasoning_effort: "none" }, onDelta, signal, { onReasoning });
    } catch (error) {
      // 其他兼容服务可能不接受该可选字段，改用标准 Chat Completions 请求。
      if (!(error instanceof StudyChatHttpError) || ![400, 422].includes(error.status) || signal?.aborted) {
        throw error;
      }
      return streamStudyChat(config.endpoint, config.apiKey, requestBody, onDelta, signal, { onReasoning });
    }
  }

  async testLocalChatConnection(signal?: AbortSignal): Promise<string> {
    const config = this.resolveLocalChatConfig();
    await streamStudyChat(config.endpoint, config.apiKey, {
      model: config.model,
      messages: [{ role: "user", content: "请只回答 OK。" }],
      stream: true,
      max_tokens: 16
    }, () => undefined, signal, { allowEmptyResponse: true });
    return config.model;
  }

  private resolveLocalChatConfig(): { endpoint: string; model: string; apiKey: string } {
    const settings = this.getSettings();
    const config = validateLocalChatConfiguration(settings.localChatBaseUrl, settings.localChatModel);
    return {
      ...config,
      apiKey: settings.localChatSecretId.trim()
        ? this.readSecret(settings.localChatSecretId, "本地模型")
        : ""
    };
  }

  private async requestBaiduTranslation(
    config: ResolvedTranslationConfig,
    sourceText: string
  ): Promise<string> {
    if (!config.appId) {
      throw new Error("百度翻译 AppID 配置无效，请重新填写。");
    }
    const saltParts = new Uint32Array(2);
    window.crypto.getRandomValues(saltParts);
    const salt = `${saltParts[0] ?? 0}${saltParts[1] ?? 0}`;
    const sign = createMd5Hex(`${config.appId}${sourceText}${salt}${config.apiKey}`);
    const responsePromise = requestUrl({
      url: config.endpoint,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: buildBaiduTranslationForm(config.appId, sourceText, salt, sign),
      throw: false
    });

    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error("百度翻译请求超过 30 秒，请检查网络或稍后重试。"));
      }, REQUEST_TIMEOUT_MS);
    });

    let response;
    try {
      response = await Promise.race([responsePromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("超过 30 秒")) {
        throw error;
      }
      throw new Error("无法连接百度翻译服务，请检查网络或代理设置。", { cause: error });
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(translationHttpError(response.status));
    }
    return parseBaiduTranslationResponse(response.json as unknown);
  }

  private async request(
    config: ResolvedTranslationConfig,
    body: TranslationRequestBody,
    operationLabel: string
  ): Promise<unknown> {

    const responsePromise = requestUrl({
      url: config.endpoint,
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      throw: false
    });

    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${operationLabel}请求超过 30 秒，请检查网络或稍后重试。`));
      }, REQUEST_TIMEOUT_MS);
    });

    let response;
    try {
      response = await Promise.race([responsePromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("超过 30 秒")) {
        throw error;
      }
      throw new Error(`无法连接${operationLabel}服务，请检查网络、API 地址或代理节点。`, {
        cause: error
      });
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(translationHttpError(response.status));
    }

    try {
      return response.json as unknown;
    } catch {
      throw new Error(`${operationLabel}服务返回的内容不是有效 JSON。`);
    }
  }

  private resolveConfig(provider?: Exclude<TranslationProvider, "disabled">): ResolvedTranslationConfig {
    const settings = this.getSettings();
    const config = validateTranslationConfiguration(provider
      ? { ...settings, translationProvider: provider }
      : settings);

    return {
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      apiKey: this.readSecret(config.secretId, config.secretLabel),
      appId: config.appId ?? null
    };
  }

  private readSecret(secretId: string, label: string): string {
    if (secretId.trim() === "") {
      throw new Error(`请先在插件设置中选择或创建${label} API Key 安全凭据。`);
    }

    const secret = this.app.secretStorage.getSecret(secretId);
    if (secret === null || secret.trim() === "") {
      throw new Error(`${label} API Key 安全凭据不存在，请重新选择或创建。`);
    }

    return secret.trim();
  }
}
