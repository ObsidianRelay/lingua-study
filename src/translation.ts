import { App, requestUrl } from "obsidian";
import type { LinguaStudySettings } from "./settings";
import {
  buildTranslationRequestBody,
  parseTranslationResponse,
  translationHttpError,
  validateTranslationConfiguration,
  type TranslationProvider
} from "./translation-core";

const REQUEST_TIMEOUT_MS = 30_000;

interface ResolvedTranslationConfig {
  provider: Exclude<TranslationProvider, "disabled">;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface TranslationResult {
  text: string;
  provider: Exclude<TranslationProvider, "disabled">;
  model: string;
}

export class TranslationService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async translate(sourceText: string): Promise<TranslationResult> {
    const config = this.resolveConfig();
    const body = buildTranslationRequestBody(config.provider, config.model, sourceText);

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
        reject(new Error("翻译请求超过 30 秒，请检查网络或稍后重试。"));
      }, REQUEST_TIMEOUT_MS);
    });

    let response;
    try {
      response = await Promise.race([responsePromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("超过 30 秒")) {
        throw error;
      }
      throw new Error("无法连接翻译服务，请检查网络、API 地址或代理节点。", {
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

    let payload: unknown;
    try {
      payload = response.json;
    } catch {
      throw new Error("翻译服务返回的内容不是有效 JSON。");
    }

    return {
      text: parseTranslationResponse(payload),
      provider: config.provider,
      model: config.model
    };
  }

  private resolveConfig(): ResolvedTranslationConfig {
    const settings = this.getSettings();
    const config = validateTranslationConfiguration(settings);

    return {
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      apiKey: this.readSecret(config.secretId, config.secretLabel)
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
