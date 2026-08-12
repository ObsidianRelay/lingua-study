import { App, normalizePath, TFile } from "obsidian";
import {
  getTranslationCachePath,
  type TranslationProvider
} from "./translation-core";

export interface TranslationCacheEntry {
  sourceText: string;
  text: string;
  provider: Exclude<TranslationProvider, "disabled">;
  model: string;
  updatedAt: string;
}

export interface TranslationCacheFile {
  version: 1;
  videoId: string;
  targetLanguage: "zh-CN";
  translations: Record<string, TranslationCacheEntry>;
}

export interface TranslationCacheLoadResult {
  path: string;
  translations: Record<string, TranslationCacheEntry>;
  warning: string | null;
}

function createEmptyCache(videoId: string): TranslationCacheFile {
  return {
    version: 1,
    videoId,
    targetLanguage: "zh-CN",
    translations: {}
  };
}

function validateCache(value: unknown, videoId: string): TranslationCacheFile {
  if (!value || typeof value !== "object") {
    throw new Error("缓存最外层不是 JSON 对象");
  }

  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.videoId !== videoId || data.targetLanguage !== "zh-CN") {
    throw new Error("缓存版本、视频 ID 或目标语言不匹配");
  }
  if (!data.translations || typeof data.translations !== "object" || Array.isArray(data.translations)) {
    throw new Error("translations 字段格式不正确");
  }

  const translations: Record<string, TranslationCacheEntry> = {};
  for (const [fingerprint, rawEntry] of Object.entries(
    data.translations as Record<string, unknown>
  )) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !rawEntry || typeof rawEntry !== "object") {
      throw new Error("缓存包含无效句子指纹或条目");
    }

    const entry = rawEntry as Record<string, unknown>;
    const provider = entry.provider;
    if (
      typeof entry.sourceText !== "string" || entry.sourceText.trim() === "" ||
      typeof entry.text !== "string" || entry.text.trim() === "" ||
      (provider !== "deepseek" && provider !== "openai-compatible") ||
      typeof entry.model !== "string" || entry.model.trim() === "" ||
      typeof entry.updatedAt !== "string" || entry.updatedAt.trim() === ""
    ) {
      throw new Error("缓存包含格式不正确的翻译条目");
    }

    translations[fingerprint] = {
      sourceText: entry.sourceText,
      text: entry.text,
      provider,
      model: entry.model,
      updatedAt: entry.updatedAt
    };
  }

  return {
    version: 1,
    videoId,
    targetLanguage: "zh-CN",
    translations
  };
}

/** 负责缓存读取和同一路径的串行写入，防止多句并发翻译时互相覆盖。 */
export class TranslationCacheStore {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly app: App) {}

  async load(transcriptPath: string, videoId: string): Promise<TranslationCacheLoadResult> {
    const path = normalizePath(getTranslationCachePath(transcriptPath));
    const abstractFile = this.app.vault.getAbstractFileByPath(path);

    if (abstractFile === null) {
      return { path, translations: {}, warning: null };
    }
    if (!(abstractFile instanceof TFile)) {
      return {
        path,
        translations: {},
        warning: `翻译缓存路径不是文件，已忽略：${path}`
      };
    }

    try {
      const parsed: unknown = JSON.parse(await this.app.vault.cachedRead(abstractFile));
      const cache = validateCache(parsed, videoId);
      return { path, translations: cache.translations, warning: null };
    } catch {
      return {
        path,
        translations: {},
        warning: `翻译缓存格式错误，已忽略：${path}`
      };
    }
  }

  async upsert(
    transcriptPath: string,
    videoId: string,
    fingerprint: string,
    entry: TranslationCacheEntry
  ): Promise<void> {
    const path = normalizePath(getTranslationCachePath(transcriptPath));
    const previous = this.writeQueues.get(path) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.upsertNow(path, videoId, fingerprint, entry));

    this.writeQueues.set(path, current);
    try {
      await current;
    } finally {
      if (this.writeQueues.get(path) === current) {
        this.writeQueues.delete(path);
      }
    }
  }

  private async upsertNow(
    path: string,
    videoId: string,
    fingerprint: string,
    entry: TranslationCacheEntry
  ): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);

    if (abstractFile !== null && !(abstractFile instanceof TFile)) {
      throw new Error(`翻译缓存路径不是文件：${path}`);
    }

    if (abstractFile instanceof TFile) {
      await this.app.vault.process(abstractFile, (raw) => {
        let cache = createEmptyCache(videoId);
        try {
          cache = validateCache(JSON.parse(raw) as unknown, videoId);
        } catch {
          // 损坏或过期的缓存会在下一次成功翻译时重建，不影响英文字幕和播放器。
        }

        cache.translations[fingerprint] = entry;
        return `${JSON.stringify(cache, null, 2)}\n`;
      });
      return;
    }

    const cache = createEmptyCache(videoId);
    cache.translations[fingerprint] = entry;
    await this.app.vault.create(path, `${JSON.stringify(cache, null, 2)}\n`);
  }
}
