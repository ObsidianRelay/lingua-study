import { DEFAULT_TRANSCRIPT_FOLDER, sanitizeTranscriptFolder } from "./import-core";
import type { DeepSeekModel, KimiModel, TranslationProvider } from "./translation-core";
import { isStudyProfile, type StudyProfile } from "./study-core";
import type { StudyChatProvider } from "./study-chat-core";
import { sanitizeWhisperModelSource } from "./whisper-model";
import {
  DEFAULT_FSRS_REQUEST_RETENTION,
  sanitizeFsrsRequestRetention
} from "./vocabulary-core";
import {
  DEFAULT_HIGHLIGHT_CATEGORIES,
  sanitizeHighlightCategories,
  type HighlightCategory
} from "./highlight-core";

export type InterfaceTheme = "classic" | "paper";

export function isInterfaceTheme(value: unknown): value is InterfaceTheme {
  return value === "classic" || value === "paper";
}

export interface LinguaStudySettings {
  transcriptFolder: string;
  ytDlpPath: string;
  whisperModelSource: string;
  autoImportPastedVideoLinks: boolean;
  autoOpenRssSidebar: boolean;
  autoRefreshRssSubscriptions: boolean;
  translationProvider: TranslationProvider;
  chatProvider: StudyChatProvider;
  chatDeepSeekModel: DeepSeekModel;
  chatDeepSeekEffort: "none" | "low" | "high" | "max";
  chatKimiThinking: boolean;
  localChatBaseUrl: string;
  localChatModel: string;
  localChatSecretId: string;
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
  enableHighlights: boolean;
  highlightCategories: HighlightCategory[];
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
  // 订阅入口默认不占用工作区；需要时由用户在设置中开启。
  autoOpenRssSidebar: false,
  // Refresh only after the first hour; no network request on plugin startup.
  autoRefreshRssSubscriptions: true,
  translationProvider: "disabled",
  chatProvider: "disabled",
  chatDeepSeekModel: "deepseek-v4-flash",
  chatDeepSeekEffort: "none",
  chatKimiThinking: false,
  localChatBaseUrl: "http://127.0.0.1:11434/v1",
  localChatModel: "",
  localChatSecretId: "",
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
  enableSelectionTranslation: true,
  // 高亮只在用户主动选择字幕时出现，不修改原始字幕正文。
  enableHighlights: true,
  highlightCategories: DEFAULT_HIGHLIGHT_CATEGORIES.map((category) => ({ ...category }))
};

/** 保留其他版本的设置字段，避免旧设备写回时抹掉新设备的配置。 */
export function sanitizeSettings(value: unknown): LinguaStudySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const data = value as Record<string, unknown>;
  const preserved = { ...data };
  // 这几个字段已明确废弃；其余未知字段可能属于另一个版本。
  delete preserved.whisperModel;
  delete preserved.speechCloudBaseUrl;
  delete preserved.speechCloudModel;
  delete preserved.speechCloudSecretId;
  const provider = data.translationProvider;
  const chatProvider = data.chatProvider;
  const model = data.deepSeekModel;
  const kimiModel = data.kimiModel;

  return {
    ...preserved,
    transcriptFolder: sanitizeTranscriptFolder(data.transcriptFolder),
    ytDlpPath: typeof data.ytDlpPath === "string" ? data.ytDlpPath.trim() : "",
    whisperModelSource: sanitizeWhisperModelSource(data.whisperModelSource),
    autoImportPastedVideoLinks:
      typeof data.autoImportPastedVideoLinks === "boolean"
        ? data.autoImportPastedVideoLinks
        : DEFAULT_SETTINGS.autoImportPastedVideoLinks,
    autoOpenRssSidebar:
      typeof data.autoOpenRssSidebar === "boolean"
        ? data.autoOpenRssSidebar
        : DEFAULT_SETTINGS.autoOpenRssSidebar,
    autoRefreshRssSubscriptions:
      typeof data.autoRefreshRssSubscriptions === "boolean"
        ? data.autoRefreshRssSubscriptions
        : DEFAULT_SETTINGS.autoRefreshRssSubscriptions,
    translationProvider:
      provider === "baidu" || provider === "deepseek" || provider === "kimi" ||
        provider === "openai-compatible" || provider === "disabled"
        ? provider
        : DEFAULT_SETTINGS.translationProvider,
    chatProvider:
      chatProvider === "deepseek" || chatProvider === "kimi" ||
      chatProvider === "openai-compatible" || chatProvider === "local" || chatProvider === "disabled"
        ? chatProvider
        : DEFAULT_SETTINGS.chatProvider,
    chatDeepSeekModel:
      data.chatDeepSeekModel === "deepseek-v4-flash" || data.chatDeepSeekModel === "deepseek-v4-pro"
        ? data.chatDeepSeekModel
        : model === "deepseek-v4-flash" || model === "deepseek-v4-pro"
          ? model
          : DEFAULT_SETTINGS.chatDeepSeekModel,
    chatDeepSeekEffort:
      data.chatDeepSeekEffort === "none" || data.chatDeepSeekEffort === "low" ||
        data.chatDeepSeekEffort === "high" || data.chatDeepSeekEffort === "max"
        ? data.chatDeepSeekEffort
        : DEFAULT_SETTINGS.chatDeepSeekEffort,
    chatKimiThinking:
      typeof data.chatKimiThinking === "boolean"
        ? data.chatKimiThinking
        : DEFAULT_SETTINGS.chatKimiThinking,
    localChatBaseUrl: typeof data.localChatBaseUrl === "string"
      ? data.localChatBaseUrl.trim() : DEFAULT_SETTINGS.localChatBaseUrl,
    localChatModel: typeof data.localChatModel === "string"
      ? data.localChatModel.trim() : DEFAULT_SETTINGS.localChatModel,
    localChatSecretId: typeof data.localChatSecretId === "string"
      ? data.localChatSecretId : DEFAULT_SETTINGS.localChatSecretId,
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
        : DEFAULT_SETTINGS.enableSelectionTranslation,
    enableHighlights:
      typeof data.enableHighlights === "boolean"
        ? data.enableHighlights
        : DEFAULT_SETTINGS.enableHighlights,
    highlightCategories: sanitizeHighlightCategories(data.highlightCategories)
  };
}

/** 只替换用户本次改动的字段；其他版本认识的值原样留在 data.json。 */
export function mergeSettingsForSave(
  stored: unknown,
  current: LinguaStudySettings,
  changes: Partial<LinguaStudySettings>
): Record<string, unknown> {
  const data = stored && typeof stored === "object" && !Array.isArray(stored)
    ? { ...(stored as Record<string, unknown>) }
    : {};
  delete data.whisperModel;
  delete data.speechCloudBaseUrl;
  delete data.speechCloudModel;
  delete data.speechCloudSecretId;
  for (const key of Object.keys(changes) as Array<keyof LinguaStudySettings>) {
    data[key] = current[key];
  }
  return data;
}
