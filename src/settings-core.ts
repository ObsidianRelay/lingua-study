import { DEFAULT_TRANSCRIPT_FOLDER, sanitizeTranscriptFolder } from "./import-core";
import type { DeepSeekModel, KimiModel, TranslationProvider } from "./translation-core";
import { isStudyProfile, type StudyProfile } from "./study-core";
import { sanitizeWhisperModelSource } from "./whisper-model";
import {
  DEFAULT_FSRS_REQUEST_RETENTION,
  sanitizeFsrsRequestRetention
} from "./vocabulary-core";

export type InterfaceTheme = "classic" | "paper";

export function isInterfaceTheme(value: unknown): value is InterfaceTheme {
  return value === "classic" || value === "paper";
}

export interface LinguaStudySettings {
  transcriptFolder: string;
  ytDlpPath: string;
  whisperModelSource: string;
  autoImportPastedVideoLinks: boolean;
  translationProvider: TranslationProvider;
  translateWholeTranscript: boolean;
  baiduAppId: string;
  baiduSecretId: string;
  deepSeekModel: DeepSeekModel;
  deepSeekSecretId: string;
  kimiModel: KimiModel;
  kimiSecretId: string;
  customBaseUrl: string;
  customModel: string;
  customSecretId: string;
  cacheTranslations: boolean;
  studyProfile: StudyProfile;
  dailyNewWordLimit: number;
  fsrsRequestRetention: number;
  desktopPlayerWidth: number;
  interfaceTheme: InterfaceTheme;
  enableDoubleClickLookup: boolean;
  enableSelectionTranslation: boolean;
}

export const DEFAULT_DESKTOP_PLAYER_WIDTH = 860;
export const MIN_DESKTOP_PLAYER_WIDTH = 480;
export const MAX_DESKTOP_PLAYER_WIDTH = 1200;

export const DEFAULT_SETTINGS: LinguaStudySettings = {
  transcriptFolder: DEFAULT_TRANSCRIPT_FOLDER,
  ytDlpPath: "",
  whisperModelSource: "",
  // 默认由用户点击左侧 Lingua Study Logo 后开始导入，避免粘贴资料时误触发。
  autoImportPastedVideoLinks: false,
  translationProvider: "disabled",
  // 默认只处理用户当前选择的句子，避免新用户误触整篇翻译并产生额外费用。
  translateWholeTranscript: false,
  baiduAppId: "",
  baiduSecretId: "",
  deepSeekModel: "deepseek-v4-flash",
  deepSeekSecretId: "",
  kimiModel: "kimi-k2.6",
  kimiSecretId: "",
  customBaseUrl: "",
  customModel: "",
  customSecretId: "",
  cacheTranslations: true,
  studyProfile: "cet4",
  dailyNewWordLimit: 10,
  fsrsRequestRetention: DEFAULT_FSRS_REQUEST_RETENTION,
  desktopPlayerWidth: DEFAULT_DESKTOP_PLAYER_WIDTH,
  // 已上线用户默认保留原界面；Lingua Paper 由用户在设置中主动启用。
  interfaceTheme: "classic",
  // 老用户升级后继续保持原有双击查词行为，可在设置中主动关闭。
  enableDoubleClickLookup: true,
  // 保留 1.5.0 的字幕划词翻译行为，用户可在设置中主动关闭。
  enableSelectionTranslation: true
};

/** 读取旧配置时只保留仍受支持的字段；旧 whisperModel 会在这里被移除。 */
export function sanitizeSettings(value: unknown): LinguaStudySettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const data = value as Record<string, unknown>;
  const provider = data.translationProvider;
  const model = data.deepSeekModel;
  const kimiModel = data.kimiModel;

  return {
    transcriptFolder: sanitizeTranscriptFolder(data.transcriptFolder),
    ytDlpPath: typeof data.ytDlpPath === "string" ? data.ytDlpPath.trim() : "",
    whisperModelSource: sanitizeWhisperModelSource(data.whisperModelSource),
    autoImportPastedVideoLinks:
      typeof data.autoImportPastedVideoLinks === "boolean"
        ? data.autoImportPastedVideoLinks
        : DEFAULT_SETTINGS.autoImportPastedVideoLinks,
    translationProvider:
      provider === "baidu" || provider === "deepseek" || provider === "kimi" ||
        provider === "openai-compatible" || provider === "disabled"
        ? provider
        : DEFAULT_SETTINGS.translationProvider,
    translateWholeTranscript:
      typeof data.translateWholeTranscript === "boolean"
        ? data.translateWholeTranscript
        : DEFAULT_SETTINGS.translateWholeTranscript,
    baiduAppId: typeof data.baiduAppId === "string" ? data.baiduAppId.trim() : "",
    baiduSecretId: typeof data.baiduSecretId === "string" ? data.baiduSecretId : "",
    deepSeekModel:
      model === "deepseek-v4-flash" || model === "deepseek-v4-pro"
        ? model
        : DEFAULT_SETTINGS.deepSeekModel,
    deepSeekSecretId: typeof data.deepSeekSecretId === "string" ? data.deepSeekSecretId : "",
    kimiModel: kimiModel === "kimi-k2.6" ? kimiModel : DEFAULT_SETTINGS.kimiModel,
    kimiSecretId: typeof data.kimiSecretId === "string" ? data.kimiSecretId : "",
    customBaseUrl: typeof data.customBaseUrl === "string" ? data.customBaseUrl : "",
    customModel: typeof data.customModel === "string" ? data.customModel : "",
    customSecretId: typeof data.customSecretId === "string" ? data.customSecretId : "",
    cacheTranslations:
      typeof data.cacheTranslations === "boolean"
        ? data.cacheTranslations
        : DEFAULT_SETTINGS.cacheTranslations,
    studyProfile: isStudyProfile(data.studyProfile)
      ? data.studyProfile
      : DEFAULT_SETTINGS.studyProfile,
    dailyNewWordLimit:
      typeof data.dailyNewWordLimit === "number" && Number.isFinite(data.dailyNewWordLimit)
        ? Math.min(50, Math.max(1, Math.round(data.dailyNewWordLimit)))
        : DEFAULT_SETTINGS.dailyNewWordLimit,
    fsrsRequestRetention:
      typeof data.fsrsRequestRetention === "number" && Number.isFinite(data.fsrsRequestRetention)
        ? sanitizeFsrsRequestRetention(data.fsrsRequestRetention)
        : DEFAULT_SETTINGS.fsrsRequestRetention,
    desktopPlayerWidth:
      typeof data.desktopPlayerWidth === "number" && Number.isFinite(data.desktopPlayerWidth)
        ? Math.min(
            MAX_DESKTOP_PLAYER_WIDTH,
            Math.max(MIN_DESKTOP_PLAYER_WIDTH, Math.round(data.desktopPlayerWidth))
          )
        : DEFAULT_SETTINGS.desktopPlayerWidth,
    interfaceTheme: isInterfaceTheme(data.interfaceTheme)
      ? data.interfaceTheme
      : DEFAULT_SETTINGS.interfaceTheme,
    enableDoubleClickLookup:
      typeof data.enableDoubleClickLookup === "boolean"
        ? data.enableDoubleClickLookup
        : DEFAULT_SETTINGS.enableDoubleClickLookup,
    enableSelectionTranslation:
      typeof data.enableSelectionTranslation === "boolean"
        ? data.enableSelectionTranslation
        : DEFAULT_SETTINGS.enableSelectionTranslation
  };
}
