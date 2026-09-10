import {
  addIcon,
  MarkdownRenderer,
  MarkdownView,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Modal,
  normalizePath,
  Notice,
  parseYaml,
  Plugin,
  requestUrl,
  setIcon,
  TFile,
  TFolder,
  type WorkspaceLeaf
} from "obsidian";
import {
  DEFAULT_DESKTOP_PLAYER_WIDTH,
  DEFAULT_SETTINGS,
  LinguaStudySettingTab,
  MAX_DESKTOP_PLAYER_WIDTH,
  MIN_DESKTOP_PLAYER_WIDTH,
  sanitizeSettings,
  type LinguaStudySettings
} from "./settings";
import {
  TranslationCacheStore,
  type TranslationCacheEntry,
  type TranslationCacheLoadResult
} from "./translation-cache";
import { createSegmentFingerprint, getTranslationCachePath } from "./translation-core";
import {
  TranslationService,
  type StudyAnalysisResult,
  type TranslationResult
} from "./translation";
import {
  createStudyFingerprint,
  STUDY_ANALYSIS_VERSION,
  STUDY_PROFILES,
  STUDY_PROFILE_LABELS,
  type StudyDictionaryHint,
  type StudyProfile
} from "./study-core";
import {
  StudyCacheStore,
  type StudyCacheLoadResult
} from "./study-cache";
import {
  getStudyCachePath,
  type StudyCacheEntry
} from "./study-cache-core";
import {
  DICTIONARY_SOURCE,
  OfflineDictionary,
  tokenizeDictionaryText,
  type DictionaryLookupResult
} from "./dictionary-core";
import type {
  FullDictionaryService,
  FullDictionaryInstallResult,
  FullDictionaryStatus
} from "./full-dictionary";
import type {
  CustomDictionaryInstallResult,
  CustomDictionaryService,
  CustomDictionaryStatus
} from "./custom-dictionary";
import {
  DICTIONARY_VIEW_TYPE,
  LinguaDictionaryView,
  type DictionaryLookupContext
} from "./dictionary-view";
import {
  updateTranscriptSegmentText,
  validateTranscript,
  type TranscriptFile,
  type TranscriptSegment
} from "./transcript-core";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import {
  calculateAlignedScrollTop,
  calculatePlayerResizeWidth,
  calculateTranscriptEndSpacer,
  calculateViewportAlignedScrollDelta,
  type PlayerResizeCorner
} from "./ui-layout-core";
import {
  buildMobileYouTubeStartUrl,
  isPlaybackStateConfirmed,
  shouldAdvancePlaybackClock,
  shouldStopDictationPlayback,
  shouldResumeTranscriptAutoFollow,
  waitForMediaMetadata
} from "./player-control-core";
import { YouTubeImportController } from "./youtube-import";
import { BilibiliImportController } from "./bilibili-import";
import type { BilibiliCacheService, CachedBilibiliVideo } from "./bilibili-cache";
import { BilibiliSessionService, type BilibiliSessionStatus } from "./bilibili-session";
import {
  findSupportedVideoLinksByPriority,
  parseStandalonePastedVideoLink,
  type PastedVideoLink
} from "./import-core";
import type { LocalWhisperService } from "./local-whisper";
import { disposeDocumentParserRuntime } from "./document-parser";
import { VocabularyStore, type VocabularyBookLoadResult } from "./vocabulary-store";
import {
  type ReviewRating,
  type VocabularyBookFile,
  type VocabularyContext
} from "./vocabulary-core";
import {
  writeVocabularyExport,
  type VocabularyExportStorage,
  type VocabularyExportWriteResult
} from "./vocabulary-export-core";
import { renderVocabularyBookImages } from "./vocabulary-image-export";
import {
  writeVocabularyImageExport,
  type VocabularyImageExportResult,
  type VocabularyImageExportStorage
} from "./vocabulary-image-export-core";
import { selectNewestEligibleRenderer } from "./vocabulary-navigation-core";
import {
  containsStudyBlock,
  getStudyBlockCursorRecovery
} from "./live-preview-core";
import { VersionedAsyncCache } from "./versioned-async-cache";
import {
  getPluginUpdateInfo,
  LINGUA_STUDY_LATEST_MANIFEST_URL,
  type PluginUpdateInfo
} from "./update-check-core";
import { getPlatformCapabilities, type PlatformCapabilities } from "./platform";
import type { YtDlpTranscriptFetcher } from "./yt-dlp-core";
import {
  compareDictation,
  type DictationResult
} from "./dictation-core";
import {
  canAdjustShadowingSource,
  calculateShadowingWaveformPeak,
  clampShadowingPosition,
  formatShadowingElapsed,
  formatShadowingRecordingElapsed,
  getShadowingActiveElapsedMs,
  getShadowingLiveWaveformLayout,
  getShadowingPlaybackProgress,
  getShadowingSmoothedPlaybackTime,
  getShadowingRecordingProgress,
  getShadowingRecordingErrorMessage,
  getShadowingWaveformBinSize,
  getShadowingWaveformTargetSampleCount,
  selectShadowingMimeType,
  SHADOWING_MAX_RECORDING_MS,
  SHADOWING_SEEK_STEP_SECONDS,
  type ShadowingPhase
} from "./shadowing-core";
import ribbonLogoMaskUrl from "../assets/logo-ribbon-mask.png";

interface TranscriptCodeBlockConfig {
  kind: "transcript";
  transcript: string;
}

interface BilibiliCodeBlockConfig {
  kind: "bilibili";
  idType: "bvid" | "aid";
  videoId: string;
  page: number;
  transcript: string | null;
}

type CodeBlockConfig = TranscriptCodeBlockConfig | BilibiliCodeBlockConfig;

interface YouTubeMessagePayload {
  id?: string | number;
  event?: string;
  info?: unknown;
  data?: unknown;
}

interface SegmentTranslationView {
  fingerprint: string;
  studyFingerprints: Record<StudyProfile, string>;
  primaryButton: HTMLButtonElement;
  retranslateButton: HTMLButtonElement;
  supplementButton: HTMLButtonElement;
  outputEl: HTMLElement;
  statusEl: HTMLElement;
  entry: TranslationCacheEntry | null;
  studyEntries: Partial<Record<StudyProfile, StudyCacheEntry>>;
  visible: boolean;
  loading: boolean;
  loadingAction: "translate" | "retranslate" | "supplement" | null;
  errorMessage: string | null;
  statusTone: "error" | "warning" | null;
  requestGeneration: number;
}

interface DictationSession {
  index: number;
  panelEl: HTMLElement;
  inputEl: HTMLTextAreaElement | null;
  submitButton: HTMLButtonElement | null;
  sourceTimeEl: HTMLElement | null;
  sourcePlayButton: HTMLButtonElement | null;
  uiTimer: number | null;
  phase: "input" | "result";
}

interface ShadowingSession {
  index: number;
  panelEl: HTMLElement;
  statusEl: HTMLElement;
  sourceTimeEl: HTMLElement | null;
  sourcePlayButton: HTMLButtonElement | null;
  waveformCanvas: HTMLCanvasElement | null;
  phase: ShadowingPhase;
  syncSourceDuringRecording: boolean;
  mediaRecorder: MediaRecorder | null;
  mediaStream: MediaStream | null;
  chunks: Blob[];
  audioEl: HTMLAudioElement | null;
  recordingUrl: string | null;
  recordingStartedAt: number;
  recordingAccumulatedMs: number;
  recordingPlaybackAnchorMs: number | null;
  recordingPlaybackAnchorSeconds: number;
  recordingSourcePosition: number;
  sourceEnded: boolean;
  uiTimer: number | null;
  limitTimer: number | null;
  audioContext: AudioContext | null;
  analyserNode: AnalyserNode | null;
  audioSourceNode: MediaStreamAudioSourceNode | null;
  waveformFrame: number | null;
  waveformSamples: Uint8Array<ArrayBuffer> | null;
  waveformPeaks: number[];
  requestGeneration: number;
}

interface TranscriptRenderData {
  transcript: TranscriptFile;
  transcriptPath: string;
  fingerprints: string[];
  studyFingerprints: Array<Record<StudyProfile, string>>;
  cache: TranslationCacheLoadResult;
  studyCache: StudyCacheLoadResult;
}

interface TranscriptFingerprintData {
  fingerprints: string[];
  studyFingerprints: Array<Record<StudyProfile, string>>;
}

interface TranscriptSegmentIdentity {
  videoId: string;
  start: number;
  end: number;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const YOUTUBE_PLAYER_ORIGINS = new Set([
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com"
]);
const PLAYER_STATE_PLAYING = 1;
const PLAYER_STATE_PAUSED = 2;
const PLAYER_HANDSHAKE_INTERVAL_MS = 250;
const PLAYER_CONTROLS_FALLBACK_MS = 1_500;
const PLAYER_COMMAND_TIMEOUT_MS = 3_000;
const LOCAL_MEDIA_LOAD_TIMEOUT_MS = 8_000;
const LOCAL_STATUS_READY_DELAY_MS = 1_200;
const TRANSCRIPT_AUTO_FOLLOW_RESUME_DELAY_MS = 5_000;
// 覆盖浏览器原生平滑滚动的完整动画期，避免其 scroll 事件被误判为手动滚动。
const TRANSCRIPT_SMOOTH_SCROLL_GUARD_MS = 900;
const LINGUA_STUDY_RIBBON_ICON_ID = "lingua-study-logo";
const LINGUA_STUDY_RIBBON_ICON_SVG = `
  <path d="M3.5 7c3.1-1 6-.15 8.5 2.25C14.5 6.85 17.4 6 20.5 7v10c-3.05-.85-5.95 0-8.5 2.3C9.45 17 6.55 16.15 3.5 17Z" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 9.25v10.05M11.9 9.1c-2.7-1.3-3.9-2.8-2.85-4.4 1.2-1.85 4.25-1.2 4.45.75.15 1.45-.8 2.45-1.6 3.65ZM12.1 9.1c2.05-1 2.8-2.35 1.75-3.45-1.05-1.1-2.85-.3-2.55 1.15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
`;

async function createStudyFingerprintMap(
  segment: Pick<TranscriptSegment, "start" | "end" | "text">
): Promise<Record<StudyProfile, string>> {
  const entries = await Promise.all(
    STUDY_PROFILES.map(async (profile) => [
      profile,
      await createStudyFingerprint(segment.start, segment.end, segment.text, profile)
    ] as const)
  );
  return Object.fromEntries(entries) as Record<StudyProfile, string>;
}

function createEmptyStudyFingerprintMap(): Record<StudyProfile, string> {
  return Object.fromEntries(
    STUDY_PROFILES.map((profile) => [profile, ""] as const)
  ) as Record<StudyProfile, string>;
}

class ManualVideoLinkModal extends Modal {
  private resolved = false;

  constructor(
    app: LinguaStudyPlugin["app"],
    private readonly links: PastedVideoLink[],
    private readonly resolveValue: (value: PastedVideoLink | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("选择要创建的学习内容");
    this.contentEl.createEl("p", {
      text: "当前范围内找到多个视频链接。请选择本次要处理的一个，其他链接不会被修改。"
    });
    const list = this.contentEl.createDiv({ cls: "lingua-study-manual-video-list" });
    for (const item of this.links) {
      const button = list.createEl("button", { cls: "lingua-study-manual-video-choice" });
      let label: string;
      if (item.platform === "youtube") {
        label = `YouTube · ${item.link.videoId}`;
      } else if (item.link.kind === "short") {
        label = "B站 · 分享链接";
      } else {
        label = `B站 · ${item.link.videoId}${item.link.page > 1 ? ` · 第 ${item.link.page} P` : ""}`;
      }
      button.createSpan({ cls: "lingua-study-manual-video-label", text: label });
      button.createSpan({
        cls: "lingua-study-manual-video-url",
        text: item.link.originalUrl
      });
      button.addEventListener("click", () => this.finish(item));
    }
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private finish(value: PastedVideoLink | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

function parseCodeBlock(source: string): CodeBlockConfig {
  let value: unknown;

  try {
    value = parseYaml(source);
  } catch {
    throw new Error("代码块配置不是有效的 YAML。请检查 transcript: 后面的路径。");
  }

  if (!value || typeof value !== "object") {
    throw new Error("代码块缺少配置。请添加 transcript 路径或 B站播放器配置。");
  }

  const config = value as Record<string, unknown>;
  if (typeof config.platform === "string" && config.platform.trim().toLowerCase() === "bilibili") {
    const bvid = typeof config.bvid === "string" ? config.bvid.trim() : "";
    const aidValue = config.aid;
    const aid = typeof aidValue === "number" && Number.isSafeInteger(aidValue) && aidValue > 0
      ? aidValue.toString()
      : typeof aidValue === "string" && /^[1-9][0-9]*$/u.test(aidValue.trim())
        ? aidValue.trim()
        : "";
    if ((bvid === "") === (aid === "")) {
      throw new Error("B站播放器必须且只能填写一个有效的 bvid 或 aid。");
    }
    if (bvid !== "" && !/^BV[0-9A-Za-z]{10}$/u.test(bvid)) {
      throw new Error("B站 bvid 格式不正确，应为 BV 开头的 12 位视频 ID。");
    }

    const pageValue = config.page ?? 1;
    const page = typeof pageValue === "number" && Number.isSafeInteger(pageValue)
      ? pageValue
      : typeof pageValue === "string" && /^[0-9]+$/u.test(pageValue.trim())
        ? Number.parseInt(pageValue.trim(), 10)
        : 0;
    if (page <= 0) {
      throw new Error("B站多 P 页码 page 必须是大于 0 的整数。");
    }

    const transcriptValue = config.transcript;
    const transcript = typeof transcriptValue === "string" && transcriptValue.trim() !== ""
      ? normalizePath(transcriptValue.trim())
      : null;

    return {
      kind: "bilibili",
      idType: bvid !== "" ? "bvid" : "aid",
      videoId: bvid !== "" ? bvid : `av${aid}`,
      page,
      transcript
    };
  }

  const transcript = config.transcript;
  if (typeof transcript !== "string" || transcript.trim() === "") {
    throw new Error("没有找到 transcript 路径。请填写本地字幕 JSON 文件路径。");
  }

  return { kind: "transcript", transcript: normalizePath(transcript.trim()) };
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function playerErrorMessage(code: number): string {
  if (code === 2) {
    return "视频 ID 无效，无法加载播放器。";
  }
  if (code === 5) {
    return "当前环境无法播放此 HTML5 视频。";
  }
  if (code === 100) {
    return "视频不存在、已删除或设为私密。";
  }
  if (code === 101 || code === 150) {
    return "YouTube 拒绝了嵌入播放：可能是发布者限制，也可能是登录或反机器人验证。请尝试在 YouTube 中观看。";
  }

  return `视频无法播放（YouTube 错误代码 ${code}）。`;
}

function buildBilibiliSourceUrl(config: BilibiliCodeBlockConfig): string {
  const page = config.page > 1 ? `?p=${config.page}` : "";
  return `https://www.bilibili.com/video/${config.videoId}${page}`;
}

class EditTranscriptSegmentModal extends Modal {
  constructor(
    app: LinguaStudyPlugin["app"],
    private readonly currentText: string,
    private readonly originalText: string | undefined,
    private readonly onSave: (text: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("编辑这句英文字幕");
    if (this.originalText) {
      this.contentEl.createEl("p", {
        text: `首次生成的原文：${this.originalText}`
      });
    }
    const textarea = this.contentEl.createEl("textarea", {
      cls: "evs-transcript-editor"
    });
    textarea.value = this.currentText;
    textarea.setAttribute("aria-label", "英文字幕正文");
    const errorEl = this.contentEl.createDiv({ cls: "lingua-study-import-error" });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const saveButton = actions.createEl("button", { cls: "mod-cta", text: "保存字幕" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());

    saveButton.addEventListener("click", () => {
      const text = textarea.value.trim();
      if (text === "") {
        errorEl.setText("字幕正文不能为空。");
        return;
      }
      saveButton.disabled = true;
      saveButton.setText("正在保存…");
      void this.onSave(text).then(() => this.close()).catch((error: unknown) => {
        errorEl.setText(error instanceof Error ? error.message : "字幕保存失败。");
        saveButton.disabled = false;
        saveButton.setText("保存字幕");
      });
    });
    window.setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class LinguaStudyRenderChild extends MarkdownRenderChild {
  private readonly plugin: LinguaStudyPlugin;
  private readonly source: string;
  private readonly sourcePath: string;
  private iframeEl: HTMLIFrameElement | null = null;
  private playerMessageTargetOrigin: string | null = null;
  private localVideoEl: HTMLVideoElement | null = null;
  private cachedVideoUrls: string[] = [];
  private cachedVideoOffsets: number[] = [];
  private cachedVideoDurations: number[] = [];
  private cachedVideoIndex = 0;
  private messageWindow: Window | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private handshakeTimer: number | null = null;
  private controlsFallbackTimer: number | null = null;
  private pollTimer: number | null = null;
  private transcript: TranscriptFile | null = null;
  private transcriptPath = "";
  private destroyed = false;
  private controlsActivated = false;
  private playerReady = false;
  private playerState = -1;
  private currentTime = 0;
  private duration = 0;
  private playbackRate = 1;
  private lastTimeUpdateAt = Date.now();
  private activeSegmentIndex = -1;
  private transcriptListEl: HTMLElement | null = null;
  private transcriptEndSpacerEl: HTMLElement | null = null;
  private transcriptViewportWindow: Window | null = null;
  private transcriptViewportHandler: ((event: Event) => void) | null = null;
  private transcriptViewportFrame: number | null = null;
  private transcriptViewportNeedsCenter = false;
  private transcriptAutoFollowEnabled = true;
  private transcriptAutoFollowResumeTimer: number | null = null;
  private transcriptProgrammaticScrollUntil = 0;
  private transcriptResizeObserver: ResizeObserver | null = null;
  private segmentRows: HTMLElement[] = [];
  private timestampButtons: HTMLButtonElement[] = [];
  private controlButtons: HTMLButtonElement[] = [];
  private speedSliderEl: HTMLInputElement | null = null;
  private speedGroupEl: HTMLElement | null = null;
  private speedLabelEls: HTMLElement[] = [];
  private speedSliderPreviewRate: number | null = null;
  private playPauseButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private runtimeErrorEl: HTMLElement | null = null;
  private translationViews: SegmentTranslationView[] = [];
  private cachedTranslations: Record<string, TranslationCacheEntry> = {};
  private cachedStudies: Record<string, StudyCacheEntry> = {};
  private unsubscribeStudyProfile: (() => void) | null = null;
  private segmentTextEls: HTMLElement[] = [];
  private segmentActionDockEl: HTMLElement | null = null;
  private segmentEditButton: HTMLButtonElement | null = null;
  private segmentDictationButton: HTMLButtonElement | null = null;
  private segmentShadowingButton: HTMLButtonElement | null = null;
  private segmentActionTargetIndex = -1;
  private segmentActionTargetPinned = false;
  private dictationSession: DictationSession | null = null;
  private dictationPlaybackStopAt: number | null = null;
  private shadowingSession: ShadowingSession | null = null;
  private shadowingPlaybackStopAt: number | null = null;
  private translationBatchRunning = false;
  private playerDockEl: HTMLElement | null = null;
  private playerWidthSaveTimer: number | null = null;
  private pendingDesktopPlayerWidth: number | null = null;
  private fullWidthObserver: ResizeObserver | null = null;
  private fullWidthScrollEl: HTMLElement | null = null;
  private fullWidthScrollHandler: (() => void) | null = null;
  private fullWidthManualScrollHandler: (() => void) | null = null;
  private fullWidthScrollFrame: number | null = null;
  private fullWidthScrollLeft = 0;
  private livePreviewHostEl: HTMLElement | null = null;
  private livePreviewHostMutationObserver: MutationObserver | null = null;
  private livePreviewHostStyleBefore: {
    contain: string;
    containPriority: string;
    overflow: string;
    overflowPriority: string;
  } | null = null;
  private containerLayoutBefore: {
    width: string;
    maxWidth: string;
    marginLeft: string;
  } | null = null;
  private interfaceThemeLayoutRefresh: ((recenterTranscript: boolean) => void) | null = null;
  private viewViewportEl: HTMLElement | null = null;
  private playerCommandTimer: number | null = null;
  private pendingPlaybackState: number | null = null;
  private pendingPlaybackPreviousState = -1;
  private rateCommandTimer: number | null = null;
  private pendingPlaybackRate: number | null = null;
  private localStatusHideTimer: number | null = null;
  private localSeekGeneration = 0;
  private lookupHighlightEl: HTMLElement | null = null;
  private vocabularyTargetRowEl: HTMLElement | null = null;
  private vocabularyNavigationIndex: number | null = null;

  constructor(
    containerEl: HTMLElement,
    plugin: LinguaStudyPlugin,
    source: string,
    sourcePath: string
  ) {
    super(containerEl);
    this.plugin = plugin;
    this.source = source;
    this.sourcePath = sourcePath;
  }

  onload(): void {
    this.plugin.registerStudyRenderer(this);
    this.renderLoadingShell();
    void this.initialize();
  }

  onunload(): void {
    this.destroyed = true;
    this.closeDictation(false);
    this.closeShadowing(false);
    this.plugin.unregisterStudyRenderer(this);
    this.localSeekGeneration += 1;
    this.fullWidthObserver?.disconnect();
    this.fullWidthObserver = null;
    this.detachFullWidthScrollHandler();
    this.restoreLivePreviewHostStyle();
    this.transcriptResizeObserver?.disconnect();
    this.transcriptResizeObserver = null;
    this.translationViews.forEach((view) => {
      view.requestGeneration += 1;
    });
    this.unsubscribeStudyProfile?.();
    this.unsubscribeStudyProfile = null;
    this.clearTimer("poll");
    this.clearTimer("handshake");
    this.clearTimer("fallback");
    this.clearPlayerCommandTimers();
    if (this.localStatusHideTimer !== null) {
      window.clearTimeout(this.localStatusHideTimer);
      this.localStatusHideTimer = null;
    }
    if (this.transcriptViewportWindow && this.transcriptViewportHandler) {
      this.transcriptViewportWindow.removeEventListener(
        "resize",
        this.transcriptViewportHandler
      );
    }
    if (this.transcriptViewportWindow && this.transcriptViewportFrame !== null) {
      this.transcriptViewportWindow.cancelAnimationFrame(this.transcriptViewportFrame);
    }
    if (this.transcriptAutoFollowResumeTimer !== null) {
      window.clearTimeout(this.transcriptAutoFollowResumeTimer);
      this.transcriptAutoFollowResumeTimer = null;
    }
    if (this.playerWidthSaveTimer !== null) {
      window.clearTimeout(this.playerWidthSaveTimer);
      this.playerWidthSaveTimer = null;
    }
    this.pendingDesktopPlayerWidth = null;
    this.interfaceThemeLayoutRefresh = null;

    if (this.messageWindow && this.messageHandler) {
      this.messageWindow.removeEventListener("message", this.messageHandler);
    }

    this.messageHandler = null;
    this.messageWindow = null;
    this.iframeEl = null;
    this.playerMessageTargetOrigin = null;
    this.vocabularyTargetRowEl?.classList.remove("is-vocabulary-target");
    this.vocabularyTargetRowEl = null;
    this.vocabularyNavigationIndex = null;
    if (this.localVideoEl) {
      this.localVideoEl.pause();
      this.localVideoEl.removeAttribute("src");
      this.localVideoEl.load();
    }
    this.localVideoEl = null;
    this.cachedVideoUrls = [];
    this.cachedVideoOffsets = [];
    this.cachedVideoDurations = [];
    this.cachedVideoIndex = 0;
    this.transcript = null;
    this.transcriptListEl = null;
    this.transcriptEndSpacerEl = null;
    this.transcriptViewportWindow = null;
    this.transcriptViewportHandler = null;
    this.transcriptViewportFrame = null;
    this.transcriptViewportNeedsCenter = false;
    this.transcriptAutoFollowEnabled = true;
    this.transcriptAutoFollowResumeTimer = null;
    this.transcriptProgrammaticScrollUntil = 0;
    this.translationViews = [];
    this.cachedTranslations = {};
    this.cachedStudies = {};
    this.segmentTextEls = [];
    this.segmentActionDockEl = null;
    this.segmentEditButton = null;
    this.segmentDictationButton = null;
    this.segmentShadowingButton = null;
    this.segmentActionTargetIndex = -1;
    this.segmentActionTargetPinned = false;
    this.dictationSession = null;
    this.dictationPlaybackStopAt = null;
    this.shadowingSession = null;
    this.shadowingPlaybackStopAt = null;
    this.translationBatchRunning = false;
    this.playerDockEl = null;
    this.viewViewportEl = null;
    this.restoreContainerLayout();
    this.containerEl.empty();
  }

  private async initialize(): Promise<void> {
    try {
      const config = parseCodeBlock(this.source);
      if (config.kind === "bilibili") {
        const [cached, transcriptData] = await Promise.all([
          this.plugin.getCachedBilibiliVideo(config),
          config.transcript ? this.loadTranscriptRenderData(config.transcript) : Promise.resolve(null)
        ]);
        if (this.destroyed) {
          return;
        }
        if (
          transcriptData &&
          config.idType === "bvid" &&
          transcriptData.transcript.videoId !== config.videoId
        ) {
          throw new Error("B站播放器与文字稿的视频 ID 不匹配。");
        }
        this.renderBilibiliPlayer(config, cached, transcriptData);
        void this.plugin.cleanupLegacyBilibiliSourceLink(this.sourcePath, config).catch(() => {
          new Notice("播放器已加载，但旧的可见 B站链接暂时无法清理。", 5_000);
        });
        return;
      }
      const transcriptData = await this.loadTranscriptRenderData(config.transcript);
      if (this.destroyed) {
        return;
      }
      await this.renderLayout(transcriptData);
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      const message = error instanceof Error ? error.message : "出现未知错误。";
      this.renderFatalError(message);
    }
  }

  private renderLoadingShell(): void {
    const root = this.createRoot("evs-loading-root");
    const status = root.createDiv({
      cls: "evs-loading-shell",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-label": "正在恢复视频播放器和字幕"
      }
    });
    status.createDiv({ cls: "evs-loading-player" });
    const transcript = status.createDiv({ cls: "evs-loading-transcript" });
    for (let index = 0; index < 4; index += 1) {
      transcript.createDiv({ cls: "evs-loading-line" });
    }
  }

  private createRoot(extraClass = ""): HTMLElement {
    this.fullWidthObserver?.disconnect();
    this.fullWidthObserver = null;
    this.detachFullWidthScrollHandler();
    this.restoreLivePreviewHostStyle();
    this.containerEl.empty();

    // `.markdown-preview-view` 可能被 Obsidian 的“可读行长”限宽。
    // 使用最外层的 `.view-content` 才能得到真正的叶片宽度，
    // 保证经典主题和 Lingua Paper 都以同一可用区域计算。
    const viewport = this.containerEl.closest<HTMLElement>(".view-content")
      ?? this.containerEl.closest<HTMLElement>(
        ".markdown-preview-view, .markdown-source-view"
      )
      ?? this.containerEl.parentElement;
    const scrollEl = this.containerEl.closest<HTMLElement>(
      ".cm-scroller, .markdown-preview-view, .view-content"
    ) ?? viewport;
    this.viewViewportEl = viewport;
    if (!this.containerLayoutBefore) {
      this.containerLayoutBefore = {
        width: this.containerEl.style.width,
        maxWidth: this.containerEl.style.maxWidth,
        marginLeft: this.containerEl.style.marginLeft
      };
    }

    const updateFullWidth = (recenterTranscript: boolean): void => {
      if (this.destroyed) {
        return;
      }
      // 两套桌面主题共用同一套内容宽度；主题只能改变视觉样式。
      // 移动端继续保留宿主原布局，避免桌面全宽计算影响窄屏设备。
      if (this.plugin.capabilities.mobile) {
        this.restoreLivePreviewHostStyle();
        const previous = this.containerLayoutBefore;
        if (previous) {
          const layoutChanged =
            this.containerEl.style.width !== previous.width ||
            this.containerEl.style.maxWidth !== previous.maxWidth ||
            this.containerEl.style.marginLeft !== previous.marginLeft;
          this.containerEl.style.width = previous.width;
          this.containerEl.style.maxWidth = previous.maxWidth;
          this.containerEl.style.marginLeft = previous.marginLeft;
          if (layoutChanged || recenterTranscript) {
            this.scheduleTranscriptLayout(recenterTranscript);
          }
        }
        return;
      }
      this.preventLivePreviewClipping();
      const viewportRect = viewport?.getBoundingClientRect();
      if (!viewportRect) {
        return;
      }
      const containerRect = this.containerEl.getBoundingClientRect();
      const currentMargin = Number.parseFloat(this.containerEl.style.marginLeft) || 0;
      const naturalLeft = containerRect.left - currentMargin;
      const targetLeft = viewportRect.left + 16;
      const viewportWidth = viewport?.clientWidth || viewportRect.width;
      const fullWidth = `${Math.max(320, viewportWidth - 32)}px`;
      const noMaximumWidth = "none";
      const leftOffset = `${targetLeft - naturalLeft}px`;
      let layoutChanged = false;
      if (this.containerEl.style.width !== fullWidth) {
        this.containerEl.style.width = fullWidth;
        layoutChanged = true;
      }
      if (this.containerEl.style.maxWidth !== noMaximumWidth) {
        this.containerEl.style.maxWidth = noMaximumWidth;
        layoutChanged = true;
      }
      if (this.containerEl.style.marginLeft !== leftOffset) {
        this.containerEl.style.marginLeft = leftOffset;
        layoutChanged = true;
      }
      if (layoutChanged || recenterTranscript) {
        this.scheduleTranscriptLayout(recenterTranscript);
      }
    };
    this.interfaceThemeLayoutRefresh = updateFullWidth;

    this.fullWidthObserver = new ResizeObserver(() => updateFullWidth(true));
    this.fullWidthObserver.observe(this.containerEl);
    if (viewport && viewport !== this.containerEl) {
      this.fullWidthObserver.observe(viewport);
    }
    if (scrollEl) {
      const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
      this.fullWidthScrollEl = scrollEl;
      this.fullWidthScrollLeft = scrollEl.scrollLeft;
      this.fullWidthManualScrollHandler = (): void => {
        this.suspendTranscriptAutoFollow(true);
      };
      this.fullWidthScrollHandler = (): void => {
        this.suspendTranscriptAutoFollow(false);
        const nextScrollLeft = scrollEl.scrollLeft;
        // 自动跟随只改变纵向位置。纵向滚动时反复读写容器宽度会强制整页重排，
        // 尤其会与 YouTube iframe 的播放启动重绘叠加，造成录屏中的撕裂和卡顿。
        if (Math.abs(nextScrollLeft - this.fullWidthScrollLeft) < 1) {
          return;
        }
        this.fullWidthScrollLeft = nextScrollLeft;
        if (this.fullWidthScrollFrame !== null) {
          return;
        }
        this.fullWidthScrollFrame = viewWindow.requestAnimationFrame(() => {
          this.fullWidthScrollFrame = null;
          // 只有真正的横向位移才会影响全宽位置；仍不把字幕拉回当前播放句。
          updateFullWidth(false);
        });
      };
      scrollEl.addEventListener("wheel", this.fullWidthManualScrollHandler, { passive: true });
      scrollEl.addEventListener("touchstart", this.fullWidthManualScrollHandler, { passive: true });
      scrollEl.addEventListener("scroll", this.fullWidthScrollHandler, { passive: true });
    }
    updateFullWidth(true);
    const rootClasses = ["evs-root"];
    if (this.plugin.capabilities.mobile) {
      rootClasses.push("evs-mobile");
    }
    if (extraClass !== "") {
      rootClasses.push(extraClass);
    }
    const rootClass = rootClasses.join(" ");
    const root = this.containerEl.createDiv({ cls: rootClass });
    root.dataset.linguaStudySourcePath = this.sourcePath;
    if (!this.plugin.capabilities.mobile) {
      const header = root.createDiv({ cls: "evs-paper-header" });
      const title = header.createDiv({ cls: "evs-paper-title" });
      title.createEl("h2", { text: "逐句精听" });
      const sourceTitle = this.sourcePath
        .split("/")
        .pop()
        ?.replace(/\.md$/iu, "")
        .trim();
      title.createDiv({
        cls: "evs-paper-subtitle",
        text: (sourceTitle || "Lingua Study").toLocaleUpperCase()
      });
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.fullWidthScrollFrame === null) {
      this.fullWidthScrollFrame = viewWindow.requestAnimationFrame(() => {
        this.fullWidthScrollFrame = null;
        updateFullWidth(true);
      });
    }
    return root;
  }

  private createPlayerDock(root: HTMLElement): HTMLElement {
    const dock = root.createDiv({ cls: "evs-player-dock" });
    this.playerDockEl = dock;
    this.applyDesktopPlayerWidth();
    if (!this.plugin.capabilities.mobile) {
      this.createPlayerResizeCorners(dock, root);
    }
    return dock;
  }

  /**
   * 四个角都是透明的拖动区，不增加可见按钮。
   * 播放器始终居中，左侧角向左和右侧角向右都会放大。
   */
  private createPlayerResizeCorners(dock: HTMLElement, root: HTMLElement): void {
    const corners: readonly PlayerResizeCorner[] = ["nw", "ne", "sw", "se"];
    const viewDocument = dock.ownerDocument;
    for (const corner of corners) {
      const handle = dock.createDiv({
        cls: `evs-player-resize-corner evs-player-resize-corner--${corner}`
      });
      handle.setAttribute("aria-hidden", "true");

      let activePointerId: number | null = null;
      let centerX = 0;
      let latestWidth = 0;
      let didResize = false;

      const finishResize = (event: PointerEvent): void => {
        if (activePointerId !== event.pointerId) {
          return;
        }
        activePointerId = null;
        dock.classList.remove("is-resizing");
        this.scheduleTranscriptLayout(true);
        if (!didResize) {
          return;
        }
        this.scheduleDesktopPlayerWidthSave(latestWidth, true);
      };

      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || activePointerId !== null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        const dockRect = dock.getBoundingClientRect();
        centerX = dockRect.left + dockRect.width / 2;
        latestWidth = Math.round(dockRect.width);
        didResize = false;
        dock.classList.add("is-resizing");
        handle.setPointerCapture(event.pointerId);
      });

      this.registerDomEvent(viewDocument, "pointermove", (event) => {
        if (activePointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        const availableWidth = Math.max(0, root.getBoundingClientRect().width - 48);
        const nextWidth = calculatePlayerResizeWidth(
          centerX,
          event.clientX,
          availableWidth,
          MIN_DESKTOP_PLAYER_WIDTH,
          MAX_DESKTOP_PLAYER_WIDTH
        );
        if (nextWidth === latestWidth) {
          return;
        }
        latestWidth = nextWidth;
        didResize = true;
        dock.style.setProperty("--evs-player-width", `${nextWidth}px`);
        // 松手事件可能被嵌入式视频窗口拦截，停止拖动后仍会通过防抖保存最终尺寸。
        this.scheduleDesktopPlayerWidthSave(nextWidth, false);
      });

      // 监听 document，拖动越过正在移动的播放器边缘后仍可连续收到事件。
      this.registerDomEvent(viewDocument, "pointerup", finishResize);
      this.registerDomEvent(viewDocument, "pointercancel", finishResize);
      handle.addEventListener("lostpointercapture", finishResize);
    }
  }

  applyDesktopPlayerWidth(width = this.plugin.settings.desktopPlayerWidth): void {
    this.playerDockEl?.style.setProperty(
      "--evs-player-width",
      `${width || DEFAULT_DESKTOP_PLAYER_WIDTH}px`
    );
    this.scheduleTranscriptLayout(false);
  }

  applyInterfaceTheme(): void {
    this.interfaceThemeLayoutRefresh?.(true);
  }

  private scheduleDesktopPlayerWidthSave(width: number, immediate: boolean): void {
    const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
    this.pendingDesktopPlayerWidth = width;
    if (this.playerWidthSaveTimer !== null) {
      viewWindow.clearTimeout(this.playerWidthSaveTimer);
    }
    this.playerWidthSaveTimer = viewWindow.setTimeout(() => {
      this.playerWidthSaveTimer = null;
      const pendingWidth = this.pendingDesktopPlayerWidth;
      this.pendingDesktopPlayerWidth = null;
      if (pendingWidth === null) {
        return;
      }
      void this.plugin.updateSettings({ desktopPlayerWidth: pendingWidth }).catch(() => {
        new Notice("播放器尺寸保存失败，重新加载插件后会恢复之前的大小。", 5_000);
      });
    }, immediate ? 0 : 180);
  }

  private createPlayerStage(dock: HTMLElement): HTMLElement {
    const stage = dock.createDiv({ cls: "evs-player-stage" });
    const frame = stage.createDiv({ cls: "evs-player-frame" });
    if (!this.plugin.capabilities.mobile) {
      const utilities = stage.createDiv({ cls: "evs-player-utilities" });
      utilities.setAttribute("aria-label", "视频置顶操作");
      this.createFloatingToggle(utilities, dock);
    }
    return frame;
  }

  private createMobileFloatingToggle(parent: HTMLElement, dock: HTMLElement): void {
    if (this.plugin.capabilities.mobile) {
      this.createFloatingToggle(parent, dock);
    }
  }

  private createFloatingToggle(parent: HTMLElement, dock: HTMLElement): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "evs-button evs-icon-button evs-floating-toggle"
    });
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    this.setControlIcon(button, "pin", "让视频保持在当前画面中");
    button.addEventListener("click", () => {
      const floating = !dock.classList.contains("is-floating");
      dock.classList.toggle("is-floating", floating);
      button.setAttribute("aria-pressed", floating.toString());
      this.setControlIcon(
        button,
        floating ? "pin-off" : "pin",
        floating ? "取消视频悬浮" : "让视频保持在当前画面中"
      );
      this.scheduleTranscriptLayout(true);
    });
    return button;
  }

  private restoreContainerLayout(): void {
    if (!this.containerLayoutBefore) {
      return;
    }
    this.containerEl.style.width = this.containerLayoutBefore.width;
    this.containerEl.style.maxWidth = this.containerLayoutBefore.maxWidth;
    this.containerEl.style.marginLeft = this.containerLayoutBefore.marginLeft;
    this.containerLayoutBefore = null;
  }

  private preventLivePreviewClipping(): void {
    const host = this.containerEl.closest<HTMLElement>(
      ".cm-preview-code-block, .cm-embed-block"
    );
    if (!host) {
      this.restoreLivePreviewHostStyle();
      return;
    }

    if (host !== this.livePreviewHostEl) {
      this.restoreLivePreviewHostStyle();
      this.livePreviewHostEl = host;
      this.livePreviewHostStyleBefore = {
        contain: host.style.getPropertyValue("contain"),
        containPriority: host.style.getPropertyPriority("contain"),
        overflow: host.style.getPropertyValue("overflow"),
        overflowPriority: host.style.getPropertyPriority("overflow"),
      };
      const HostMutationObserver = host.ownerDocument.defaultView?.MutationObserver
        ?? MutationObserver;
      this.livePreviewHostMutationObserver = new HostMutationObserver(() => {
        if (host !== this.livePreviewHostEl) {
          return;
        }
        const containWasReset = host.style.getPropertyValue("contain") !== "none"
          || host.style.getPropertyPriority("contain") !== "important";
        const overflowWasReset = host.style.getPropertyValue("overflow") !== "visible"
          || host.style.getPropertyPriority("overflow") !== "important";
        if (containWasReset) {
          this.overrideLivePreviewHostStyle(host, "contain", "none");
        }
        if (overflowWasReset) {
          this.overrideLivePreviewHostStyle(host, "overflow", "visible");
        }
      });
      this.livePreviewHostMutationObserver.observe(host, {
        attributes: true,
        attributeFilter: ["style"]
      });
    }

    // CodeMirror 会在渲染后重新写入内联 contain: paint；CSS 类本身无法稳定覆盖。
    // 这里只覆盖当前 Lingua Study 宿主，并在卸载时完整恢复原有内联样式。
    host.classList.add("lingua-study-full-width-host");
    this.overrideLivePreviewHostStyle(host, "contain", "none");
    this.overrideLivePreviewHostStyle(host, "overflow", "visible");
  }

  private overrideLivePreviewHostStyle(
    host: HTMLElement,
    property: "contain" | "overflow",
    value: "none" | "visible"
  ): void {
    host.style.setProperty(property, value, "important");
  }

  private restoreLivePreviewHostStyle(): void {
    this.livePreviewHostMutationObserver?.disconnect();
    this.livePreviewHostMutationObserver = null;
    const host = this.livePreviewHostEl;
    if (host) {
      host.classList.remove("lingua-study-full-width-host");
      const previous = this.livePreviewHostStyleBefore;
      if (previous?.contain) {
        host.style.setProperty("contain", previous.contain, previous.containPriority);
      } else {
        host.style.removeProperty("contain");
      }
      if (previous?.overflow) {
        host.style.setProperty("overflow", previous.overflow, previous.overflowPriority);
      } else {
        host.style.removeProperty("overflow");
      }
    }
    this.livePreviewHostEl = null;
    this.livePreviewHostStyleBefore = null;
  }

  private detachFullWidthScrollHandler(): void {
    if (this.fullWidthScrollEl && this.fullWidthManualScrollHandler) {
      this.fullWidthScrollEl.removeEventListener("wheel", this.fullWidthManualScrollHandler);
      this.fullWidthScrollEl.removeEventListener("touchstart", this.fullWidthManualScrollHandler);
    }
    if (this.fullWidthScrollEl && this.fullWidthScrollHandler) {
      this.fullWidthScrollEl.removeEventListener("scroll", this.fullWidthScrollHandler);
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.fullWidthScrollFrame !== null) {
      viewWindow.cancelAnimationFrame(this.fullWidthScrollFrame);
    }
    this.fullWidthScrollEl = null;
    this.fullWidthScrollHandler = null;
    this.fullWidthManualScrollHandler = null;
    this.fullWidthScrollFrame = null;
    this.fullWidthScrollLeft = 0;
  }

  private renderBilibiliPlayer(
    config: BilibiliCodeBlockConfig,
    cached: CachedBilibiliVideo | null,
    transcriptData: TranscriptRenderData | null
  ): void {
    if (cached) {
      this.renderCachedBilibiliPlayer(config, cached, transcriptData);
      return;
    }

    const root = this.createRoot("evs-bilibili-root");
    const playerDock = this.createPlayerDock(root);
    const sourceUrl = buildBilibiliSourceUrl(config);
    const playerFrame = this.createPlayerStage(playerDock);
    const playerParams = new URLSearchParams({
      autoplay: "0",
      danmaku: "0",
      poster: "1",
      p: config.page.toString()
    });
    if (config.idType === "bvid") {
      playerParams.set("bvid", config.videoId);
    } else {
      playerParams.set("aid", config.videoId.slice(2));
    }

    const iframe = playerFrame.createEl("iframe", {
      cls: "evs-player-host",
      attr: {
        title: "哔哩哔哩视频播放器",
        src: `https://player.bilibili.com/player.html?${playerParams.toString()}`,
        allow: "autoplay; encrypted-media; picture-in-picture",
        referrerpolicy: "strict-origin-when-cross-origin"
      }
    });
    iframe.setAttribute("allowfullscreen", "");
    const sourceToolbar = playerDock.createDiv({ cls: "evs-toolbar evs-bilibili-toolbar" });
    this.createTranscriptImportButton(sourceToolbar, config, transcriptData !== null);
    this.createSourceLink(sourceToolbar, sourceUrl);
    this.createMobileFloatingToggle(sourceToolbar, playerDock);
    const status = root.createDiv({ cls: "evs-status evs-bilibili-status" });
    status.createSpan({
      text: transcriptData
        ? `B站在线播放器已加载 · ${transcriptData.transcript.segments.length} 条英文字幕 · 恢复本地缓存后可点击时间戳跳转`
        : "B站播放器已加载 · 使用播放器自带控件播放、暂停、调整倍速和全屏"
    });
    status.setAttribute("role", "status");
    if (transcriptData) {
      this.renderTranscriptList(root, transcriptData);
    }
  }

  private renderCachedBilibiliPlayer(
    config: BilibiliCodeBlockConfig,
    cached: CachedBilibiliVideo,
    transcriptData: TranscriptRenderData | null
  ): void {
    this.cachedVideoUrls = cached.fileUrls;
    let accumulatedDuration = 0;
    this.cachedVideoOffsets = cached.manifest.segments.map((segment) => {
      const offset = accumulatedDuration;
      accumulatedDuration += segment.duration;
      return offset;
    });
    this.cachedVideoDurations = cached.manifest.segments.map((segment) => segment.duration);
    this.cachedVideoIndex = 0;
    const root = this.createRoot("evs-bilibili-root");
    const playerDock = this.createPlayerDock(root);
    const sourceUrl = buildBilibiliSourceUrl(config);
    const playerFrame = this.createPlayerStage(playerDock);
    const video = playerFrame.createEl("video", {
      cls: "evs-player-host evs-local-video",
      attr: {
        controls: "",
        playsinline: "",
        preload: "metadata",
        title: "哔哩哔哩本地缓存播放器"
      }
    });
    this.localVideoEl = video;

    const toolbar = playerDock.createDiv({ cls: "evs-toolbar" });
    toolbar.setAttribute("aria-label", "视频播放控制");
    const primaryControls = toolbar.createDiv({ cls: "evs-primary-controls" });
    this.createSeekButton(primaryControls, "后退 5 秒", "rotate-ccw", () => this.seekBy(-5));
    this.playPauseButton = this.createControlButton(
      primaryControls,
      "播放",
      "play",
      () => this.togglePlayback(),
      "evs-play-button"
    );
    this.createSeekButton(primaryControls, "前进 5 秒", "rotate-cw", () => this.seekBy(5));
    this.createTranscriptImportButton(toolbar, config, transcriptData !== null);
    this.createSpeedControls(toolbar);
    this.createSourceLink(toolbar, sourceUrl);
    this.createMobileFloatingToggle(toolbar, playerDock);

    this.statusEl = root.createDiv({ cls: "evs-status evs-local-status" });
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");
    this.runtimeErrorEl = root.createDiv({ cls: "evs-runtime-error" });
    this.runtimeErrorEl.setAttribute("role", "alert");
    this.runtimeErrorEl.hide();

    if (transcriptData) {
      this.renderTranscriptList(root, transcriptData);
    }

    video.addEventListener("loadedmetadata", () => {
      if (this.destroyed) {
        return;
      }
      this.duration = accumulatedDuration > 0
        ? accumulatedDuration
        : Number.isFinite(video.duration) ? video.duration : 0;
      this.currentTime = (this.cachedVideoOffsets[this.cachedVideoIndex] ?? 0) + video.currentTime;
      this.activateControls(
        `本地缓存播放器已就绪 · ${cached.manifest.title}`,
        true
      );
    });
    video.addEventListener("play", () => {
      if (this.destroyed) {
        return;
      }
      this.onPlayerStateChange(PLAYER_STATE_PLAYING);
    });
    video.addEventListener("pause", () => {
      if (this.destroyed) {
        return;
      }
      this.onPlayerStateChange(PLAYER_STATE_PAUSED);
    });
    video.addEventListener("timeupdate", () => {
      if (this.destroyed) {
        return;
      }
      this.currentTime = (this.cachedVideoOffsets[this.cachedVideoIndex] ?? 0) + video.currentTime;
      this.lastTimeUpdateAt = Date.now();
    });
    video.addEventListener("ratechange", () => {
      if (this.destroyed) {
        return;
      }
      this.playbackRate = video.playbackRate;
      this.updateSpeedControl(video.playbackRate);
    });
    video.addEventListener("ended", () => {
      if (this.destroyed) {
        return;
      }
      void this.playNextCachedSegment();
    });
    video.addEventListener("error", () => {
      if (this.destroyed) {
        return;
      }
      this.playerState = PLAYER_STATE_PAUSED;
      this.setPlayPauseVisual("play");
      this.setStatusText("本地缓存视频无法播放。请检查缓存文件或跳转到其他字幕。", false);
    });

    this.setStatusText(`正在读取本地缓存 · ${cached.manifest.title}`, false);
    video.src = this.cachedVideoUrls[0] ?? "";
    video.load();
  }

  private async playNextCachedSegment(): Promise<void> {
    const video = this.localVideoEl;
    const nextIndex = this.cachedVideoIndex + 1;
    const nextUrl = this.cachedVideoUrls[nextIndex];
    if (this.destroyed || !video || !nextUrl) {
      return;
    }
    const generation = this.localSeekGeneration + 1;
    this.localSeekGeneration = generation;
    this.cachedVideoIndex = nextIndex;
    video.src = nextUrl;
    video.load();
    try {
      await waitForMediaMetadata(video, LOCAL_MEDIA_LOAD_TIMEOUT_MS, {
        schedule: (callback, timeoutMs) => window.setTimeout(callback, timeoutMs),
        cancel: (handle) => window.clearTimeout(handle as number)
      });
      if (this.destroyed || generation !== this.localSeekGeneration) {
        return;
      }
      video.playbackRate = this.playbackRate;
      await video.play();
    } catch (error) {
      if (this.destroyed || generation !== this.localSeekGeneration) {
        return;
      }
      this.setStatusText(
        error instanceof Error
          ? error.message
          : `缓存分段 ${nextIndex + 1} 无法自动播放，请点击播放继续。`,
        false
      );
    }
  }

  private async readTranscript(path: string): Promise<{ file: TFile; transcript: TranscriptFile }> {
    const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(path, this.sourcePath);
    const fallbackFile = this.plugin.app.vault.getAbstractFileByPath(path);
    const file = linkedFile ?? fallbackFile;

    if (!(file instanceof TFile)) {
      throw new Error(`找不到字幕文件：${path}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.plugin.app.vault.cachedRead(file));
    } catch {
      throw new Error(`字幕文件不是有效的 JSON：${path}`);
    }

    return { file, transcript: validateTranscript(parsed) };
  }

  private async loadTranscriptRenderData(path: string): Promise<TranscriptRenderData> {
    const { file, transcript } = await this.readTranscript(path);
    const [fingerprintData, cache, studyCache] = await Promise.all([
      this.plugin.getTranscriptFingerprintData(file, transcript),
      this.plugin.loadTranslationCache(path, transcript.videoId),
      this.plugin.loadStudyCache(path, transcript.videoId)
    ]);
    return {
      transcript,
      transcriptPath: path,
      fingerprints: fingerprintData.fingerprints,
      studyFingerprints: fingerprintData.studyFingerprints,
      cache,
      studyCache
    };
  }

  private async renderLayout(data: TranscriptRenderData): Promise<void> {
    const { transcript } = data;
    const root = this.createRoot();

    const playerDock = this.createPlayerDock(root);
    const sourceUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(transcript.videoId)}`;
    const playerFrame = this.createPlayerStage(playerDock);
    const iframeId = `evs-youtube-${Math.random().toString(36).slice(2, 11)}`;
    const playerParams = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      id: iframeId
    });

    // Obsidian 桌面端使用 app:// 协议。不能把 app://obsidian.md 作为
    // YouTube 的 origin 传入，否则部分视频会被误判为无效嵌入来源。
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      playerParams.set("origin", window.location.origin);
    }

    let iframe: HTMLIFrameElement;
    if (this.plugin.capabilities.mobile) {
      // Obsidian 1.10.5 起在 iOS/iPadOS 原生层处理了 YouTube WebView 的
      // Referer 身份要求。第三方插件无法自行设置这个 HTTP 请求头，因此
      // 移动端必须复用 Obsidian 的 Markdown 外部视频嵌入器。
      await MarkdownRenderer.render(
        this.plugin.app,
        `![](https://www.youtube.com/watch?v=${encodeURIComponent(transcript.videoId)})`,
        playerFrame,
        this.sourcePath,
        this
      );
      if (this.destroyed) {
        return;
      }
      const nativeIframe = playerFrame.querySelector<HTMLIFrameElement>("iframe");
      if (!nativeIframe) {
        throw new Error("Obsidian 移动端未能创建 YouTube 播放器，请确认应用已更新到 1.10.5 或更高版本。");
      }
      // 只保留 Obsidian 已经完成原生配置的 iframe，不替换为直接
      // YouTube 地址，避免在 iOS/iPadOS 上重新触发 Error 153。
      playerFrame.replaceChildren(nativeIframe);
      iframe = nativeIframe;
      iframe.classList.add("evs-player-host");
      iframe.id = iframeId;
      iframe.title = "YouTube 视频播放器";
    } else {
      iframe = playerFrame.createEl("iframe", {
        cls: "evs-player-host",
        attr: {
          id: iframeId,
          title: "YouTube 视频播放器",
          src: `https://www.youtube-nocookie.com/embed/${transcript.videoId}?${playerParams.toString()}`,
          allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          referrerpolicy: "strict-origin-when-cross-origin"
        }
      });
      this.playerMessageTargetOrigin = new URL(iframe.src).origin;
    }
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute("allowfullscreen", "");
    this.iframeEl = iframe;
    if (!this.plugin.capabilities.mobile) {
      this.setupMessageListener();
      iframe.addEventListener("load", () => this.startPlayerHandshake());
      this.startPlayerHandshake();
    }

    const toolbar = playerDock.createDiv({ cls: "evs-toolbar" });
    toolbar.setAttribute("aria-label", "视频播放控制");
    if (!this.plugin.capabilities.mobile) {
      const primaryControls = toolbar.createDiv({ cls: "evs-primary-controls" });
      this.createSeekButton(primaryControls, "后退 5 秒", "rotate-ccw", () => this.seekBy(-5));
      this.playPauseButton = this.createControlButton(
        primaryControls,
        "播放",
        "play",
        () => this.togglePlayback(),
        "evs-play-button"
      );
      this.createSeekButton(primaryControls, "前进 5 秒", "rotate-cw", () => this.seekBy(5));
      this.createSpeedControls(toolbar);
    }
    this.createSourceLink(toolbar, sourceUrl);
    this.createMobileFloatingToggle(toolbar, playerDock);

    this.statusEl = root.createDiv({
      cls: "evs-status",
      text: this.plugin.capabilities.mobile
        ? "移动端请使用视频内控件播放、暂停和调整倍速 · 点击字幕时间戳可跳转"
        : "正在加载 YouTube 播放器…"
    });
    this.statusEl.setAttribute("role", "status");
    this.runtimeErrorEl = root.createDiv({ cls: "evs-runtime-error" });
    this.runtimeErrorEl.setAttribute("role", "alert");
    this.runtimeErrorEl.hide();

    this.renderTranscriptList(root, data);

    if (this.plugin.capabilities.mobile) {
      this.timestampButtons.forEach((button) => (button.disabled = false));
      return;
    }

    // 部分 YouTube 嵌入不会回传 onReady；此时 iframe 仍可接收控制命令。
    // 短暂等待后启用控件，避免用户被永久卡在“正在加载”。
    this.controlsFallbackTimer = window.setTimeout(() => {
      this.controlsFallbackTimer = null;
      if (!this.playerReady) {
        this.clearTimer("handshake");
        this.activateControls("播放器已加载 · 点击播放或时间戳开始学习");
      }
    }, PLAYER_CONTROLS_FALLBACK_MS);
  }

  private renderTranscriptList(root: HTMLElement, data: TranscriptRenderData): void {
    const {
      transcript,
      transcriptPath,
      fingerprints,
      studyFingerprints,
      cache,
      studyCache
    } = data;
    this.transcript = transcript;
    this.transcriptPath = transcriptPath;
    this.cachedTranslations = cache.translations;
    this.cachedStudies = studyCache.analyses;

    if (cache.warning) {
      const warning = root.createDiv({ cls: "evs-cache-warning", text: cache.warning });
      warning.setAttribute("role", "status");
    }
    if (studyCache.warning) {
      const warning = root.createDiv({ cls: "evs-cache-warning", text: studyCache.warning });
      warning.setAttribute("role", "status");
    }

    const transcriptList = root.createDiv({ cls: "evs-transcript" });
    transcriptList.setAttribute("aria-label", "英文视频字幕");
    this.transcriptListEl = transcriptList;

    const actionDock = transcriptList.createDiv({ cls: "evs-segment-action-dock" });
    actionDock.setAttribute("aria-label", "字幕操作");
    const editButton = actionDock.createEl("button", {
      cls: "evs-icon-button evs-transcript-icon-button evs-global-edit-action"
    });
    editButton.type = "button";
    editButton.disabled = true;
    this.setTranscriptActionIcon(editButton, "pencil", "请先选择字幕");
    editButton.addEventListener("click", () => {
      if (this.segmentActionTargetIndex >= 0) {
        this.openSegmentEditor(this.segmentActionTargetIndex);
      }
    });
    const dictationButton = actionDock.createEl("button", {
      cls: "evs-icon-button evs-transcript-icon-button evs-global-dictation-action"
    });
    dictationButton.type = "button";
    dictationButton.disabled = true;
    this.setTranscriptActionIcon(dictationButton, "headphones", "听写功能正在准备");
    dictationButton.addEventListener("click", () => {
      if (this.segmentActionTargetIndex >= 0) {
        this.startDictation(this.segmentActionTargetIndex);
      }
    });
    const shadowingButton = actionDock.createEl("button", {
      cls: "evs-icon-button evs-transcript-icon-button evs-global-shadowing-action"
    });
    shadowingButton.type = "button";
    shadowingButton.disabled = true;
    this.setTranscriptActionIcon(shadowingButton, "mic", "跟读功能正在准备");
    shadowingButton.addEventListener("click", () => {
      if (this.segmentActionTargetIndex >= 0) {
        this.startShadowing(this.segmentActionTargetIndex);
      }
    });
    this.segmentActionDockEl = actionDock;
    this.segmentEditButton = editButton;
    this.segmentDictationButton = dictationButton;
    this.segmentShadowingButton = shadowingButton;

    transcript.segments.forEach((segment, index) => {
      const row = transcriptList.createDiv({ cls: "evs-segment" });
      row.dataset.segmentIndex = index.toString();
      row.addEventListener("click", (event) => {
        if ((event.target as Element | null)?.closest(".evs-timestamp")) {
          return;
        }
        this.selectSegmentForActions(index, true);
      });

      const meta = row.createDiv({ cls: "evs-segment-meta" });
      const timestamp = meta.createEl("button", {
        cls: "evs-timestamp",
        text: formatTimestamp(segment.start),
        attr: { "aria-label": `跳转到 ${formatTimestamp(segment.start)}` }
      });
      timestamp.type = "button";
      timestamp.disabled = true;
      timestamp.addEventListener("focus", () => this.selectSegmentForActions(index, true));
      timestamp.addEventListener("click", () => {
        this.selectSegmentForActions(index, false);
        this.jumpTo(segment.start);
      });
      meta.createSpan({ cls: "evs-segment-state", text: "正在播放" });

      const content = row.createDiv({ cls: "evs-segment-content" });
      const primary = content.createDiv({ cls: "evs-segment-primary" });
      const textEl = primary.createDiv({ cls: "evs-segment-text" });
      textEl.setAttribute("lang", "en");
      textEl.setAttribute("title", "双击单词在右侧词典中查询");
      this.renderDictionaryText(textEl, segment.text, index);

      const fingerprint = fingerprints[index] ?? "";
      const cachedEntry = cache.translations[fingerprint];
      const entry = cachedEntry?.sourceText === segment.text ? cachedEntry : null;
      const segmentStudyFingerprints =
        studyFingerprints[index] ?? createEmptyStudyFingerprintMap();
      const studyEntries: Partial<Record<StudyProfile, StudyCacheEntry>> = {};
      for (const profile of STUDY_PROFILES) {
        const studyEntry = studyCache.analyses[segmentStudyFingerprints[profile]];
        if (studyEntry?.sourceText === segment.text && studyEntry.profile === profile) {
          studyEntries[profile] = studyEntry;
        }
      }
      const primaryButton = primary.createEl("button", {
        cls: "evs-icon-button evs-transcript-icon-button evs-global-translate-action evs-translate-action"
      });
      primaryButton.detach();
      primaryButton.type = "button";
      this.setTranscriptActionIcon(
        primaryButton,
        "languages",
        entry ? "显示翻译" : "翻译"
      );

      const retranslateButton = content.createEl("button", {
        cls: "evs-icon-button evs-transcript-icon-button evs-card-action evs-retranslate-action"
      });
      retranslateButton.detach();
      retranslateButton.type = "button";
      this.setTranscriptActionIcon(retranslateButton, "refresh-cw", "重新翻译");

      const supplementButton = content.createEl("button", {
        cls: "evs-icon-button evs-transcript-icon-button evs-card-action evs-supplement-action"
      });
      supplementButton.detach();
      supplementButton.type = "button";
      this.setTranscriptActionIcon(supplementButton, "lightbulb", "补充知识点");

      const outputEl = content.createDiv({ cls: "evs-translation-text" });
      outputEl.setAttribute("lang", "zh-CN");
      const outputId = `evs-translation-${Math.random().toString(36).slice(2, 11)}`;
      outputEl.id = outputId;
      outputEl.hide();

      primaryButton.setAttribute("aria-controls", outputId);
      primaryButton.setAttribute("aria-expanded", "false");

      const translationStatusEl = content.createDiv({ cls: "evs-translation-status" });
      translationStatusEl.setAttribute("role", "status");
      translationStatusEl.hide();

      const translationView: SegmentTranslationView = {
        fingerprint,
        studyFingerprints: segmentStudyFingerprints,
        primaryButton,
        retranslateButton,
        supplementButton,
        outputEl,
        statusEl: translationStatusEl,
        entry,
        studyEntries,
        visible: false,
        loading: false,
        loadingAction: null,
        errorMessage: null,
        statusTone: null,
        requestGeneration: 0
      };
      primaryButton.addEventListener("click", () => {
        this.handlePrimaryTranslationAction(index);
      });
      retranslateButton.addEventListener("click", () => {
        void this.requestTranslation(index, "retranslate");
      });
      supplementButton.addEventListener("click", () => {
        void this.requestTranslation(index, "supplement");
      });
      this.translationViews.push(translationView);
      this.updateTranslationView(translationView);

      this.segmentTextEls.push(textEl);
      this.segmentRows.push(row);
      this.timestampButtons.push(timestamp);
    });
    if (transcript.segments.length > 0) {
      this.selectSegmentForActions(0, false);
    }
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();
    this.translationViews.forEach((view) => this.updateTranslationView(view));
    this.transcriptEndSpacerEl = transcriptList.createDiv({
      cls: "evs-transcript-end-spacer"
    });
    this.transcriptEndSpacerEl.setAttribute("aria-hidden", "true");
    this.setupTranscriptViewportSizing();
    this.unsubscribeStudyProfile?.();
    this.unsubscribeStudyProfile = this.plugin.subscribeStudyProfile(() => {
      if (!this.destroyed) {
        this.translationViews.forEach((view) => this.updateTranslationView(view));
      }
    });
    this.plugin.notifyStudyRendererReady(this);
  }

  private renderDictionaryText(textEl: HTMLElement, text: string, segmentIndex: number): void {
    if (this.lookupHighlightEl && textEl.contains(this.lookupHighlightEl)) {
      this.plugin.clearDictionaryHighlight();
    }
    textEl.empty();
    for (const token of tokenizeDictionaryText(text)) {
      if (!token.isWord) {
        textEl.appendText(token.text);
        continue;
      }
      const wordEl = textEl.createSpan({ cls: "evs-dictionary-word", text: token.text });
      wordEl.addEventListener("dblclick", () => {
        const segment = this.transcript?.segments[segmentIndex];
        if (!segment) {
          return;
        }
        this.plugin.activateDictionaryHighlight(this, wordEl);
        void this.plugin.openDictionaryLookup({
          word: token.text,
          sentence: segment.text,
          sourcePath: this.sourcePath,
          transcriptPath: this.transcriptPath,
          videoId: this.transcript?.videoId ?? null,
          segmentIndex,
          start: segment.start,
          end: segment.end
        }).catch(() => {
          this.plugin.clearDictionaryHighlight();
          new Notice("右侧词典打开失败，请重新加载插件后再试。", 5_000);
        });
      });
    }
  }

  /**
   * 右侧固定操作栏始终服务于一个明确的字幕目标。
   * 用户点击字幕时固定该目标；播放器自动跟随恢复后再交还给当前播放句。
   */
  private selectSegmentForActions(index: number, pinnedByUser: boolean): void {
    const row = this.segmentRows[index];
    const view = this.translationViews[index];
    const dock = this.segmentActionDockEl;
    const editButton = this.segmentEditButton;
    const dictationButton = this.segmentDictationButton;
    const shadowingButton = this.segmentShadowingButton;
    if (
      !row ||
      !view ||
      !dock ||
      !editButton ||
      !dictationButton ||
      !shadowingButton ||
      this.destroyed
    ) {
      return;
    }
    if (
      (this.dictationSession && this.dictationSession.index !== index) ||
      (this.shadowingSession && this.shadowingSession.index !== index)
    ) {
      return;
    }

    if (this.segmentActionTargetIndex !== index) {
      this.segmentRows[this.segmentActionTargetIndex]?.classList.remove("is-action-target");
      this.translationViews[this.segmentActionTargetIndex]?.primaryButton.detach();
    }
    this.segmentActionTargetIndex = index;
    this.segmentActionTargetPinned = pinnedByUser;
    row.classList.add("is-action-target");
    dock.setAttribute("aria-label", `第 ${index + 1} 句字幕操作`);
    editButton.disabled = this.dictationSession !== null || this.shadowingSession !== null;
    this.setTranscriptActionLabel(editButton, `编辑第 ${index + 1} 句字幕`);
    dock.appendChild(view.primaryButton);
    dock.appendChild(dictationButton);
    dock.appendChild(shadowingButton);
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();
  }

  /** 听写只在桌面端可精确控制的 YouTube 或本地缓存播放器中启用。 */
  private updateDictationActionAvailability(): void {
    const button = this.segmentDictationButton;
    if (!button) {
      return;
    }

    let label: string;
    let disabled = false;
    if (this.plugin.capabilities.mobile) {
      disabled = true;
      label = "听写暂时只支持桌面端";
    } else if (!this.localVideoEl && !this.iframeEl) {
      disabled = true;
      label = "当前在线播放器无法逐句听写，请先缓存视频";
    } else if (!this.controlsActivated) {
      disabled = true;
      label = "播放器准备完成后可开始听写";
    } else if (this.translationBatchRunning) {
      disabled = true;
      label = "整篇翻译完成后可开始听写";
    } else if (this.translationViews[this.segmentActionTargetIndex]?.loading) {
      disabled = true;
      label = "当前句翻译完成后可开始听写";
    } else if (this.shadowingSession) {
      disabled = true;
      label = `正在跟读第 ${this.shadowingSession.index + 1} 句`;
    } else if (this.dictationSession) {
      disabled = true;
      label = `正在听写第 ${this.dictationSession.index + 1} 句`;
    } else if (this.segmentActionTargetIndex < 0) {
      disabled = true;
      label = "请先选择要听写的字幕";
    } else {
      label = `听写第 ${this.segmentActionTargetIndex + 1} 句`;
    }

    button.disabled = disabled;
    button.classList.toggle("is-active", this.dictationSession !== null);
    this.setTranscriptActionLabel(button, label);
  }

  private canUseShadowingRecorder(): boolean {
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    return Boolean(
      viewWindow?.navigator.mediaDevices?.getUserMedia &&
      viewWindow.MediaRecorder
    );
  }

  /** 跟读与听写共享播放器和字幕操作锁，同一时间只能进行一种练习。 */
  private updateShadowingActionAvailability(): void {
    const button = this.segmentShadowingButton;
    if (!button) {
      return;
    }

    let label: string;
    let disabled = false;
    if (this.plugin.capabilities.mobile) {
      disabled = true;
      label = "跟读录音暂时只支持电脑端";
    } else if (!this.localVideoEl && !this.iframeEl) {
      disabled = true;
      label = "当前在线播放器无法逐句跟读，请先缓存视频";
    } else if (!this.controlsActivated) {
      disabled = true;
      label = "播放器准备完成后可开始跟读";
    } else if (!this.canUseShadowingRecorder()) {
      disabled = true;
      label = "当前环境无法使用麦克风录音";
    } else if (this.translationBatchRunning) {
      disabled = true;
      label = "整篇翻译完成后可开始跟读";
    } else if (this.translationViews[this.segmentActionTargetIndex]?.loading) {
      disabled = true;
      label = "当前句翻译完成后可开始跟读";
    } else if (this.dictationSession) {
      disabled = true;
      label = `正在听写第 ${this.dictationSession.index + 1} 句`;
    } else if (this.shadowingSession) {
      disabled = true;
      label = `正在跟读第 ${this.shadowingSession.index + 1} 句`;
    } else if (this.segmentActionTargetIndex < 0) {
      disabled = true;
      label = "请先选择要跟读的字幕";
    } else {
      label = `跟读第 ${this.segmentActionTargetIndex + 1} 句`;
    }

    button.disabled = disabled;
    button.classList.toggle("is-active", this.shadowingSession !== null);
    this.setTranscriptActionLabel(button, label);
  }

  private startDictation(index: number): void {
    const segment = this.transcript?.segments[index];
    const row = this.segmentRows[index];
    const content = row?.querySelector<HTMLElement>(".evs-segment-content");
    if (
      !segment ||
      !row ||
      !content ||
      this.destroyed ||
      this.dictationSession ||
      this.shadowingSession
    ) {
      return;
    }
    if (
      this.plugin.capabilities.mobile ||
      (!this.localVideoEl && !this.iframeEl) ||
      !this.controlsActivated
    ) {
      new Notice("当前播放器暂时无法进行逐句听写。", 4_000);
      return;
    }

    this.selectSegmentForActions(index, true);
    const panel = content.createDiv({ cls: "evs-dictation-panel" });
    panel.setAttribute("aria-label", `第 ${index + 1} 句听写`);
    panel.createDiv({
      cls: "evs-dictation-prompt",
      text: "请听音频并输入完整句子"
    });
    const sourcePlayer = panel.createDiv({ cls: "evs-shadowing-source-player" });
    sourcePlayer.setAttribute("role", "group");
    sourcePlayer.setAttribute("aria-label", "当前听写句播放控制");
    const addSourceButton = (
      label: string,
      icon: string,
      onClick: () => void,
      options: { play?: boolean; seek?: boolean } = {}
    ): HTMLButtonElement => {
      const button = sourcePlayer.createEl("button", {
        cls: [
          "evs-button",
          "evs-icon-button",
          "evs-shadowing-source-button",
          options.play ? "evs-play-button" : "",
          options.seek ? "evs-seek-button" : ""
        ].filter(Boolean).join(" ")
      });
      button.type = "button";
      this.setControlIcon(button, icon, label);
      if (options.seek) {
        button.createSpan({ cls: "evs-seek-seconds", text: "2s" });
      }
      button.addEventListener("click", onClick);
      return button;
    };
    addSourceButton(
      "当前听写句后退 2 秒",
      "rotate-ccw",
      () => this.seekDictationSource(-SHADOWING_SEEK_STEP_SECONDS),
      { seek: true }
    );
    const sourcePlayButton = addSourceButton(
      "播放当前听写句",
      "play",
      () => this.toggleDictationSourcePlayback(),
      { play: true }
    );
    addSourceButton(
      "当前听写句前进 2 秒",
      "rotate-cw",
      () => this.seekDictationSource(SHADOWING_SEEK_STEP_SECONDS),
      { seek: true }
    );
    const sourceTimeEl = sourcePlayer.createSpan({ cls: "evs-shadowing-source-time" });
    const input = panel.createEl("textarea", {
      cls: "evs-dictation-input",
      attr: {
        rows: "2",
        placeholder: "输入你听到的英文句子……",
        "aria-label": `输入第 ${index + 1} 句听写答案`,
        autocapitalize: "off",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    const actions = panel.createDiv({ cls: "evs-dictation-actions" });
    const submitButton = actions.createEl("button", {
      cls: "evs-button mod-cta",
      text: "提交听写"
    });
    submitButton.type = "button";
    submitButton.disabled = true;
    const exitButton = actions.createEl("button", {
      cls: "evs-button",
      text: "退出听写"
    });
    exitButton.type = "button";

    this.dictationSession = {
      index,
      panelEl: panel,
      inputEl: input,
      submitButton,
      sourceTimeEl,
      sourcePlayButton,
      uiTimer: null,
      phase: "input"
    };
    row.classList.add("is-dictating");
    row.querySelector<HTMLElement>(".evs-segment-state")?.setText("听写练习");
    this.segmentActionTargetPinned = true;
    this.timestampButtons.forEach((button) => (button.disabled = true));
    this.segmentEditButton!.disabled = true;
    this.translationViews.forEach((view) => this.updateTranslationView(view));
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();

    const submit = (): void => {
      const answer = input.value.trim();
      if (!answer || this.dictationSession?.index !== index) {
        return;
      }
      this.stopDictationPlayback();
      this.renderDictationResult(index, answer, compareDictation(segment.text, answer));
    };
    input.addEventListener("input", () => {
      submitButton.disabled = input.value.trim().length === 0;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    submitButton.addEventListener("click", submit);
    exitButton.addEventListener("click", () => this.closeDictation());

    this.startDictationUiTimer(this.dictationSession);
    this.playDictationSegment(index);
    input.focus({ preventScroll: true });
    this.scheduleTranscriptLayout(true);
  }

  private renderDictationResult(index: number, answer: string, result: DictationResult): void {
    const session = this.dictationSession;
    const row = this.segmentRows[index];
    if (!session || session.index !== index || !row) {
      return;
    }

    session.phase = "result";
    this.clearDictationUiTimer(session);
    session.inputEl = null;
    session.submitButton = null;
    session.sourceTimeEl = null;
    session.sourcePlayButton = null;
    session.panelEl.empty();
    row.classList.remove("is-dictating");
    row.classList.add("is-dictation-result");
    row.querySelector<HTMLElement>(".evs-segment-state")?.setText("听写结果");

    const summary = session.panelEl.createDiv({ cls: "evs-dictation-summary" });
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.createSpan({ cls: "evs-dictation-score", text: `${result.score} 分` });
    summary.createSpan({
      cls: "evs-dictation-score-note",
      text: result.score === 100 ? "完全正确" : `共 ${result.distance} 处需要调整`
    });

    session.panelEl.createDiv({ cls: "evs-dictation-answer-label", text: "你的答案" });
    session.panelEl.createDiv({ cls: "evs-dictation-answer", text: answer });
    session.panelEl.createDiv({ cls: "evs-dictation-answer-label", text: "逐词对照" });
    const comparison = session.panelEl.createDiv({ cls: "evs-dictation-comparison" });
    for (const operation of result.operations) {
      const token = comparison.createSpan({
        cls: `evs-dictation-token is-${operation.kind}`
      });
      if (operation.kind === "match") {
        token.createSpan({ text: operation.actual ?? "" });
        token.createSpan({ cls: "evs-dictation-token-label", text: "正确" });
      } else if (operation.kind === "substitution") {
        token.createSpan({ text: operation.actual ?? "" });
        token.createSpan({
          cls: "evs-dictation-token-label",
          text: `错写，应为 ${operation.expected ?? ""}`
        });
      } else if (operation.kind === "deletion") {
        token.createSpan({ text: operation.expected ?? "" });
        token.createSpan({ cls: "evs-dictation-token-label", text: "漏写" });
      } else {
        token.createSpan({ text: operation.actual ?? "" });
        token.createSpan({ cls: "evs-dictation-token-label", text: "多写" });
      }
    }

    const actions = session.panelEl.createDiv({ cls: "evs-dictation-actions" });
    const retryButton = actions.createEl("button", {
      cls: "evs-button mod-cta",
      text: "重新听写"
    });
    retryButton.type = "button";
    retryButton.addEventListener("click", () => {
      this.closeDictation(false);
      this.startDictation(index);
    });

    const nextIndex = index + 1;
    if (nextIndex < (this.transcript?.segments.length ?? 0)) {
      const nextButton = actions.createEl("button", {
        cls: "evs-button",
        text: "下一句"
      });
      nextButton.type = "button";
      nextButton.addEventListener("click", () => {
        this.closeDictation(false);
        this.selectSegmentForActions(nextIndex, true);
        this.startDictation(nextIndex);
      });
    }
    const exitButton = actions.createEl("button", {
      cls: "evs-button",
      text: "退出听写"
    });
    exitButton.type = "button";
    exitButton.addEventListener("click", () => this.closeDictation());
    this.scheduleTranscriptLayout(true);
  }

  private closeDictation(restoreActions = true): void {
    const session = this.dictationSession;
    this.stopDictationPlayback();
    if (!session) {
      return;
    }
    this.clearDictationUiTimer(session);

    const row = this.segmentRows[session.index];
    row?.classList.remove("is-dictating", "is-dictation-result");
    row?.querySelector<HTMLElement>(".evs-segment-state")?.setText("正在播放");
    session.panelEl.remove();
    this.dictationSession = null;
    this.segmentActionTargetPinned = false;
    this.segmentDictationButton?.classList.remove("is-active");
    if (!this.destroyed && this.controlsActivated) {
      this.timestampButtons.forEach((button) => (button.disabled = false));
    }

    if (!this.destroyed && restoreActions) {
      this.selectSegmentForActions(session.index, false);
      this.translationViews.forEach((view) => this.updateTranslationView(view));
      this.scheduleTranscriptLayout(true);
    } else if (!this.destroyed) {
      this.segmentEditButton?.removeAttribute("disabled");
      this.translationViews.forEach((view) => this.updateTranslationView(view));
      this.updateDictationActionAvailability();
      this.updateShadowingActionAvailability();
    }
  }

  private playDictationSegment(index: number, restart = true): void {
    const segment = this.transcript?.segments[index];
    if (!segment || this.dictationSession?.index !== index || this.destroyed) {
      return;
    }
    const current = this.getEstimatedCurrentTime();
    const target = restart || current < segment.start || current >= segment.end - 0.02
      ? segment.start
      : current;
    this.dictationPlaybackStopAt = segment.end;
    this.clearPendingPlaybackCommand();
    if (this.localVideoEl) {
      void this.seekLocalVideoTo(target, true);
      return;
    }
    if (!this.iframeEl) {
      return;
    }
    this.setCurrentTime(target);
    this.updateActiveSegment();
    this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
    this.sendCommand("seekTo", [target, true]);
    this.sendCommand("playVideo");
    this.updateDictationSourceUi(this.dictationSession);
  }

  private toggleDictationSourcePlayback(): void {
    const session = this.dictationSession;
    if (!session || session.phase !== "input") {
      return;
    }
    if (this.isPracticeSourcePlaying()) {
      this.stopDictationPlayback();
      this.updateDictationSourceUi(session);
      return;
    }
    this.playDictationSegment(session.index, false);
  }

  private seekDictationSource(deltaSeconds: number): void {
    const session = this.dictationSession;
    const segment = session ? this.transcript?.segments[session.index] : null;
    if (!session || session.phase !== "input" || !segment) {
      return;
    }
    const shouldPlay = this.isPracticeSourcePlaying();
    const target = clampShadowingPosition(
      this.getEstimatedCurrentTime(),
      deltaSeconds,
      segment.start,
      segment.end
    );
    this.dictationPlaybackStopAt = shouldPlay ? segment.end : null;
    if (this.localVideoEl) {
      void this.seekLocalVideoTo(target, shouldPlay);
    } else if (this.iframeEl) {
      this.clearPendingPlaybackCommand();
      this.setCurrentTime(target);
      this.updateActiveSegment();
      this.sendCommand("seekTo", [target, true]);
      if (shouldPlay) {
        this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
        this.sendCommand("playVideo");
      }
    }
    this.updateDictationSourceUi(session);
  }

  private startDictationUiTimer(session: DictationSession): void {
    if (session.uiTimer !== null) {
      return;
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (!viewWindow) {
      return;
    }
    session.uiTimer = viewWindow.setInterval(() => {
      if (this.dictationSession === session && !this.destroyed) {
        this.updateDictationSourceUi(session);
      }
    }, 200);
  }

  private clearDictationUiTimer(session: DictationSession): void {
    if (session.uiTimer !== null) {
      window.clearInterval(session.uiTimer);
      session.uiTimer = null;
    }
  }

  private updateDictationSourceUi(session: DictationSession): void {
    const segment = this.transcript?.segments[session.index];
    if (!segment || this.dictationSession !== session || session.phase !== "input") {
      return;
    }
    const current = clampShadowingPosition(
      this.getEstimatedCurrentTime(),
      0,
      segment.start,
      segment.end
    );
    session.sourceTimeEl?.setText(
      `${formatShadowingElapsed((current - segment.start) * 1_000)} / ${formatShadowingElapsed((segment.end - segment.start) * 1_000)} · ${this.playbackRate}x`
    );
    if (session.sourcePlayButton) {
      const sourcePlaying = this.isPracticeSourcePlaying();
      this.setControlIcon(
        session.sourcePlayButton,
        sourcePlaying ? "pause" : "play",
        sourcePlaying ? "暂停当前听写句" : "播放当前听写句"
      );
    }
  }

  private stopDictationPlayback(): void {
    this.dictationPlaybackStopAt = null;
    if (this.destroyed) {
      return;
    }
    const currentTime = this.getEstimatedCurrentTime();
    if (this.localVideoEl) {
      this.localVideoEl.pause();
      this.setCurrentTime(currentTime);
      if (this.dictationSession) {
        this.updateDictationSourceUi(this.dictationSession);
      }
      return;
    }
    if (!this.iframeEl) {
      return;
    }
    this.clearPendingPlaybackCommand();
    this.sendCommand("pauseVideo");
    this.playerState = PLAYER_STATE_PAUSED;
    this.setCurrentTime(currentTime);
    this.setPlayPauseVisual("play");
    if (this.dictationSession) {
      this.updateDictationSourceUi(this.dictationSession);
    }
  }

  /** 返回 true 表示本轮已在句尾暂停，调用方不再切换高亮到下一句。 */
  private stopDictationPlaybackAtBoundary(): boolean {
    const stopAt = this.dictationPlaybackStopAt;
    if (!shouldStopDictationPlayback(this.getEstimatedCurrentTime(), stopAt)) {
      return false;
    }
    if (stopAt === null) {
      return false;
    }
    this.dictationPlaybackStopAt = null;
    const finalTime = Math.max(0, stopAt - 0.01);
    if (this.localVideoEl) {
      this.localVideoEl.pause();
    } else if (this.iframeEl) {
      this.clearPendingPlaybackCommand();
      this.sendCommand("pauseVideo");
      this.playerState = PLAYER_STATE_PAUSED;
      this.setPlayPauseVisual("play");
    }
    this.setCurrentTime(finalTime);
    if (this.dictationSession) {
      this.updateDictationSourceUi(this.dictationSession);
    }
    return true;
  }

  private startShadowing(index: number): void {
    const segment = this.transcript?.segments[index];
    const row = this.segmentRows[index];
    const content = row?.querySelector<HTMLElement>(".evs-segment-content");
    if (
      !segment ||
      !row ||
      !content ||
      this.destroyed ||
      this.dictationSession ||
      this.shadowingSession
    ) {
      return;
    }
    if (
      this.plugin.capabilities.mobile ||
      (!this.localVideoEl && !this.iframeEl) ||
      !this.controlsActivated ||
      !this.canUseShadowingRecorder()
    ) {
      new Notice("当前播放器或设备暂时无法进行逐句跟读。", 4_000);
      return;
    }

    this.selectSegmentForActions(index, true);
    const panel = content.createDiv({ cls: "evs-shadowing-panel" });
    panel.setAttribute("aria-label", `第 ${index + 1} 句跟读录音`);
    const statusEl = panel.createDiv({ cls: "evs-shadowing-status" });
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    this.shadowingSession = {
      index,
      panelEl: panel,
      statusEl,
      sourceTimeEl: null,
      sourcePlayButton: null,
      waveformCanvas: null,
      phase: "listening",
      syncSourceDuringRecording: false,
      mediaRecorder: null,
      mediaStream: null,
      chunks: [],
      audioEl: null,
      recordingUrl: null,
      recordingStartedAt: 0,
      recordingAccumulatedMs: 0,
      recordingPlaybackAnchorMs: null,
      recordingPlaybackAnchorSeconds: 0,
      recordingSourcePosition: segment.start,
      sourceEnded: false,
      uiTimer: null,
      limitTimer: null,
      audioContext: null,
      analyserNode: null,
      audioSourceNode: null,
      waveformFrame: null,
      waveformSamples: null,
      waveformPeaks: [],
      requestGeneration: 0
    };
    row.classList.add("is-shadowing");
    row.querySelector<HTMLElement>(".evs-segment-state")?.setText("跟读练习");
    this.segmentActionTargetPinned = true;
    this.timestampButtons.forEach((button) => (button.disabled = true));
    this.segmentEditButton!.disabled = true;
    this.translationViews.forEach((view) => this.updateTranslationView(view));
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();
    this.renderShadowingPanel();
    this.startShadowingUiTimer(this.shadowingSession);
    this.playShadowingSegment(index);
    this.scheduleTranscriptLayout(true);
  }

  private renderShadowingPanel(): void {
    const session = this.shadowingSession;
    if (!session || this.destroyed) {
      return;
    }

    const panel = session.panelEl;
    panel.classList.toggle("is-recording", session.phase === "recording");
    panel.classList.toggle("is-paused", session.phase === "paused");
    panel.classList.toggle("is-recorded", session.phase === "recorded");
    panel.empty();

    const sourcePlayer = panel.createDiv({ cls: "evs-shadowing-source-player" });
    sourcePlayer.setAttribute("role", "group");
    sourcePlayer.setAttribute("aria-label", "当前句播放控制");
    const sourceControlsLocked = !canAdjustShadowingSource(session.phase);
    const sourcePlaying = this.isPracticeSourcePlaying();
    const addSourceButton = (
      label: string,
      icon: string,
      onClick: () => void,
      options: { disabled?: boolean; play?: boolean; seek?: boolean } = {}
    ): HTMLButtonElement => {
      const button = sourcePlayer.createEl("button", {
        cls: [
          "evs-button",
          "evs-icon-button",
          "evs-shadowing-source-button",
          options.play ? "evs-play-button" : "",
          options.seek ? "evs-seek-button" : ""
        ].filter(Boolean).join(" ")
      });
      button.type = "button";
      button.disabled = options.disabled ?? false;
      this.setControlIcon(button, icon, label);
      if (options.seek) {
        button.createSpan({ cls: "evs-seek-seconds", text: "2s" });
      }
      button.addEventListener("click", onClick);
      return button;
    };
    addSourceButton(
      "当前句后退 2 秒",
      "rotate-ccw",
      () => this.seekShadowingSource(-SHADOWING_SEEK_STEP_SECONDS),
      { disabled: sourceControlsLocked, seek: true }
    );
    session.sourcePlayButton = addSourceButton(
      sourcePlaying ? "暂停当前句" : "播放当前句",
      sourcePlaying ? "pause" : "play",
      () => this.toggleShadowingSourcePlayback(),
      { disabled: sourceControlsLocked, play: true }
    );
    addSourceButton(
      "当前句前进 2 秒",
      "rotate-cw",
      () => this.seekShadowingSource(SHADOWING_SEEK_STEP_SECONDS),
      { disabled: sourceControlsLocked, seek: true }
    );
    session.sourceTimeEl = sourcePlayer.createSpan({ cls: "evs-shadowing-source-time" });

    if (
      session.phase === "recording"
      || session.phase === "paused"
      || session.phase === "processing"
      || session.phase === "recorded"
    ) {
      const waveform = panel.createDiv({ cls: "evs-shadowing-waveform" });
      const canvas = waveform.createEl("canvas", { cls: "evs-shadowing-waveform-canvas" });
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", session.phase === "recorded" ? "已录制的音频波形" : "实时麦克风音量波形");
      session.waveformCanvas = canvas;
      this.drawShadowingWaveform(session);
    } else {
      session.waveformCanvas = null;
    }

    const footer = panel.createDiv({ cls: "evs-shadowing-footer" });
    const statusEl = footer.createDiv({ cls: "evs-shadowing-status" });
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    session.statusEl = statusEl;

    if (session.phase === "listening" || session.phase === "ready") {
      statusEl.setText(sourcePlaying
        ? "原句播放中 · 现在录音将同步跟读"
        : "原句已暂停 · 现在录音将只录人声");
    } else if (session.phase === "requesting") {
      statusEl.setText(session.syncSourceDuringRecording
        ? "正在准备麦克风 · 将同步跟读…"
        : "正在准备麦克风 · 将只录人声…");
    } else if (session.phase === "recording") {
      statusEl.addClass("is-recording");
      statusEl.setText(`● 录音中 ${formatShadowingRecordingElapsed(this.getShadowingRecordingElapsed(session))}`);
    } else if (session.phase === "paused") {
      statusEl.addClass("is-paused");
      statusEl.setText(`已暂停 ${formatShadowingRecordingElapsed(session.recordingAccumulatedMs)}`);
    } else if (session.phase === "processing") {
      statusEl.setText("正在生成录音…");
    } else {
      statusEl.setText("录音完成，可以播放对比");
    }

    const actions = footer.createDiv({ cls: "evs-shadowing-actions" });
    const addButton = (
      text: string,
      onClick: () => void,
      options: { cta?: boolean; disabled?: boolean } = {}
    ): HTMLButtonElement => {
      const button = actions.createEl("button", {
        cls: options.cta ? "evs-button mod-cta" : "evs-button",
        text
      });
      button.type = "button";
      button.disabled = options.disabled ?? false;
      button.addEventListener("click", onClick);
      return button;
    };

    if (session.phase === "listening" || session.phase === "ready") {
      addButton("开始录音", () => void this.startShadowingRecording(), { cta: true });
    } else if (session.phase === "requesting") {
      addButton("正在准备麦克风", () => undefined, { cta: true, disabled: true });
    } else if (session.phase === "recording") {
      addButton("暂停录音", () => this.pauseShadowingRecording(), { cta: true });
      addButton("结束录音", () => this.finishShadowingRecording());
    } else if (session.phase === "paused") {
      addButton("继续录音", () => this.resumeShadowingRecording(), { cta: true });
      addButton("结束录音", () => this.finishShadowingRecording());
    } else if (session.phase === "processing") {
      addButton("正在处理录音", () => undefined, { cta: true, disabled: true });
    } else {
      const isPlaying = Boolean(session.audioEl && !session.audioEl.paused);
      addButton(isPlaying ? "暂停录音" : "播放录音", () => this.toggleShadowingRecording(), {
        cta: true
      });
      addButton("重新录制", () => this.restartShadowingRecording());
      const nextIndex = session.index + 1;
      if (nextIndex < (this.transcript?.segments.length ?? 0)) {
        addButton("下一句", () => {
          this.closeShadowing(false);
          this.selectSegmentForActions(nextIndex, true);
          this.startShadowing(nextIndex);
        });
      }
    }
    addButton("退出跟读", () => this.closeShadowing());
    this.scheduleTranscriptLayout(true);
  }

  private playShadowingSegment(index: number, restart = true): void {
    const segment = this.transcript?.segments[index];
    const session = this.shadowingSession;
    if (!segment || !session || session.index !== index || this.destroyed) {
      return;
    }
    if (
      session.phase === "recording"
      || session.phase === "paused"
      || session.phase === "requesting"
      || session.phase === "processing"
    ) {
      return;
    }
    this.pauseShadowingRecordingPlayback(session);
    if (session.phase !== "recorded") {
      session.phase = "listening";
    }
    const current = this.getEstimatedCurrentTime();
    const target = restart || current < segment.start || current >= segment.end - 0.02
      ? segment.start
      : current;
    this.startShadowingSourceAt(index, target);
    this.renderShadowingPanel();
  }

  private startShadowingSourceAt(index: number, targetSeconds: number): void {
    const segment = this.transcript?.segments[index];
    const session = this.shadowingSession;
    if (!segment || !session || session.index !== index || this.destroyed) {
      return;
    }
    const target = clampShadowingPosition(targetSeconds, 0, segment.start, segment.end);
    session.sourceEnded = false;
    this.shadowingPlaybackStopAt = segment.end;
    this.clearPendingPlaybackCommand();
    if (this.localVideoEl) {
      void this.seekLocalVideoTo(target, true);
      return;
    }
    if (!this.iframeEl) {
      return;
    }
    this.setCurrentTime(target);
    this.updateActiveSegment();
    this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
    this.sendCommand("seekTo", [target, true]);
    this.sendCommand("playVideo");
  }

  private toggleShadowingSourcePlayback(): void {
    const session = this.shadowingSession;
    if (!session || !canAdjustShadowingSource(session.phase)) {
      return;
    }
    if (this.isPracticeSourcePlaying()) {
      this.stopShadowingSourcePlayback();
      if (session.phase === "recording" || session.phase === "paused") {
        session.syncSourceDuringRecording = false;
      }
      if (session.phase === "listening") {
        session.phase = "ready";
      }
      this.renderShadowingPanel();
      return;
    }
    if (session.phase === "recording" || session.phase === "paused") {
      const segment = this.transcript?.segments[session.index];
      if (!segment) {
        return;
      }
      const current = this.getEstimatedCurrentTime();
      const target = current < segment.start || current >= segment.end - 0.02
        ? segment.start
        : current;
      session.syncSourceDuringRecording = true;
      session.sourceEnded = false;
      this.startShadowingSourceAt(session.index, target);
      this.renderShadowingPanel();
      return;
    }
    this.playShadowingSegment(session.index, false);
  }

  private seekShadowingSource(deltaSeconds: number): void {
    const session = this.shadowingSession;
    const segment = session ? this.transcript?.segments[session.index] : null;
    if (
      !session
      || !segment
      || session.phase === "requesting"
      || session.phase === "processing"
    ) {
      return;
    }
    this.pauseShadowingRecordingPlayback(session);
    const shouldPlay = this.isPracticeSourcePlaying();
    const target = clampShadowingPosition(
      this.getEstimatedCurrentTime(),
      deltaSeconds,
      segment.start,
      segment.end
    );
    session.sourceEnded = target >= segment.end - 0.02;
    this.shadowingPlaybackStopAt = shouldPlay ? segment.end : null;
    if (this.localVideoEl) {
      void this.seekLocalVideoTo(target, shouldPlay);
    } else if (this.iframeEl) {
      this.clearPendingPlaybackCommand();
      this.setCurrentTime(target);
      this.updateActiveSegment();
      this.sendCommand("seekTo", [target, true]);
      if (shouldPlay) {
        this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
        this.sendCommand("playVideo");
      }
    }
    this.updateShadowingLiveUi(session);
  }

  private isPracticeSourcePlaying(): boolean {
    if (this.localVideoEl) {
      return !this.localVideoEl.paused;
    }
    return this.playerState === PLAYER_STATE_PLAYING
      || this.pendingPlaybackState === PLAYER_STATE_PLAYING;
  }

  private stopShadowingSourcePlayback(): void {
    this.shadowingPlaybackStopAt = null;
    if (this.destroyed) {
      return;
    }
    const currentTime = this.getEstimatedCurrentTime();
    if (this.localVideoEl) {
      this.localVideoEl.pause();
      this.setCurrentTime(currentTime);
      return;
    }
    if (!this.iframeEl) {
      return;
    }
    this.clearPendingPlaybackCommand();
    this.sendCommand("pauseVideo");
    this.playerState = PLAYER_STATE_PAUSED;
    this.setCurrentTime(currentTime);
    this.setPlayPauseVisual("play");
  }

  private stopShadowingPlaybackAtBoundary(): boolean {
    const stopAt = this.shadowingPlaybackStopAt;
    if (!shouldStopDictationPlayback(this.getEstimatedCurrentTime(), stopAt) || stopAt === null) {
      return false;
    }
    this.shadowingPlaybackStopAt = null;
    if (this.localVideoEl) {
      this.localVideoEl.pause();
    } else if (this.iframeEl) {
      this.clearPendingPlaybackCommand();
      this.sendCommand("pauseVideo");
      this.playerState = PLAYER_STATE_PAUSED;
      this.setPlayPauseVisual("play");
    }
    this.setCurrentTime(Math.max(0, stopAt - 0.01));
    const session = this.shadowingSession;
    if (session?.phase === "listening") {
      session.phase = session.audioEl ? "recorded" : "ready";
      this.renderShadowingPanel();
    } else if (session?.phase === "recording" && session.syncSourceDuringRecording) {
      session.sourceEnded = true;
      this.updateShadowingLiveUi(session);
    } else if (session?.phase === "paused") {
      session.sourceEnded = true;
      this.updateShadowingLiveUi(session);
    } else if (session?.phase === "recorded") {
      this.renderShadowingPanel();
    }
    return true;
  }

  private async startShadowingRecording(): Promise<void> {
    const session = this.shadowingSession;
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    const Recorder = viewWindow?.MediaRecorder;
    const mediaDevices = viewWindow?.navigator.mediaDevices;
    if (
      !session
      || (session.phase !== "ready" && session.phase !== "listening")
      || !Recorder
      || !mediaDevices?.getUserMedia
    ) {
      return;
    }

    const segment = this.transcript?.segments[session.index];
    if (!segment) {
      return;
    }
    session.syncSourceDuringRecording = this.isPracticeSourcePlaying();
    const currentPosition = this.getEstimatedCurrentTime();
    session.recordingSourcePosition = currentPosition < segment.start || currentPosition >= segment.end - 0.02
      ? segment.start
      : currentPosition;
    this.stopShadowingSourcePlayback();
    this.releaseShadowingRecording(session);
    session.recordingAccumulatedMs = 0;
    session.phase = "requesting";
    session.requestGeneration += 1;
    const requestGeneration = session.requestGeneration;
    this.renderShadowingPanel();

    let stream: MediaStream | null = null;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      if (
        this.destroyed ||
        this.shadowingSession !== session ||
        session.requestGeneration !== requestGeneration
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = selectShadowingMimeType(
        typeof Recorder.isTypeSupported === "function"
          ? (type) => Recorder.isTypeSupported(type)
          : null
      );
      const recorder = mimeType === ""
        ? new Recorder(stream)
        : new Recorder(stream, { mimeType });
      session.mediaStream = stream;
      session.mediaRecorder = recorder;
      session.chunks = [];
      this.setupShadowingWaveform(session, stream);
      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data.size > 0) {
          session.chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => this.completeShadowingRecording(session, recorder));
      recorder.addEventListener("error", () => this.failShadowingRecording(session));
      recorder.start(250);
      session.recordingStartedAt = Date.now();
      session.phase = "recording";
      this.renderShadowingPanel();
      this.startShadowingWaveformAnimation(session);
      this.scheduleShadowingRecordingLimit(session);
      if (session.syncSourceDuringRecording) {
        session.sourceEnded = false;
        this.startShadowingSourceAt(session.index, session.recordingSourcePosition);
      }
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (this.shadowingSession === session && session.requestGeneration === requestGeneration) {
        this.releaseShadowingAudioGraph(session);
        session.mediaStream = null;
        session.mediaRecorder = null;
        session.syncSourceDuringRecording = false;
        session.phase = "ready";
        this.renderShadowingPanel();
        new Notice(getShadowingRecordingErrorMessage(error), 8_000);
      }
    }
  }

  /** 已完成录音后直接开始下一次录制，不再要求用户重复点击“开始录音”。 */
  private restartShadowingRecording(): void {
    const session = this.shadowingSession;
    if (!session || session.phase !== "recorded") {
      return;
    }
    this.releaseShadowingRecording(session);
    session.recordingAccumulatedMs = 0;
    session.syncSourceDuringRecording = false;
    session.phase = "ready";
    this.renderShadowingPanel();
    void this.startShadowingRecording();
  }

  private pauseShadowingRecording(): void {
    const session = this.shadowingSession;
    const recorder = session?.mediaRecorder;
    if (!session || session.phase !== "recording" || !recorder) {
      return;
    }
    try {
      recorder.pause();
    } catch {
      this.failShadowingRecording(session);
      return;
    }
    session.recordingAccumulatedMs = this.getShadowingRecordingElapsed(session);
    this.captureShadowingWaveformToElapsed(session, session.recordingAccumulatedMs);
    this.clearShadowingRecordingLimit(session);
    this.stopShadowingWaveformAnimation(session);
    if (session.syncSourceDuringRecording) {
      this.stopShadowingSourcePlayback();
    }
    session.phase = "paused";
    this.renderShadowingPanel();
  }

  private resumeShadowingRecording(): void {
    const session = this.shadowingSession;
    const recorder = session?.mediaRecorder;
    if (!session || session.phase !== "paused" || !recorder) {
      return;
    }
    try {
      recorder.resume();
    } catch {
      this.failShadowingRecording(session);
      return;
    }
    session.recordingStartedAt = Date.now();
    session.phase = "recording";
    this.renderShadowingPanel();
    this.startShadowingWaveformAnimation(session);
    this.scheduleShadowingRecordingLimit(session);
    if (session.syncSourceDuringRecording && !session.sourceEnded) {
      const current = this.getEstimatedCurrentTime();
      this.startShadowingSourceAt(session.index, current);
    }
  }

  private finishShadowingRecording(): void {
    const session = this.shadowingSession;
    const recorder = session?.mediaRecorder;
    if (
      !session
      || (session.phase !== "recording" && session.phase !== "paused")
      || !recorder
    ) {
      return;
    }
    if (session.phase === "recording") {
      session.recordingAccumulatedMs = this.getShadowingRecordingElapsed(session);
      this.captureShadowingWaveformToElapsed(session, session.recordingAccumulatedMs);
    }
    this.clearShadowingRecordingLimit(session);
    this.stopShadowingWaveformAnimation(session);
    this.stopShadowingSourcePlayback();
    session.phase = "processing";
    this.renderShadowingPanel();
    try {
      recorder.stop();
    } catch {
      this.failShadowingRecording(session);
    }
  }

  private completeShadowingRecording(session: ShadowingSession, recorder: MediaRecorder): void {
    this.clearShadowingRecordingLimit(session);
    this.releaseShadowingAudioGraph(session);
    this.stopShadowingTracks(session);
    session.mediaRecorder = null;
    if (
      this.shadowingSession !== session ||
      this.destroyed ||
      session.phase !== "processing"
    ) {
      return;
    }
    const chunks = session.chunks.filter((chunk) => chunk.size > 0);
    session.chunks = [];
    if (chunks.length === 0) {
      session.phase = "ready";
      this.renderShadowingPanel();
      new Notice("没有录到声音，请检查麦克风后重新录制。", 5_000);
      return;
    }

    const mimeType = recorder.mimeType || chunks[0].type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    const objectUrl = (viewWindow?.URL ?? URL).createObjectURL(blob);
    const audio = this.containerEl.createEl("audio");
    audio.detach();
    // WebM 录音首次播放时可能仍在解析时长，提前加载可减少解码等待。
    audio.preload = "auto";
    audio.src = objectUrl;
    audio.addEventListener("playing", () => {
      if (this.shadowingSession === session && session.phase === "recorded") {
        this.startShadowingPlaybackClock(session);
        this.renderShadowingPanel();
        this.startShadowingWaveformAnimation(session);
      }
    });
    audio.addEventListener("waiting", () => {
      if (this.shadowingSession === session && session.phase === "recorded") {
        this.stopShadowingPlaybackClock(session);
        this.stopShadowingWaveformAnimation(session);
      }
    });
    audio.addEventListener("pause", () => {
      if (
        this.shadowingSession === session
        && session.phase === "recorded"
        && !audio.ended
      ) {
        this.stopShadowingPlaybackClock(session);
        this.stopShadowingWaveformAnimation(session);
        this.renderShadowingPanel();
      }
    });
    audio.addEventListener("ended", () => {
      if (this.shadowingSession === session && session.phase === "recorded") {
        this.stopShadowingPlaybackClock(session, true);
        this.stopShadowingWaveformAnimation(session);
        this.renderShadowingPanel();
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      if (this.shadowingSession === session && session.phase === "recorded") {
        this.drawShadowingWaveform(session);
      }
    });
    session.audioEl = audio;
    session.recordingUrl = objectUrl;
    session.recordingPlaybackAnchorMs = null;
    session.recordingPlaybackAnchorSeconds = 0;
    session.phase = "recorded";
    audio.load();
    this.renderShadowingPanel();
  }

  private failShadowingRecording(session: ShadowingSession): void {
    this.clearShadowingRecordingLimit(session);
    this.stopShadowingSourcePlayback();
    this.releaseShadowingAudioGraph(session);
    this.stopShadowingTracks(session);
    session.mediaRecorder = null;
    session.chunks = [];
    session.recordingAccumulatedMs = 0;
    session.syncSourceDuringRecording = false;
    if (this.shadowingSession !== session || this.destroyed) {
      return;
    }
    session.phase = "ready";
    this.renderShadowingPanel();
    new Notice("录音过程发生错误，请重新录制。", 5_000);
  }

  private toggleShadowingRecording(): void {
    const session = this.shadowingSession;
    const audio = session?.audioEl;
    if (!session || session.phase !== "recorded" || !audio) {
      return;
    }
    this.stopShadowingSourcePlayback();
    if (audio.paused) {
      void audio.play()
        .catch(() => new Notice("录音播放失败，请重新录制后再试。", 5_000));
    } else {
      this.stopShadowingPlaybackClock(session);
      audio.pause();
    }
  }

  private getShadowingPlaybackClockNow(): number {
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    return viewWindow?.performance.now() ?? Date.now();
  }

  private startShadowingPlaybackClock(session: ShadowingSession): void {
    const audio = session.audioEl;
    if (!audio) {
      return;
    }
    session.recordingPlaybackAnchorSeconds = Math.max(
      0,
      Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    );
    session.recordingPlaybackAnchorMs = this.getShadowingPlaybackClockNow();
  }

  private getShadowingPlaybackDisplayTime(session: ShadowingSession): number {
    const audio = session.audioEl;
    if (!audio) {
      return 0;
    }
    const anchorMs = session.recordingPlaybackAnchorMs;
    if (anchorMs === null || audio.paused || audio.ended) {
      return session.recordingPlaybackAnchorSeconds;
    }
    return getShadowingSmoothedPlaybackTime(
      session.recordingPlaybackAnchorSeconds,
      this.getShadowingPlaybackClockNow() - anchorMs,
      audio.playbackRate,
      audio.duration,
      session.recordingAccumulatedMs
    );
  }

  private stopShadowingPlaybackClock(session: ShadowingSession, ended = false): void {
    const audio = session.audioEl;
    if (!audio) {
      session.recordingPlaybackAnchorMs = null;
      session.recordingPlaybackAnchorSeconds = 0;
      return;
    }
    const displayedSeconds = this.getShadowingPlaybackDisplayTime(session);
    session.recordingPlaybackAnchorMs = null;
    session.recordingPlaybackAnchorSeconds = ended
      ? Math.max(0, session.recordingAccumulatedMs / 1_000)
      : Math.max(
        displayedSeconds,
        Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      );
  }

  private pauseShadowingRecordingPlayback(session: ShadowingSession): void {
    if (session.audioEl && !session.audioEl.paused) {
      this.stopShadowingPlaybackClock(session);
      session.audioEl.pause();
    }
    this.stopShadowingWaveformAnimation(session);
  }

  private getShadowingRecordingElapsed(session: ShadowingSession): number {
    return getShadowingActiveElapsedMs(
      session.recordingAccumulatedMs,
      session.recordingStartedAt,
      Date.now(),
      session.phase === "recording"
    );
  }

  private startShadowingUiTimer(session: ShadowingSession): void {
    if (session.uiTimer !== null) {
      return;
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (!viewWindow) {
      return;
    }
    session.uiTimer = viewWindow.setInterval(() => {
      if (this.shadowingSession === session && !this.destroyed) {
        this.updateShadowingLiveUi(session);
      }
    }, 50);
  }

  private updateShadowingLiveUi(session: ShadowingSession): void {
    const segment = this.transcript?.segments[session.index];
    if (!segment || this.shadowingSession !== session) {
      return;
    }
    const current = clampShadowingPosition(
      this.getEstimatedCurrentTime(),
      0,
      segment.start,
      segment.end
    );
    session.sourceTimeEl?.setText(
      `${formatShadowingElapsed((current - segment.start) * 1_000)} / ${formatShadowingElapsed((segment.end - segment.start) * 1_000)} · ${this.playbackRate}x`
    );
    if (session.sourcePlayButton) {
      const sourcePlaying = this.isPracticeSourcePlaying();
      this.setControlIcon(
        session.sourcePlayButton,
        sourcePlaying ? "pause" : "play",
        sourcePlaying ? "暂停当前句" : "播放当前句"
      );
    }
    if (session.phase === "recording") {
      const sourceEnded = session.syncSourceDuringRecording
        && session.sourceEnded;
      session.statusEl.setText(
        `● 录音中 ${formatShadowingRecordingElapsed(this.getShadowingRecordingElapsed(session))}${sourceEnded ? " · 原句已播放完" : ""}`
      );
    } else if (session.phase === "paused") {
      session.statusEl.setText(`已暂停 ${formatShadowingRecordingElapsed(session.recordingAccumulatedMs)}`);
    }
    if (session.phase === "recorded" && session.audioEl && !session.audioEl.paused) {
      this.drawShadowingWaveform(session);
    }
  }

  private scheduleShadowingRecordingLimit(session: ShadowingSession): void {
    this.clearShadowingRecordingLimit(session);
    const remainingMs = Math.max(0, SHADOWING_MAX_RECORDING_MS - session.recordingAccumulatedMs);
    session.limitTimer = window.setTimeout(() => {
      if (this.shadowingSession === session && session.phase === "recording") {
        new Notice("录音已达到 60 秒，已自动结束。", 4_000);
        this.finishShadowingRecording();
      }
    }, remainingMs);
  }

  private clearShadowingRecordingLimit(session: ShadowingSession): void {
    if (session.limitTimer !== null) {
      window.clearTimeout(session.limitTimer);
      session.limitTimer = null;
    }
  }

  private clearShadowingSessionTimers(session: ShadowingSession): void {
    this.clearShadowingRecordingLimit(session);
    if (session.uiTimer !== null) {
      window.clearInterval(session.uiTimer);
      session.uiTimer = null;
    }
  }

  private setupShadowingWaveform(session: ShadowingSession, stream: MediaStream): void {
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    const AudioContextConstructor = viewWindow?.AudioContext;
    if (!AudioContextConstructor) {
      return;
    }
    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      session.audioContext = audioContext;
      session.analyserNode = analyser;
      session.audioSourceNode = source;
      session.waveformSamples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }
    } catch {
      this.releaseShadowingAudioGraph(session);
    }
  }

  private startShadowingWaveformAnimation(session: ShadowingSession): void {
    if (session.waveformFrame !== null) {
      return;
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (!viewWindow) {
      return;
    }
    const drawFrame = (): void => {
      session.waveformFrame = null;
      if (this.shadowingSession !== session || this.destroyed) {
        return;
      }
      if (session.phase === "recording") {
        this.captureShadowingWaveformToElapsed(
          session,
          this.getShadowingRecordingElapsed(session)
        );
      }
      this.drawShadowingWaveform(session);
      const shouldContinue = session.phase === "recording"
        || (session.phase === "recorded" && Boolean(session.audioEl && !session.audioEl.paused));
      if (shouldContinue) {
        session.waveformFrame = viewWindow.requestAnimationFrame(drawFrame);
      }
    };
    session.waveformFrame = viewWindow.requestAnimationFrame(drawFrame);
  }

  /**
   * 浏览器绘制掉帧时补齐缺失的时间槽，避免录音越长，进度线越领先波形。
   * 缺失槽使用前后两个真实峰值平滑插值，不会改变录音文件本身。
   */
  private captureShadowingWaveformToElapsed(
    session: ShadowingSession,
    elapsedMs: number
  ): void {
    if (!session.analyserNode || !session.waveformSamples) {
      return;
    }
    const targetSampleCount = getShadowingWaveformTargetSampleCount(elapsedMs);
    const missingSampleCount = targetSampleCount - session.waveformPeaks.length;
    if (missingSampleCount <= 0) {
      return;
    }

    session.analyserNode.getByteTimeDomainData(session.waveformSamples);
    const nextPeak = calculateShadowingWaveformPeak(session.waveformSamples);
    const previousPeak = session.waveformPeaks.at(-1) ?? nextPeak;
    for (let index = 1; index <= missingSampleCount; index += 1) {
      const progress = index / missingSampleCount;
      session.waveformPeaks.push(
        previousPeak + (nextPeak - previousPeak) * progress
      );
    }
  }

  private stopShadowingWaveformAnimation(session: ShadowingSession): void {
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (session.waveformFrame !== null && viewWindow) {
      viewWindow.cancelAnimationFrame(session.waveformFrame);
    }
    session.waveformFrame = null;
    this.drawShadowingWaveform(session);
  }

  private drawShadowingWaveform(session: ShadowingSession): void {
    const canvas = session.waveformCanvas;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const viewWindow = canvas.ownerDocument.defaultView;
    const ratio = Math.max(1, viewWindow?.devicePixelRatio ?? 1);
    const width = Math.max(280, Math.floor(canvas.clientWidth || 640));
    const height = Math.max(56, Math.floor(canvas.clientHeight || 56));
    const pixelWidth = Math.floor(width * ratio);
    const pixelHeight = Math.floor(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = viewWindow?.getComputedStyle(canvas);
    context.strokeStyle = styles?.color || "#6b7280";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const peaks = session.waveformPeaks;
    const isLiveWaveform = session.phase === "recording" || session.phase === "paused";
    const liveSampleCapacity = getShadowingWaveformTargetSampleCount(
      SHADOWING_MAX_RECORDING_MS
    );
    const liveLayout = getShadowingLiveWaveformLayout(
      peaks.length,
      liveSampleCapacity
    );
    if (peaks.length > 0) {
      const barWidth = isLiveWaveform
        ? width / liveLayout.slotCount
        : 4;
      const samplesPerBar = isLiveWaveform
        ? getShadowingWaveformBinSize(barWidth)
        : Math.max(1, peaks.length / Math.max(1, Math.floor(width / barWidth)));
      const barCount = isLiveWaveform
        ? Math.ceil(liveLayout.visibleCount / samplesPerBar)
        : Math.min(peaks.length, Math.max(1, Math.floor(width / barWidth)));
      context.beginPath();
      for (let index = 0; index < barCount; index += 1) {
        const groupStart = isLiveWaveform
          ? liveLayout.startIndex + index * samplesPerBar
          : Math.floor(index * samplesPerBar);
        const groupEnd = Math.min(
          isLiveWaveform
            ? liveLayout.startIndex + liveLayout.visibleCount
            : peaks.length,
          Math.ceil(groupStart + samplesPerBar)
        );
        let peak = 0;
        for (let peakIndex = groupStart; peakIndex < groupEnd; peakIndex += 1) {
          peak = Math.max(peak, peaks[peakIndex] ?? 0);
        }
        const barHeight = peak * (height - 12);
        // 静音与底噪不绘制最小竖线，避免密集采样叠加后把已走过的中线加粗。
        if (barHeight < 2) {
          continue;
        }
        const x = isLiveWaveform
          ? (liveLayout.startSlot + index * samplesPerBar + samplesPerBar / 2) * barWidth
          : index * barWidth + barWidth / 2;
        context.moveTo(x, (height - barHeight) / 2);
        context.lineTo(x, (height + barHeight) / 2);
      }
      context.stroke();
    }

    let playheadRatio = session.phase === "recorded"
      ? 0
      : isLiveWaveform
        ? getShadowingRecordingProgress(
          session.phase === "recording"
            ? this.getShadowingRecordingElapsed(session)
            : session.recordingAccumulatedMs
        )
        : 1;
    const audio = session.audioEl;
    if (session.phase === "recorded" && audio) {
      playheadRatio = getShadowingPlaybackProgress(
        this.getShadowingPlaybackDisplayTime(session),
        audio.duration,
        session.recordingAccumulatedMs,
        audio.ended
      );
    }
    const accent = styles?.getPropertyValue("--interactive-accent").trim() || "#3b82f6";
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(width * playheadRatio, 0);
    context.lineTo(width * playheadRatio, height);
    context.stroke();
  }

  private releaseShadowingAudioGraph(session: ShadowingSession): void {
    this.stopShadowingWaveformAnimation(session);
    try {
      session.audioSourceNode?.disconnect();
      session.analyserNode?.disconnect();
    } catch {
      // 某些 Chromium 版本在音轨结束后会提前断开节点。
    }
    if (session.audioContext && session.audioContext.state !== "closed") {
      void session.audioContext.close().catch(() => undefined);
    }
    session.audioContext = null;
    session.analyserNode = null;
    session.audioSourceNode = null;
    session.waveformSamples = null;
  }

  private stopShadowingTracks(session: ShadowingSession): void {
    session.mediaStream?.getTracks().forEach((track) => track.stop());
    session.mediaStream = null;
  }

  private releaseShadowingRecording(session: ShadowingSession): void {
    this.pauseShadowingRecordingPlayback(session);
    if (session.audioEl) {
      session.audioEl.removeAttribute("src");
      session.audioEl.load();
      session.audioEl = null;
    }
    if (session.recordingUrl) {
      const viewWindow = this.containerEl.ownerDocument.defaultView;
      (viewWindow?.URL ?? URL).revokeObjectURL(session.recordingUrl);
      session.recordingUrl = null;
    }
    session.waveformPeaks = [];
    session.recordingPlaybackAnchorMs = null;
    session.recordingPlaybackAnchorSeconds = 0;
    this.drawShadowingWaveform(session);
  }

  private closeShadowing(restoreActions = true): void {
    const session = this.shadowingSession;
    this.stopShadowingSourcePlayback();
    if (!session) {
      return;
    }

    session.requestGeneration += 1;
    this.clearShadowingSessionTimers(session);
    this.releaseShadowingAudioGraph(session);
    if (session.mediaRecorder && session.mediaRecorder.state !== "inactive") {
      try {
        session.mediaRecorder.stop();
      } catch {
        // 卸载或快速退出时录音器可能已经停止，继续执行资源清理即可。
      }
    }
    session.mediaRecorder = null;
    this.stopShadowingTracks(session);
    this.releaseShadowingRecording(session);
    session.chunks = [];
    const row = this.segmentRows[session.index];
    row?.classList.remove("is-shadowing");
    row?.querySelector<HTMLElement>(".evs-segment-state")?.setText("正在播放");
    session.panelEl.remove();
    this.shadowingSession = null;
    this.segmentActionTargetPinned = false;
    this.segmentShadowingButton?.classList.remove("is-active");
    if (!this.destroyed && this.controlsActivated) {
      this.timestampButtons.forEach((button) => (button.disabled = false));
    }

    if (!this.destroyed && restoreActions) {
      this.selectSegmentForActions(session.index, false);
      this.translationViews.forEach((view) => this.updateTranslationView(view));
      this.scheduleTranscriptLayout(true);
    } else if (!this.destroyed) {
      this.segmentEditButton?.removeAttribute("disabled");
      this.translationViews.forEach((view) => this.updateTranslationView(view));
      this.updateDictationActionAvailability();
      this.updateShadowingActionAvailability();
    }
  }

  private openSegmentEditor(index: number): void {
    const segment = this.transcript?.segments[index];
    if (!segment) {
      return;
    }
    new EditTranscriptSegmentModal(
      this.plugin.app,
      segment.text,
      segment.originalText,
      (text) => this.saveSegmentText(index, text)
    ).open();
  }

  private async saveSegmentText(index: number, text: string): Promise<void> {
    const transcript = this.transcript;
    if (!transcript || this.destroyed) {
      throw new Error("当前字幕已经关闭，请重新打开笔记后再试。");
    }
    const segment = transcript.segments[index];
    if (!segment) {
      throw new Error("要修改的字幕已经变化，请重新打开笔记后再试。");
    }
    if (segment.text === text.trim()) {
      return;
    }
    const committed = await this.plugin.updateTranscriptSegmentFile(
      this.transcriptPath,
      this.sourcePath,
      {
        videoId: transcript.videoId,
        start: segment.start,
        end: segment.end
      },
      text
    );
    if (this.destroyed) {
      return;
    }
    if (committed.segments.length !== transcript.segments.length) {
      throw new Error("字幕结构已经变化，请重新打开笔记后再继续编辑。");
    }
    const changedIndexes = committed.segments.flatMap((committedSegment, segmentIndex) =>
      committedSegment.text === transcript.segments[segmentIndex]?.text ? [] : [segmentIndex]
    );
    this.transcript = committed;
    await Promise.all(changedIndexes.map((segmentIndex) => this.refreshSegmentText(segmentIndex)));
    this.scheduleTranscriptLayout(true);
    new Notice("字幕已保存；时间轴未改变。", 4_000);
  }

  private async refreshSegmentText(index: number): Promise<void> {
    const segment = this.transcript?.segments[index];
    const view = this.translationViews[index];
    if (!segment || !view) {
      return;
    }
    const textEl = this.segmentTextEls[index];
    if (textEl) {
      this.renderDictionaryText(textEl, segment.text, index);
    }
    view.requestGeneration += 1;
    view.fingerprint = await createSegmentFingerprint(segment.start, segment.end, segment.text);
    view.studyFingerprints = await createStudyFingerprintMap(segment);
    const cachedTranslation = this.cachedTranslations[view.fingerprint];
    view.entry = cachedTranslation?.sourceText === segment.text ? cachedTranslation : null;
    view.studyEntries = {};
    for (const profile of STUDY_PROFILES) {
      const cachedStudy = this.cachedStudies[view.studyFingerprints[profile]];
      if (cachedStudy?.sourceText === segment.text && cachedStudy.profile === profile) {
        view.studyEntries[profile] = cachedStudy;
      }
    }
    view.visible = false;
    view.loading = false;
    view.loadingAction = null;
    view.errorMessage = null;
    view.statusTone = null;
    this.updateTranslationView(view);
    this.scheduleTranscriptLayout(true);
  }

  private updateTranslationView(view: SegmentTranslationView): void {
    const currentStudyEntry = view.studyEntries[this.plugin.settings.studyProfile] ?? null;
    const hasOutput = Boolean(currentStudyEntry || view.entry);
    const wholeTranscriptPending =
      this.plugin.settings.translateWholeTranscript && this.getPendingTranslationIndices().length > 0;
    const practiceActive = this.dictationSession !== null || this.shadowingSession !== null;
    view.primaryButton.disabled =
      view.loading || this.translationBatchRunning || practiceActive;
    view.retranslateButton.disabled = view.loading || this.translationBatchRunning || practiceActive;
    view.supplementButton.disabled = view.loading || this.translationBatchRunning || practiceActive;
    view.primaryButton.setAttribute("aria-expanded", view.visible.toString());
    view.primaryButton.classList.toggle("is-expanded", view.visible);
    view.primaryButton.classList.toggle(
      "is-loading",
      view.loading && view.loadingAction === "translate"
    );
    view.retranslateButton.classList.toggle(
      "is-loading",
      view.loading && view.loadingAction === "retranslate"
    );
    view.supplementButton.classList.toggle(
      "is-loading",
      view.loading && view.loadingAction === "supplement"
    );

    let primaryLabel: string;
    if (this.translationBatchRunning) {
      primaryLabel = "正在翻译整篇文稿";
    } else if (view.loading) {
      primaryLabel = view.loadingAction === "supplement" ? "正在补充知识点" : "正在生成翻译";
    } else if (wholeTranscriptPending) {
      primaryLabel = "翻译整篇文稿";
    } else if (hasOutput) {
      primaryLabel = view.visible ? "隐藏翻译" : "显示翻译";
    } else {
      primaryLabel = view.errorMessage ? "重试翻译" : "翻译";
    }
    this.setTranscriptActionLabel(view.primaryButton, primaryLabel);
    this.setTranscriptActionLabel(
      view.retranslateButton,
      view.loadingAction === "retranslate" ? "正在重新翻译" : "重新翻译"
    );
    this.setTranscriptActionLabel(
      view.supplementButton,
      view.loadingAction === "supplement" ? "正在补充知识点" : "补充知识点"
    );

    if (hasOutput) {
      this.renderTranslationOutput(view, currentStudyEntry);
      if (view.visible) {
        view.outputEl.show();
      } else {
        view.outputEl.hide();
      }
    } else {
      view.outputEl.empty();
      view.outputEl.hide();
    }

    if (view.errorMessage) {
      view.statusEl.setText(view.errorMessage);
      view.statusEl.classList.toggle("is-error", view.statusTone === "error");
      view.statusEl.classList.toggle("is-warning", view.statusTone === "warning");
      view.statusEl.show();
    } else if (view.loading) {
      view.statusEl.setText(
        view.loadingAction === "supplement"
          ? "正在补充知识点……"
          : view.loadingAction === "retranslate"
            ? "正在重新生成译文与知识点……"
            : "正在生成译文与知识点……"
      );
      view.statusEl.classList.remove("is-error");
      view.statusEl.classList.remove("is-warning");
      view.statusEl.show();
    } else {
      view.statusEl.empty();
      view.statusEl.classList.remove("is-error");
      view.statusEl.classList.remove("is-warning");
      view.statusEl.hide();
    }
    if (this.translationViews[this.segmentActionTargetIndex] === view) {
      this.updateDictationActionAvailability();
      this.updateShadowingActionAvailability();
    }
    this.scheduleTranscriptLayout(true);
  }

  /** 翻译图标按设置处理当前句，或顺序补齐整篇文稿中尚未翻译的句子。 */
  private handlePrimaryTranslationAction(index: number): void {
    const view = this.translationViews[index];
    if (!view || this.destroyed) {
      return;
    }

    if (this.plugin.settings.translateWholeTranscript) {
      const pendingIndices = this.getPendingTranslationIndices();
      if (pendingIndices.length > 0) {
        void this.requestWholeTranscriptTranslation(pendingIndices);
        return;
      }
    }

    if (this.hasTranslationOutput(view)) {
      view.visible = !view.visible;
      view.errorMessage = null;
      view.statusTone = null;
      this.updateTranslationView(view);
      return;
    }
    void this.requestTranslation(index, "translate");
  }

  private hasTranslationOutput(view: SegmentTranslationView): boolean {
    return Boolean(view.entry || view.studyEntries[this.plugin.settings.studyProfile]);
  }

  private getPendingTranslationIndices(): number[] {
    const pending: number[] = [];
    for (const [index, view] of this.translationViews.entries()) {
      if (!this.hasTranslationOutput(view)) {
        pending.push(index);
      }
    }
    return pending;
  }

  /**
   * 整篇翻译严格串行，避免瞬间发出大量请求。已有结果会在调用前被排除；
   * 首句就失败时停止批处理，防止配置错误导致整篇重复失败。
   */
  private async requestWholeTranscriptTranslation(pendingIndices: number[]): Promise<void> {
    if (this.translationBatchRunning || pendingIndices.length === 0 || this.destroyed) {
      return;
    }

    this.translationBatchRunning = true;
    this.segmentActionDockEl?.setAttribute("aria-busy", "true");
    this.translationViews.forEach((view) => this.updateTranslationView(view));
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();
    new Notice(`开始翻译整篇文稿，共 ${pendingIndices.length} 句；已有结果会自动跳过。`, 5_000);

    let succeeded = 0;
    let failed = 0;
    try {
      for (const index of pendingIndices) {
        if (this.destroyed) {
          break;
        }
        const view = this.translationViews[index];
        if (!view || this.hasTranslationOutput(view)) {
          continue;
        }
        await this.requestTranslation(index, "translate");
        if (this.hasTranslationOutput(view)) {
          succeeded += 1;
        } else {
          failed += 1;
          if (succeeded === 0) {
            break;
          }
        }
      }
    } finally {
      this.translationBatchRunning = false;
      this.segmentActionDockEl?.removeAttribute("aria-busy");
      if (!this.destroyed) {
        this.translationViews.forEach((view) => this.updateTranslationView(view));
        this.updateDictationActionAvailability();
        this.updateShadowingActionAvailability();
      }
    }

    if (this.destroyed) {
      return;
    }
    if (failed === 0) {
      new Notice(`整篇翻译完成：新增 ${succeeded} 句。`, 5_000);
    } else if (succeeded === 0) {
      new Notice("整篇翻译已停止：首个待翻译句失败，请查看该句提示后重试。", 7_000);
    } else {
      new Notice(`整篇翻译完成：成功 ${succeeded} 句，失败 ${failed} 句；可再次点击重试。`, 7_000);
    }
  }

  private renderTranslationOutput(
    view: SegmentTranslationView,
    studyEntry: StudyCacheEntry | null
  ): void {
    view.outputEl.empty();
    // 译文缓存独立于知识卡。即使这次知识点格式异常，也优先展示并保留
    // 已经成功解析的新译文，同时继续显示之前有效的知识点。
    const translation = view.entry?.text ?? studyEntry?.analysis.translation;
    if (!translation) {
      return;
    }
    view.outputEl.appendChild(view.retranslateButton);
    view.retranslateButton.show();
    const translationSection = view.outputEl.createDiv({ cls: "evs-study-section" });
    translationSection.createDiv({ cls: "evs-study-heading", text: "中文译文" });
    translationSection.createDiv({ cls: "evs-translation-copy", text: translation });
    if (!studyEntry) {
      const legacyRow = view.outputEl.createDiv({ cls: "evs-study-legacy-row" });
      legacyRow.createDiv({
        cls: "evs-study-legacy-note",
        text: `这是已有纯译文，尚未按当前${this.plugin.getStudyProfileLabel()}目标生成知识点。`
      });
      if (view.entry) {
        legacyRow.appendChild(view.supplementButton);
        view.supplementButton.show();
      }
      return;
    }

    const profileBadge = view.outputEl.createDiv({ cls: "evs-study-profile-badge" });
    profileBadge.setText(`按${this.plugin.getStudyProfileLabel(studyEntry.profile)}范围讲解`);
    if (studyEntry.analysis.keyPoints.length > 0) {
      const section = view.outputEl.createDiv({ cls: "evs-study-section" });
      section.createDiv({ cls: "evs-study-heading", text: "重点词汇与搭配" });
      const list = section.createEl("ul", { cls: "evs-study-list" });
      for (const point of studyEntry.analysis.keyPoints) {
        const item = list.createEl("li");
        item.createEl("strong", { text: point.expression });
        item.createSpan({ text: `：${point.meaning}` });
        item.createDiv({ cls: "evs-study-note", text: point.note });
      }
    }
    if (studyEntry.analysis.grammar.length > 0) {
      const section = view.outputEl.createDiv({ cls: "evs-study-section" });
      section.createDiv({ cls: "evs-study-heading", text: "语法与句型" });
      const list = section.createEl("ul", { cls: "evs-study-list" });
      for (const grammar of studyEntry.analysis.grammar) {
        const item = list.createEl("li");
        item.createEl("strong", { text: grammar.pattern });
        item.createDiv({ cls: "evs-study-note", text: grammar.explanation });
      }
    }
    const tip = view.outputEl.createDiv({ cls: "evs-study-section evs-study-exam-tip" });
    tip.createDiv({ cls: "evs-study-heading", text: "备考提示" });
    tip.createDiv({ text: studyEntry.analysis.examTip });

    const extensions = studyEntry.analysis.extensions ?? [];
    if (extensions.length > 0) {
      const section = view.outputEl.createDiv({ cls: "evs-study-section evs-study-extensions" });
      section.createDiv({ cls: "evs-study-heading", text: "延伸拓展" });
      const list = section.createDiv({ cls: "evs-study-extension-list" });
      for (const extension of extensions) {
        const item = list.createDiv({ cls: "evs-study-extension-item" });
        item.createDiv({
          cls: "evs-study-extension-anchor",
          text: `由原句中的“${extension.anchor}”延伸`
        });
        const title = item.createDiv({ cls: "evs-study-extension-title" });
        title.createEl("strong", { text: extension.expression });
        title.createSpan({ text: `：${extension.meaning}` });
        item.createDiv({ cls: "evs-study-note", text: extension.note });
        const example = item.createDiv({ cls: "evs-study-extension-example" });
        example.createDiv({ text: extension.example, attr: { lang: "en" } });
        example.createDiv({ text: extension.exampleTranslation, attr: { lang: "zh-CN" } });
      }
    }
  }

  private async requestTranslation(
    index: number,
    action: "translate" | "retranslate" | "supplement"
  ): Promise<void> {
    const transcript = this.transcript;
    const segment = transcript?.segments[index];
    const view = this.translationViews[index];
    if (!segment || !view || view.loading || this.destroyed) {
      return;
    }

    const generation = view.requestGeneration + 1;
    const profile = this.plugin.settings.studyProfile;
    view.requestGeneration = generation;
    view.loading = true;
    view.loadingAction = action;
    view.errorMessage = null;
    view.statusTone = null;
    this.updateTranslationView(view);

    let result: StudyAnalysisResult;
    try {
      result = await this.plugin.analyzeSentence(segment.text, profile);
    } catch (error) {
      if (this.destroyed || view.requestGeneration !== generation) {
        return;
      }

      view.loading = false;
      view.loadingAction = null;
      view.errorMessage = error instanceof Error ? error.message : "知识卡生成失败，请稍后重试。";
      view.statusTone = "error";
      this.updateTranslationView(view);
      return;
    }

    if (this.destroyed || view.requestGeneration !== generation) {
      return;
    }

    const entry: TranslationCacheEntry = {
      sourceText: segment.text,
      text: result.translation,
      provider: result.provider,
      model: result.model,
      updatedAt: new Date().toISOString()
    };
    const previousStudyEntry = view.studyEntries[profile] ?? null;
    const generatedStudyEntry: StudyCacheEntry | null = result.analysis
      ? {
        sourceText: segment.text,
        profile,
        analysisVersion: STUDY_ANALYSIS_VERSION,
        analysis: result.analysis,
        provider: result.provider,
        model: result.model,
        updatedAt: entry.updatedAt
      }
      : null;
    const studyEntry = generatedStudyEntry ?? previousStudyEntry;

    view.entry = entry;
    this.cachedTranslations[view.fingerprint] = entry;
    if (generatedStudyEntry) {
      view.studyEntries[profile] = generatedStudyEntry;
      this.cachedStudies[view.studyFingerprints[profile]] = generatedStudyEntry;
    } else if (!studyEntry) {
      delete view.studyEntries[profile];
    }
    view.visible = true;
    view.loading = false;
    view.loadingAction = null;
    view.errorMessage = !result.analysis && previousStudyEntry
      ? `${result.warning ?? "新的知识点格式异常。"} 已保留原来的完整知识卡。`
      : result.warning;
    view.statusTone = view.errorMessage ? result.analysis ? "warning" : "error" : null;
    this.updateTranslationView(view);

    if (!this.plugin.settings.cacheTranslations) {
      return;
    }

    const cacheWrites: Array<Promise<unknown>> = [
      this.plugin.saveTranslationCache(
        this.transcriptPath,
        transcript.videoId,
        view.fingerprint,
        entry
      )
    ];
    if (generatedStudyEntry) {
      cacheWrites.push(this.plugin.saveStudyCache(
        this.transcriptPath,
        transcript.videoId,
        view.studyFingerprints[profile],
        generatedStudyEntry
      ));
    }
    const cacheResults = await Promise.allSettled(cacheWrites);
    if (cacheResults.some((cacheResult) => cacheResult.status === "rejected")) {
      if (this.destroyed || view.requestGeneration !== generation) {
        return;
      }

      const cacheWarning = generatedStudyEntry
        ? "知识卡已生成，但部分本地缓存保存失败；本次结果仍可继续查看。"
        : "译文已生成，但本地缓存保存失败；本次结果仍可继续查看。";
      view.errorMessage = view.errorMessage
        ? `${view.errorMessage} ${cacheWarning}`
        : cacheWarning;
      view.statusTone ??= "warning";
      this.updateTranslationView(view);
    }
  }

  private createControlButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    action: () => void,
    extraClass = ""
  ): HTMLButtonElement {
    const className = `evs-button evs-icon-button${extraClass === "" ? "" : ` ${extraClass}`}`;
    const button = parent.createEl("button", { cls: className });
    button.type = "button";
    button.disabled = true;
    this.setControlIcon(button, icon, label);
    button.addEventListener("click", action);
    this.controlButtons.push(button);
    return button;
  }

  private createSourceLink(parent: HTMLElement, url: string): HTMLAnchorElement {
    const link = parent.createEl("a", {
      cls: "evs-button evs-icon-button evs-source-link",
      href: url,
      attr: {
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": "在浏览器中打开原视频"
      }
    });
    this.setControlIcon(link, "external-link", "在浏览器中打开原视频");
    return link;
  }

  private createTranscriptImportButton(
    parent: HTMLElement,
    config: BilibiliCodeBlockConfig,
    hasTranscript: boolean
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "evs-button evs-icon-button evs-add-transcript-button"
    });
    button.type = "button";
    this.setControlIcon(
      button,
      "captions",
      hasTranscript ? "替换字幕或导入文稿" : "添加字幕或导入博主文稿"
    );
    button.addEventListener("click", () => {
      void this.plugin.openBilibiliTranscriptImport(this.sourcePath, config);
    });
    return button;
  }

  private createSeekButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    action: () => void
  ): HTMLButtonElement {
    const button = this.createControlButton(
      parent,
      label,
      icon,
      action,
      "evs-seek-button"
    );
    button.createSpan({ cls: "evs-seek-seconds", text: "5s" });
    return button;
  }

  private createSpeedControls(parent: HTMLElement): void {
    const speedGroup = parent.createDiv({ cls: "evs-speed-group" });
    speedGroup.setAttribute("aria-label", "播放速度");
    speedGroup.setAttribute("role", "group");
    speedGroup.setCssProps({ "--evs-speed-offset": "100%" });

    const thumb = speedGroup.createDiv({ cls: "evs-speed-slider-thumb" });
    thumb.setAttribute("aria-hidden", "true");
    const labels = speedGroup.createDiv({ cls: "evs-speed-labels" });
    this.speedLabelEls = PLAYBACK_RATES.map((rate) => labels.createSpan({
      cls: rate === 1 ? "evs-speed-label is-active" : "evs-speed-label",
      text: `${rate}×`
    }));

    const slider = speedGroup.createEl("input", {
      cls: "evs-speed-slider",
      attr: {
        type: "range",
        min: "0",
        max: String(PLAYBACK_RATES.length - 1),
        step: "1",
        value: "1",
        "aria-label": "播放速度",
        "aria-valuetext": "1 倍速"
      }
    });
    slider.disabled = true;
    slider.addEventListener("input", () => {
      const rate = PLAYBACK_RATES[slider.valueAsNumber] ?? this.playbackRate;
      this.speedSliderPreviewRate = rate;
      this.updateSpeedControl(this.playbackRate);
    });
    slider.addEventListener("change", () => {
      const rate = this.speedSliderPreviewRate
        ?? PLAYBACK_RATES[slider.valueAsNumber]
        ?? this.playbackRate;
      this.speedSliderPreviewRate = null;
      this.setPlaybackRate(rate);
    });

    // Obsidian/Electron 对接近全透明的 range 存在鼠标命中不稳定的问题。
    // 让可见轨道直接处理指针事件；原生 range 继续提供键盘与无障碍支持。
    let activePointerId: number | null = null;
    const previewPointerRate = (clientX: number): number => {
      const rect = speedGroup.getBoundingClientRect();
      const ratio = rect.width <= 0
        ? 0
        : Math.min(0.999_999, Math.max(0, (clientX - rect.left) / rect.width));
      const index = Math.min(
        PLAYBACK_RATES.length - 1,
        Math.floor(ratio * PLAYBACK_RATES.length)
      );
      const rate = PLAYBACK_RATES[index] ?? this.playbackRate;
      slider.value = String(index);
      this.speedSliderPreviewRate = rate;
      this.updateSpeedControl(this.playbackRate);
      return rate;
    };
    speedGroup.addEventListener("pointerdown", (event) => {
      if (slider.disabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      activePointerId = event.pointerId;
      speedGroup.setPointerCapture(event.pointerId);
      speedGroup.classList.add("is-dragging");
      slider.focus({ preventScroll: true });
      previewPointerRate(event.clientX);
    });
    speedGroup.addEventListener("pointermove", (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      previewPointerRate(event.clientX);
    });
    speedGroup.addEventListener("pointerup", (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      const rate = previewPointerRate(event.clientX);
      if (speedGroup.hasPointerCapture(event.pointerId)) {
        speedGroup.releasePointerCapture(event.pointerId);
      }
      activePointerId = null;
      speedGroup.classList.remove("is-dragging");
      this.speedSliderPreviewRate = null;
      this.setPlaybackRate(rate);
    });
    speedGroup.addEventListener("pointercancel", (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      activePointerId = null;
      speedGroup.classList.remove("is-dragging");
      this.speedSliderPreviewRate = null;
      this.updateSpeedControl(this.playbackRate);
    });

    this.speedGroupEl = speedGroup;
    this.speedSliderEl = slider;
  }

  private setControlIcon(element: HTMLElement, icon: string, label: string): void {
    element.empty();
    setIcon(element, icon);
    element.setAttribute("aria-label", label);
    element.setAttribute("title", label);
  }

  private setTranscriptActionIcon(
    button: HTMLButtonElement,
    iconName: string,
    label: string
  ): void {
    button.empty();
    setIcon(button, iconName);
    this.setTranscriptActionLabel(button, label);
  }

  private setTranscriptActionLabel(button: HTMLButtonElement, label: string): void {
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  private setPlayPauseVisual(state: "play" | "pause" | "loading", label?: string): void {
    const button = this.playPauseButton;
    if (!button) {
      return;
    }
    button.classList.toggle("is-loading", state === "loading");
    if (state === "loading") {
      this.setControlIcon(button, "loader-circle", label ?? "正在处理播放操作");
      return;
    }
    this.setControlIcon(button, state, state === "pause" ? "暂停" : "播放");
  }

  private activateControls(statusText: string, hideReadyLocalStatus = false): void {
    if (!this.controlsActivated) {
      this.controlsActivated = true;
      this.controlButtons.forEach((button) => (button.disabled = false));
      this.timestampButtons.forEach((button) => (button.disabled = false));

      if (this.speedSliderEl) {
        this.speedSliderEl.disabled = false;
      }
    }

    this.updateSpeedControl(this.playbackRate);
    this.setStatusText(statusText, hideReadyLocalStatus);

    if (this.pollTimer === null) {
      this.pollTimer = window.setInterval(() => this.updateActiveSegment(), 250);
    }
    this.updateDictationActionAvailability();
    this.updateShadowingActionAvailability();
    this.updateActiveSegment();
  }

  private setStatusText(statusText: string, autoHideLocalStatus: boolean): void {
    const status = this.statusEl;
    if (!status) {
      return;
    }
    if (this.localStatusHideTimer !== null) {
      window.clearTimeout(this.localStatusHideTimer);
      this.localStatusHideTimer = null;
    }
    status.setText(statusText);
    status.classList.remove("is-collapsed");
    this.scheduleTranscriptLayout(true);

    if (!this.localVideoEl || !autoHideLocalStatus) {
      return;
    }
    this.localStatusHideTimer = window.setTimeout(() => {
      this.localStatusHideTimer = null;
      if (this.destroyed || !this.statusEl) {
        return;
      }
      this.statusEl.classList.add("is-collapsed");
      this.scheduleTranscriptLayout(true);
    }, LOCAL_STATUS_READY_DELAY_MS);
  }

  private onPlayerReady(): void {
    if (this.playerReady) {
      return;
    }

    this.playerReady = true;
    this.clearTimer("handshake");
    this.clearTimer("fallback");
    const segmentCount = this.transcript?.segments.length ?? 0;
    this.activateControls(`播放器已就绪 · ${segmentCount} 条英文字幕`);
  }

  private setupMessageListener(): void {
    this.messageWindow = this.containerEl.ownerDocument.defaultView ?? window;
    this.messageHandler = (event: MessageEvent): void => this.onYouTubeMessage(event);
    this.messageWindow.addEventListener("message", this.messageHandler);
  }

  private startPlayerHandshake(): void {
    this.clearTimer("handshake");

    const announce = (): void => {
      const iframeId = this.iframeEl?.id;
      if (!iframeId) {
        return;
      }

      this.postPlayerMessage({ event: "listening", channel: iframeId });
      ["onReady", "onStateChange", "onPlaybackRateChange", "onError"].forEach((eventName) => {
        this.sendCommand("addEventListener", [eventName]);
      });
    };

    announce();
    this.handshakeTimer = window.setInterval(announce, PLAYER_HANDSHAKE_INTERVAL_MS);
  }

  private onYouTubeMessage(event: MessageEvent): void {
    if (!YOUTUBE_PLAYER_ORIGINS.has(event.origin) || event.source !== this.iframeEl?.contentWindow) {
      return;
    }

    let payload: YouTubeMessagePayload;
    try {
      payload = typeof event.data === "string"
        ? JSON.parse(event.data) as YouTubeMessagePayload
        : event.data as YouTubeMessagePayload;
    } catch {
      return;
    }

    if (!payload || typeof payload !== "object") {
      return;
    }
    if (payload.id !== undefined && String(payload.id) !== this.iframeEl?.id) {
      return;
    }

    if (payload.event === "onReady") {
      this.onPlayerReady();
      return;
    }

    if (payload.event === "onStateChange") {
      const state = this.readFiniteNumber(payload.info) ?? this.readFiniteNumber(payload.data);
      if (state !== null) {
        this.onPlayerStateChange(state);
      }
      return;
    }

    if (payload.event === "onPlaybackRateChange") {
      const rate = this.readFiniteNumber(payload.info) ?? this.readFiniteNumber(payload.data);
      if (rate !== null) {
        this.confirmPlaybackRate(rate);
      }
      return;
    }

    if (payload.event === "onError") {
      const code = this.readFiniteNumber(payload.info) ?? this.readFiniteNumber(payload.data);
      this.showRuntimeError(code === null ? "视频无法播放，YouTube 未返回具体错误代码。" : playerErrorMessage(code));
      return;
    }

    if (payload.event === "infoDelivery" && payload.info && typeof payload.info === "object") {
      this.applyInfoDelivery(payload.info);
    }
  }

  private applyInfoDelivery(info: object): void {
    if (
      "currentTime" in info &&
      typeof info.currentTime === "number" &&
      Number.isFinite(info.currentTime)
    ) {
      this.currentTime = Math.max(0, info.currentTime);
      this.lastTimeUpdateAt = Date.now();
    }
    if (
      "duration" in info &&
      typeof info.duration === "number" &&
      Number.isFinite(info.duration)
    ) {
      this.duration = Math.max(0, info.duration);
    }
    if (
      "playbackRate" in info &&
      typeof info.playbackRate === "number" &&
      Number.isFinite(info.playbackRate)
    ) {
      this.confirmPlaybackRate(info.playbackRate);
    }
    if (
      "playerState" in info &&
      typeof info.playerState === "number" &&
      Number.isFinite(info.playerState)
    ) {
      this.onPlayerStateChange(info.playerState);
    }
  }

  private readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private onPlayerStateChange(state: number): void {
    this.currentTime = this.getEstimatedCurrentTime();
    this.lastTimeUpdateAt = Date.now();
    this.playerState = state;

    const playbackConfirmed = isPlaybackStateConfirmed(
      this.pendingPlaybackState,
      state,
      PLAYER_STATE_PLAYING,
      PLAYER_STATE_PAUSED
    );
    if (playbackConfirmed) {
      this.clearPendingPlaybackCommand();
    }
    if (this.playPauseButton && this.pendingPlaybackState === null) {
      this.setPlayPauseVisual(state === PLAYER_STATE_PLAYING ? "pause" : "play");
    }
    if (state === PLAYER_STATE_PLAYING) {
      // 使用播放器原生控件重新播放时，也恢复到当前播放句；暂停期间始终保持阅读位置。
      if (!this.transcriptAutoFollowEnabled) {
        this.resumeTranscriptAutoFollow(true);
      } else {
        this.updateActiveSegment();
      }
    } else {
      this.cancelTranscriptAutoFollowResume();
    }
  }

  private beginPlaybackCommand(targetState: number): void {
    if (this.pendingPlaybackState !== null) {
      return;
    }
    // 先保存命令发出时的准确时间，再冻结本地估算，直到播放器回传确认。
    this.currentTime = this.getEstimatedCurrentTime();
    this.lastTimeUpdateAt = Date.now();
    this.pendingPlaybackPreviousState = this.playerState;
    this.pendingPlaybackState = targetState;
    if (this.playPauseButton) {
      this.playPauseButton.disabled = true;
      this.setPlayPauseVisual(
        "loading",
        targetState === PLAYER_STATE_PLAYING ? "正在播放" : "正在暂停"
      );
    }
    if (this.playerCommandTimer !== null) {
      window.clearTimeout(this.playerCommandTimer);
    }
    this.playerCommandTimer = window.setTimeout(() => {
      this.playerCommandTimer = null;
      if (this.destroyed || this.pendingPlaybackState === null) {
        return;
      }
      this.playerState = this.pendingPlaybackPreviousState;
      this.lastTimeUpdateAt = Date.now();
      this.pendingPlaybackState = null;
      if (this.playPauseButton) {
        this.playPauseButton.disabled = false;
        this.setPlayPauseVisual(this.playerState === PLAYER_STATE_PLAYING ? "pause" : "play");
      }
      const segmentCount = this.transcript?.segments.length ?? 0;
      this.setStatusText(`播放器已就绪 · ${segmentCount} 条英文字幕`, false);
    }, PLAYER_COMMAND_TIMEOUT_MS);
  }

  private clearPendingPlaybackCommand(): void {
    if (this.playerCommandTimer !== null) {
      window.clearTimeout(this.playerCommandTimer);
      this.playerCommandTimer = null;
    }
    this.pendingPlaybackState = null;
    if (this.playPauseButton && this.controlsActivated) {
      this.playPauseButton.disabled = false;
    }
  }

  private confirmPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    if (
      this.pendingPlaybackRate !== null &&
      Math.abs(rate - this.pendingPlaybackRate) >= 0.01
    ) {
      // infoDelivery 可能先回传旧倍速；保留等待状态直到目标倍速真正生效。
      this.updateSpeedControl(rate);
      return;
    }
    this.pendingPlaybackRate = null;
    if (this.rateCommandTimer !== null) {
      window.clearTimeout(this.rateCommandTimer);
      this.rateCommandTimer = null;
    }
    if (this.speedSliderEl) {
      this.speedSliderEl.disabled = !this.controlsActivated;
    }
    this.speedGroupEl?.classList.remove("is-pending");
    this.updateSpeedControl(rate);
  }

  private clearPlayerCommandTimers(): void {
    if (this.playerCommandTimer !== null) {
      window.clearTimeout(this.playerCommandTimer);
      this.playerCommandTimer = null;
    }
    if (this.rateCommandTimer !== null) {
      window.clearTimeout(this.rateCommandTimer);
      this.rateCommandTimer = null;
    }
    this.pendingPlaybackState = null;
    this.pendingPlaybackRate = null;
    this.speedSliderPreviewRate = null;
  }

  private postPlayerMessage(message: Record<string, unknown>): void {
    const iframe = this.iframeEl;
    if (!iframe?.contentWindow) {
      return;
    }

    const targetOrigin = this.playerMessageTargetOrigin;
    if (!targetOrigin) {
      return;
    }

    iframe.contentWindow.postMessage(
      JSON.stringify({ ...message, id: iframe.id }),
      targetOrigin
    );
  }

  private sendCommand(func: string, args: unknown[] = []): void {
    this.postPlayerMessage({ event: "command", func, args });
  }

  private togglePlayback(): void {
    this.clearVocabularyNavigationTarget();
    if (this.localVideoEl) {
      if (this.localVideoEl.paused) {
        this.resumeTranscriptAutoFollow(true);
        const generation = this.localSeekGeneration;
        void this.localVideoEl.play().catch(() => {
          if (!this.destroyed && generation === this.localSeekGeneration) {
            this.setStatusText("本地缓存视频无法开始播放，请检查文件权限后重试。", false);
          }
        });
      } else {
        this.cancelTranscriptAutoFollowResume();
        this.localVideoEl.pause();
      }
      return;
    }
    if (!this.iframeEl || this.pendingPlaybackState !== null) {
      return;
    }

    if (this.playerState === PLAYER_STATE_PLAYING) {
      this.cancelTranscriptAutoFollowResume();
      this.beginPlaybackCommand(PLAYER_STATE_PAUSED);
      this.sendCommand("pauseVideo");
    } else {
      this.resumeTranscriptAutoFollow(true);
      this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
      this.sendCommand("playVideo");
    }
  }

  private seekBy(deltaSeconds: number): void {
    this.clearVocabularyNavigationTarget();
    this.resumeTranscriptAutoFollow(true);
    if (this.localVideoEl) {
      const requested = Math.max(0, this.getEstimatedCurrentTime() + deltaSeconds);
      const target = this.duration > 0 ? Math.min(this.duration, requested) : requested;
      void this.seekLocalVideoTo(target, false);
      return;
    }
    if (!this.iframeEl || this.pendingPlaybackState !== null) {
      return;
    }

    const requested = Math.max(0, this.getEstimatedCurrentTime() + deltaSeconds);
    const target = this.duration > 0 ? Math.min(this.duration, requested) : requested;
    this.setCurrentTime(target);
    this.sendCommand("seekTo", [target, true]);
    this.updateActiveSegment();
  }

  private jumpTo(seconds: number): void {
    this.clearVocabularyNavigationTarget();
    this.resumeTranscriptAutoFollow(true);
    if (this.localVideoEl) {
      void this.seekLocalVideoTo(seconds, true);
      return;
    }
    if (!this.iframeEl) {
      return;
    }

    if (this.plugin.capabilities.mobile) {
      const nextSrc = buildMobileYouTubeStartUrl(this.iframeEl.src, seconds);
      if (!nextSrc) {
        this.setStatusText("移动端时间戳跳转失败，请使用打开原视频按钮。", false);
        return;
      }
      this.setCurrentTime(seconds);
      this.updateActiveSegment();
      this.iframeEl.src = nextSrc;
      this.setStatusText(
        `已跳转到 ${formatTimestamp(seconds)} · 正在尝试继续播放`,
        false
      );
      return;
    }

    this.setCurrentTime(seconds);
    this.updateActiveSegment();
    this.beginPlaybackCommand(PLAYER_STATE_PLAYING);
    this.sendCommand("seekTo", [seconds, true]);
    this.sendCommand("playVideo");
  }

  private async seekLocalVideoTo(seconds: number, play: boolean): Promise<void> {
    const video = this.localVideoEl;
    if (!video) {
      return;
    }
    const generation = this.localSeekGeneration + 1;
    this.localSeekGeneration = generation;
    const target = Math.max(0, this.duration > 0 ? Math.min(this.duration, seconds) : seconds);
    let targetIndex = 0;
    for (let index = 0; index < this.cachedVideoOffsets.length; index += 1) {
      const offset = this.cachedVideoOffsets[index] ?? 0;
      const duration = this.cachedVideoDurations[index] ?? 0;
      if (target >= offset && (duration <= 0 || target < offset + duration)) {
        targetIndex = index;
        break;
      }
      if (target >= offset) {
        targetIndex = index;
      }
    }
    const localTime = Math.max(0, target - (this.cachedVideoOffsets[targetIndex] ?? 0));
    if (targetIndex !== this.cachedVideoIndex) {
      const nextUrl = this.cachedVideoUrls[targetIndex];
      if (!nextUrl) {
        return;
      }
      this.cachedVideoIndex = targetIndex;
      video.src = nextUrl;
      video.load();
      try {
        await waitForMediaMetadata(video, LOCAL_MEDIA_LOAD_TIMEOUT_MS, {
          schedule: (callback, timeoutMs) => window.setTimeout(callback, timeoutMs),
          cancel: (handle) => window.clearTimeout(handle as number)
        });
      } catch (error) {
        if (!this.destroyed && generation === this.localSeekGeneration) {
          this.setStatusText(
            error instanceof Error ? error.message : "本地缓存分段加载失败。",
            false
          );
        }
        return;
      }
      if (this.destroyed || generation !== this.localSeekGeneration) {
        return;
      }
    }
    video.currentTime = localTime;
    video.playbackRate = this.playbackRate;
    this.setCurrentTime(target);
    this.updateActiveSegment();
    if (play) {
      try {
        await video.play();
      } catch {
        if (!this.destroyed && generation === this.localSeekGeneration) {
          this.setStatusText("本地缓存视频无法开始播放，请检查文件权限后重试。", false);
        }
      }
    }
  }

  private setPlaybackRate(rate: number): void {
    if (this.localVideoEl) {
      this.localVideoEl.playbackRate = rate;
      this.playbackRate = rate;
      this.updateSpeedControl(rate);
      return;
    }
    if (!this.iframeEl || this.pendingPlaybackRate !== null) {
      this.speedSliderPreviewRate = null;
      this.updateSpeedControl(this.playbackRate);
      return;
    }

    this.pendingPlaybackRate = rate;
    if (this.speedSliderEl) {
      this.speedSliderEl.disabled = true;
    }
    this.speedGroupEl?.classList.add("is-pending");
    this.updateSpeedControl(this.playbackRate);
    this.sendCommand("setPlaybackRate", [rate]);
    this.rateCommandTimer = window.setTimeout(() => {
      this.rateCommandTimer = null;
      if (this.destroyed || this.pendingPlaybackRate === null) {
        return;
      }
      this.pendingPlaybackRate = null;
      if (this.speedSliderEl) {
        this.speedSliderEl.disabled = !this.controlsActivated;
      }
      this.speedGroupEl?.classList.remove("is-pending");
      this.updateSpeedControl(this.playbackRate);
      this.setStatusText("播放器未确认倍速设置，请重试。", false);
    }, PLAYER_COMMAND_TIMEOUT_MS);
  }

  private getEstimatedCurrentTime(): number {
    if (!shouldAdvancePlaybackClock(
      this.playerState,
      this.pendingPlaybackState,
      PLAYER_STATE_PLAYING
    )) {
      return this.currentTime;
    }

    const elapsed = (Date.now() - this.lastTimeUpdateAt) / 1_000;
    const estimated = this.currentTime + elapsed * this.playbackRate;
    return this.duration > 0 ? Math.min(this.duration, estimated) : estimated;
  }

  private setCurrentTime(seconds: number): void {
    this.currentTime = Math.max(0, seconds);
    this.lastTimeUpdateAt = Date.now();
  }

  private clearTimer(kind: "poll" | "handshake" | "fallback"): void {
    if (kind === "poll" && this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (kind === "handshake" && this.handshakeTimer !== null) {
      window.clearInterval(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (kind === "fallback" && this.controlsFallbackTimer !== null) {
      window.clearTimeout(this.controlsFallbackTimer);
      this.controlsFallbackTimer = null;
    }
  }

  private updateSpeedControl(currentRate: number): void {
    const displayedRate = this.speedSliderPreviewRate
      ?? this.pendingPlaybackRate
      ?? currentRate;
    const displayedIndex = PLAYBACK_RATES.reduce((closestIndex, rate, index) => {
      return Math.abs(rate - displayedRate)
        < Math.abs(PLAYBACK_RATES[closestIndex] - displayedRate)
        ? index
        : closestIndex;
    }, 0);
    const normalizedRate = PLAYBACK_RATES[displayedIndex];
    if (this.speedSliderEl) {
      this.speedSliderEl.value = String(displayedIndex);
      this.speedSliderEl.setAttribute("aria-valuetext", `${normalizedRate} 倍速`);
    }
    this.speedLabelEls.forEach((label, index) => {
      label.classList.toggle("is-active", index === displayedIndex);
    });
    this.speedGroupEl?.setCssProps({
      "--evs-speed-offset": `${displayedIndex * 100}%`
    });
  }

  private updateActiveSegment(): void {
    const segments = this.transcript?.segments;
    if (!segments) {
      return;
    }
    if (this.stopDictationPlaybackAtBoundary() || this.stopShadowingPlaybackAtBoundary()) {
      return;
    }

    const currentTime = this.getEstimatedCurrentTime();
    const nextIndex = segments.findIndex(
      (segment) => currentTime >= segment.start && currentTime < segment.end
    );

    if (nextIndex === this.activeSegmentIndex) {
      return;
    }

    if (this.activeSegmentIndex >= 0) {
      const previousRow = this.segmentRows[this.activeSegmentIndex];
      previousRow?.classList.remove("is-active");
      previousRow?.removeAttribute("aria-current");
    }

    this.activeSegmentIndex = nextIndex;
    if (nextIndex >= 0) {
      const activeRow = this.segmentRows[nextIndex];
      activeRow?.classList.add("is-active");
      activeRow?.setAttribute("aria-current", "true");
      if (!this.segmentActionTargetPinned) {
        this.selectSegmentForActions(nextIndex, false);
      }
      if (
        this.playerState === PLAYER_STATE_PLAYING &&
        this.vocabularyNavigationIndex === null &&
        this.transcriptAutoFollowEnabled
      ) {
        this.centerActiveSegment();
      }
    }
  }

  private centerActiveSegment(): void {
    this.centerSegment(this.activeSegmentIndex);
  }

  private centerSegment(index: number): void {
    const list = this.transcriptListEl;
    const row = this.segmentRows[index];
    if (!list || !row || this.destroyed) {
      return;
    }
    this.updateTranscriptEndSpacer();
    if (list.scrollHeight <= list.clientHeight + 1) {
      this.alignSegmentInViewport(index);
      return;
    }
    const target = calculateAlignedScrollTop(
      this.segmentRows.map((segmentRow) => ({
        top: segmentRow.offsetTop,
        height: segmentRow.offsetHeight
      })),
      index,
      list.clientHeight
    );
    this.markTranscriptProgrammaticScroll();
    list.scrollTo({ top: target, behavior: "auto" });
    this.alignSegmentInViewport(index);
  }

  /** 用户主动浏览其他字幕后暂停自动跟随，避免播放进度把页面强制拉回。 */
  private suspendTranscriptAutoFollow(force: boolean): void {
    if (
      !force &&
      Date.now() <= this.transcriptProgrammaticScrollUntil
    ) {
      return;
    }
    this.transcriptAutoFollowEnabled = false;
    this.transcriptViewportNeedsCenter = false;
    this.cancelTranscriptAutoFollowResume();
    // 暂停时保留用户正在阅读的位置，不启动五秒恢复计时器。
    if (!this.isPlaybackActivelyPlaying()) {
      return;
    }
    this.transcriptAutoFollowResumeTimer = window.setTimeout(() => {
      this.transcriptAutoFollowResumeTimer = null;
      if (this.destroyed || !this.isPlaybackActivelyPlaying()) {
        return;
      }
      this.resumeTranscriptAutoFollow(true);
    }, TRANSCRIPT_AUTO_FOLLOW_RESUME_DELAY_MS);
  }

  private isPlaybackActivelyPlaying(): boolean {
    return shouldResumeTranscriptAutoFollow(
      this.playerState,
      this.pendingPlaybackState,
      PLAYER_STATE_PLAYING,
      this.localVideoEl ? this.localVideoEl.paused : null
    );
  }

  private cancelTranscriptAutoFollowResume(): void {
    if (this.transcriptAutoFollowResumeTimer !== null) {
      window.clearTimeout(this.transcriptAutoFollowResumeTimer);
      this.transcriptAutoFollowResumeTimer = null;
    }
  }

  /** 时间戳、前后跳转或重新播放属于明确定位操作，因此恢复自动跟随。 */
  private resumeTranscriptAutoFollow(recenter: boolean): void {
    this.cancelTranscriptAutoFollowResume();
    this.transcriptAutoFollowEnabled = true;
    this.segmentActionTargetPinned = false;
    if (this.activeSegmentIndex >= 0) {
      this.selectSegmentForActions(this.activeSegmentIndex, false);
    }
    if (recenter && this.activeSegmentIndex >= 0) {
      this.scheduleTranscriptLayout(true);
    }
  }

  private markTranscriptProgrammaticScroll(): void {
    // 平滑滚动会连续产生 scroll 事件，在动画结束前都不能当成用户手动翻页。
    this.transcriptProgrammaticScrollUntil = Date.now() + TRANSCRIPT_SMOOTH_SCROLL_GUARD_MS;
  }

  private setupTranscriptViewportSizing(): void {
    const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
    this.transcriptViewportWindow = viewWindow;
    this.transcriptViewportHandler = () => this.scheduleTranscriptLayout(true);
    viewWindow.addEventListener("resize", this.transcriptViewportHandler);
    this.transcriptResizeObserver?.disconnect();
    this.transcriptResizeObserver = new ResizeObserver(() => {
      // 拖动期间只更新右侧操作栏与底部空间，松手后再完成一次自动对齐。
      this.scheduleTranscriptLayout(!this.playerDockEl?.classList.contains("is-resizing"));
    });
    if (this.transcriptListEl) {
      this.transcriptResizeObserver.observe(this.transcriptListEl);
    }
    if (this.playerDockEl) {
      this.transcriptResizeObserver.observe(this.playerDockEl);
    }
    this.segmentRows.forEach((segmentRow) => this.transcriptResizeObserver?.observe(segmentRow));
    this.scheduleTranscriptLayout(false);
  }

  private scheduleTranscriptLayout(recenter: boolean): void {
    if (this.destroyed) {
      return;
    }
    this.transcriptViewportNeedsCenter ||= recenter;
    if (this.transcriptViewportFrame !== null) {
      return;
    }
    const viewWindow = this.containerEl.ownerDocument.defaultView ?? window;
    this.transcriptViewportFrame = viewWindow.requestAnimationFrame(() => {
      this.transcriptViewportFrame = null;
      if (this.destroyed) {
        return;
      }
      const shouldCenter = this.transcriptViewportNeedsCenter;
      this.transcriptViewportNeedsCenter = false;
      this.updateSegmentActionDockInset();
      this.updateTranscriptEndSpacer();
      if (shouldCenter && this.vocabularyNavigationIndex !== null) {
        this.centerSegment(this.vocabularyNavigationIndex);
      } else if (
        shouldCenter &&
        this.activeSegmentIndex >= 0 &&
        this.transcriptAutoFollowEnabled
      ) {
        this.centerActiveSegment();
      }
    });
  }

  /** 悬浮播放器开启时，让右侧字幕操作栏始终从播放器下方开始吸顶。 */
  private updateSegmentActionDockInset(): void {
    const actionDock = this.segmentActionDockEl;
    const playerDock = this.playerDockEl;
    if (!actionDock) {
      return;
    }
    if (!playerDock?.classList.contains("is-floating")) {
      actionDock.style.removeProperty("--evs-segment-action-top");
      return;
    }
    const playerHeight = Math.ceil(playerDock.getBoundingClientRect().height);
    actionDock.style.setProperty("--evs-segment-action-top", `${playerHeight + 16}px`);
  }

  private updateTranscriptEndSpacer(): void {
    const spacer = this.transcriptEndSpacerEl;
    const lastRow = this.segmentRows.at(-1);
    const viewport = this.fullWidthScrollEl ?? this.viewViewportEl;
    if (!spacer || !lastRow || !viewport) {
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const dockBottom = this.playerDockEl?.classList.contains("is-floating")
      ? this.playerDockEl.getBoundingClientRect().bottom
      : viewportRect.top;
    const visibleTop = Math.max(viewportRect.top + 8, dockBottom + 8);
    const visibleHeight = Math.max(0, viewportRect.bottom - 8 - visibleTop);
    const height = `${calculateTranscriptEndSpacer(
      lastRow.offsetHeight,
      visibleHeight
    )}px`;
    if (spacer.style.height !== height) {
      spacer.style.height = height;
    }
  }

  /** 只滚动刚好足够的距离，让当前句完整回到真正的滚动视口。 */
  private alignSegmentInViewport(index: number): void {
    const row = this.segmentRows[index];
    // 实时编辑模式中 .markdown-source-view 只是外壳，真正滚动的是 .cm-scroller。
    // 优先使用创建页面时已识别的滚动容器，避免高亮句变化但画面不动。
    const viewport = this.fullWidthScrollEl ?? this.viewViewportEl;
    if (!row || !viewport) {
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const dockBottom = this.playerDockEl?.classList.contains("is-floating")
      ? this.playerDockEl.getBoundingClientRect().bottom
      : viewportRect.top;
    const visibleTop = Math.max(viewportRect.top + 8, dockBottom + 8);
    const visibleBottom = viewportRect.bottom - 8;
    const delta = calculateViewportAlignedScrollDelta(
      rowRect.top,
      rowRect.height,
      visibleTop,
      visibleBottom
    );
    if (Math.abs(delta) >= 1) {
      this.markTranscriptProgrammaticScroll();
      viewport.scrollBy({ top: delta, behavior: "smooth" });
    }
  }

  private showRuntimeError(message: string): void {
    this.clearPlayerCommandTimers();
    this.updateSpeedControl(this.playbackRate);
    this.playerState = PLAYER_STATE_PAUSED;
    this.setPlayPauseVisual("play");
    this.clearTimer("poll");
    this.controlButtons.forEach((button) => (button.disabled = true));
    this.timestampButtons.forEach((button) => (button.disabled = true));
    if (this.speedSliderEl) {
      this.speedSliderEl.disabled = true;
    }

    if (this.activeSegmentIndex >= 0) {
      const activeRow = this.segmentRows[this.activeSegmentIndex];
      activeRow?.classList.remove("is-active");
      activeRow?.removeAttribute("aria-current");
      this.activeSegmentIndex = -1;
    }

    if (this.runtimeErrorEl) {
      this.runtimeErrorEl.setText(message);
      this.runtimeErrorEl.show();
    }
    this.setStatusText("播放器未能正常工作", false);
    this.scheduleTranscriptLayout(true);
  }

  private renderFatalError(message: string): void {
    this.fullWidthObserver?.disconnect();
    this.fullWidthObserver = null;
    this.restoreContainerLayout();
    this.containerEl.empty();
    const error = this.containerEl.createDiv({ cls: "evs-fatal-error" });
    error.setAttribute("role", "alert");
    error.createEl("strong", { text: "无法加载插件" });
    error.createDiv({ text: message });
  }

  setLookupHighlight(element: HTMLElement): void {
    this.lookupHighlightEl?.removeClass("is-dictionary-active");
    this.lookupHighlightEl = element;
    element.addClass("is-dictionary-active");
  }

  clearLookupHighlight(): void {
    this.lookupHighlightEl?.removeClass("is-dictionary-active");
    this.lookupHighlightEl = null;
  }

  matchesVocabularyContext(context: VocabularyContext): boolean {
    return (
      !this.destroyed &&
      normalizePath(this.sourcePath) === normalizePath(context.sourcePath) &&
      normalizePath(this.transcriptPath) === normalizePath(context.transcriptPath) &&
      this.transcript?.videoId === context.videoId
    );
  }

  isVisibleVocabularyContextTarget(
    context: VocabularyContext,
    targetLeaf: WorkspaceLeaf
  ): boolean {
    return (
      this.matchesVocabularyContext(context) &&
      this.containerEl.isConnected &&
      targetLeaf.view.containerEl.contains(this.containerEl) &&
      this.containerEl.getClientRects().length > 0
    );
  }

  private getVocabularyContextIndex(context: VocabularyContext): number {
    if (!this.matchesVocabularyContext(context) || !this.transcript) {
      throw new Error("当前页面中找不到这条生词对应的播放器。");
    }
    const index = this.transcript.segments.findIndex((segment) =>
      segment.start === context.start && segment.end === context.end
    );
    if (index < 0) {
      throw new Error("字幕时间轴已经变化，无法定位到原来的句子。");
    }
    return index;
  }

  private clearVocabularyNavigationTarget(): void {
    this.vocabularyTargetRowEl?.classList.remove("is-vocabulary-target");
    this.vocabularyTargetRowEl = null;
    this.vocabularyNavigationIndex = null;
  }

  private async focusVocabularyContext(context: VocabularyContext): Promise<void> {
    const index = this.getVocabularyContextIndex(context);
    const row = this.segmentRows[index];
    if (!row) {
      throw new Error("目标字幕尚未渲染完成，请重新点击一次。");
    }
    this.clearVocabularyNavigationTarget();
    this.vocabularyTargetRowEl = row;
    this.vocabularyNavigationIndex = index;
    row.classList.add("is-vocabulary-target");

    // 新打开的阅读视图还会继续计算标题、播放器和字幕高度；等待两帧后再定位，
    // 避免第一次 scrollIntoView 被 Obsidian 的布局恢复覆盖。
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (this.destroyed || this.vocabularyTargetRowEl !== row) {
      return;
    }
    this.markTranscriptProgrammaticScroll();
    row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    this.centerSegment(index);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (this.destroyed || this.vocabularyTargetRowEl !== row) {
      return;
    }
    this.alignSegmentInViewport(index);
    this.timestampButtons[index]?.focus({ preventScroll: true });
  }

  async navigateToVocabularyContext(context: VocabularyContext): Promise<void> {
    await this.focusVocabularyContext(context);
  }
}

export default class LinguaStudyPlugin extends Plugin {
  settings: LinguaStudySettings = { ...DEFAULT_SETTINGS };
  readonly capabilities: PlatformCapabilities = getPlatformCapabilities();
  private translationService: TranslationService | null = null;
  private translationCacheStore: TranslationCacheStore | null = null;
  private studyCacheStore: StudyCacheStore | null = null;
  private vocabularyStore: VocabularyStore | null = null;
  private readonly offlineDictionary = new OfflineDictionary();
  private fullDictionaryService: FullDictionaryService | null = null;
  private customDictionaryService: CustomDictionaryService | null = null;
  private readonly studyProfileListeners = new Set<(profile: StudyProfile) => void>();
  private readonly vocabularyListeners = new Set<() => void>();
  private readonly studyRenderers = new Set<LinguaStudyRenderChild>();
  private readonly studyRendererReadyOrder = new WeakMap<LinguaStudyRenderChild, number>();
  private studyRendererReadyCounter = 0;
  private activeDictionaryHighlightOwner: LinguaStudyRenderChild | null = null;
  private pendingVocabularyJump: {
    id: number;
    context: VocabularyContext;
    targetLeaf: WorkspaceLeaf;
    timeout: number;
  } | null = null;
  private vocabularyJumpId = 0;
  private dictionaryUtterance: SpeechSynthesisUtterance | null = null;
  private dictionaryTabPlacementPrepared = false;
  private youtubeImporter: YouTubeImportController | null = null;
  private bilibiliImporter: BilibiliImportController | null = null;
  private bilibiliCacheService: BilibiliCacheService | null = null;
  private bilibiliSessionService: BilibiliSessionService | null = null;
  private localWhisperService: LocalWhisperService | null = null;
  private readonly transcriptWriteQueue = new AsyncKeyedQueue();
  private manualImportInProgress = false;
  private manualImportRibbonEl: HTMLElement | null = null;
  private studyBlockRevealFrame: number | null = null;
  private studyBlockRevealObserver: MutationObserver | null = null;
  private studyBlockRevealEventCleanup: (() => void) | null = null;
  private studyBlockRevealGeneration = 0;
  private readonly transcriptFingerprintCache = new VersionedAsyncCache<TranscriptFingerprintData>(8);
  private updateCheckPromise: Promise<PluginUpdateInfo | null> | null = null;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    await this.saveData(this.settings);
    this.applyInterfaceTheme();
    this.translationService = new TranslationService(this.app, () => this.settings);
    this.translationCacheStore = new TranslationCacheStore(this.app);
    this.studyCacheStore = new StudyCacheStore(this.app);
    this.vocabularyStore = new VocabularyStore(this.app);
    let ytDlpFetcher: YtDlpTranscriptFetcher | null = null;
    if (this.capabilities.desktop) {
      const [
        { FullDictionaryService },
        { CustomDictionaryService },
        { BilibiliCacheService },
        { LocalWhisperService },
        { removeLegacyWhisperCachesOnce },
        { fetchTranscriptWithYtDlp }
      ] = await Promise.all([
        import("./full-dictionary"),
        import("./custom-dictionary"),
        import("./bilibili-cache"),
        import("./local-whisper"),
        import("./legacy-whisper-cleanup"),
        import("./yt-dlp")
      ]);
      this.fullDictionaryService = new FullDictionaryService();
      this.customDictionaryService = new CustomDictionaryService();
      await Promise.all([
        this.fullDictionaryService.initialize(),
        this.customDictionaryService.initialize()
      ]);
      this.syncDictionaryShardLoaders();
      this.bilibiliCacheService = new BilibiliCacheService();
      this.localWhisperService = new LocalWhisperService(this.bilibiliCacheService);
      ytDlpFetcher = fetchTranscriptWithYtDlp;
      try {
        await removeLegacyWhisperCachesOnce();
      } catch {
        new Notice("旧版本地语音识别缓存清理失败，下次启动会继续尝试；不影响插件使用。", 8_000);
      }
    }
    this.registerView(
      DICTIONARY_VIEW_TYPE,
      (leaf) => new LinguaDictionaryView(leaf, this)
    );
    this.youtubeImporter = new YouTubeImportController(
      this.app,
      () => this.settings,
      ytDlpFetcher
    );
    this.bilibiliSessionService = new BilibiliSessionService();
    this.bilibiliImporter = new BilibiliImportController(
      this.app,
      this.bilibiliCacheService,
      this.bilibiliSessionService,
      () => this.settings,
      this.localWhisperService,
      this.capabilities.bilibiliLogin,
      (transcriptPath, videoId, segments, chinese, sourceLabel) =>
        this.saveImportedDocumentTranslations(
          transcriptPath,
          videoId,
          segments,
          chinese,
          sourceLabel
        )
    );
    addIcon(LINGUA_STUDY_RIBBON_ICON_ID, LINGUA_STUDY_RIBBON_ICON_SVG);
    this.manualImportRibbonEl = this.addRibbonIcon(
      LINGUA_STUDY_RIBBON_ICON_ID,
      "Lingua Study",
      () => {
        void this.importVideoFromActiveNote();
      }
    );
    this.manualImportRibbonEl.addClass("lingua-study-ribbon-action");
    this.manualImportRibbonEl.setCssProps({
      "--lingua-study-logo-mask": `url("${ribbonLogoMaskUrl}")`
    });
    this.manualImportRibbonEl.setAttribute("aria-label", "Lingua Study");
    this.addSettingTab(new LinguaStudySettingTab(this.app, this));

    this.addCommand({
      id: "open-offline-dictionary",
      name: "打开离线词典",
      callback: () => {
        void this.openDictionaryLookup({
          word: "",
          sentence: null,
          sourcePath: null,
          transcriptPath: null,
          videoId: null,
          segmentIndex: null,
          start: null,
          end: null
        });
      }
    });

    this.addCommand({
      id: "open-vocabulary-book",
      name: "打开生词本",
      callback: () => {
        void this.openDictionarySection("book");
      }
    });

    this.addCommand({
      id: "start-vocabulary-review",
      name: "开始今日生词复习",
      callback: () => {
        void this.openDictionarySection("review");
      }
    });

    this.addCommand({
      id: "import-video-from-current-note",
      name: "处理当前笔记中的视频链接",
      checkCallback: (checking) => {
        const available = this.app.workspace.getActiveViewOfType(MarkdownView) !== null;
        if (!checking && available) {
          void this.importVideoFromActiveNote();
        }
        return available;
      }
    });

    this.addCommand({
      id: "import-youtube-study",
      name: "从 YouTube 链接创建学习内容",
      editorCheckCallback: (checking, editor, context) => {
        if (!(context instanceof MarkdownView)) {
          return false;
        }
        if (!checking) {
          void this.getYouTubeImporter().importFromEditor(editor, context);
        }
        return true;
      }
    });

    this.addCommand({
      id: "import-bilibili-player",
      name: "从哔哩哔哩链接创建学习内容",
      editorCheckCallback: (checking, editor, context) => {
        if (!(context instanceof MarkdownView)) {
          return false;
        }
        if (!checking) {
          void this.getBilibiliImporter().importFromEditor(editor, context);
        }
        return true;
      }
    });

    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor, info) => {
      if (
        event.defaultPrevented ||
        !this.settings.autoImportPastedVideoLinks ||
        !(info instanceof MarkdownView)
      ) {
        return;
      }
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      const parsed = parseStandalonePastedVideoLink(pasted);
      if (!parsed) {
        return;
      }

      // 这类粘贴只有一个纯文本链接；由插件写入可避免默认粘贴与异步导入之间的时序竞争。
      event.preventDefault();
      editor.replaceSelection(pasted);
      window.setTimeout(() => {
        if (parsed.platform === "youtube") {
          void this.getYouTubeImporter().importLink(editor, info, parsed.link);
        } else {
          void this.getBilibiliImporter().importLink(editor, info, parsed.link);
        }
      }, 0);
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.scheduleStudyBlockReveal(file);
    }));

    const renderStudyBlock = (
      source: string,
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext
    ): void => {
      ctx.addChild(new LinguaStudyRenderChild(el, this, source, ctx.sourcePath));
    };

    this.registerMarkdownCodeBlockProcessor("lingua-study", renderStudyBlock);
    // 兼容 v0.1/v0.2 期间已经创建的旧笔记，避免用户必须立即批量修改。
    this.registerMarkdownCodeBlockProcessor(
      "english-video-study",
      renderStudyBlock
    );
    // 插件重新加载时不会再次触发 file-open；主动处理当前笔记，避免源码状态被保留。
    this.scheduleStudyBlockReveal(this.app.workspace.getActiveFile());
  }

  onunload(): void {
    const cacheService = this.bilibiliCacheService;
    const bilibiliSession = this.bilibiliSessionService;
    this.localWhisperService?.close();
    disposeDocumentParserRuntime();
    this.localWhisperService = null;
    this.fullDictionaryService = null;
    this.customDictionaryService = null;
    this.bilibiliSessionService = null;
    this.bilibiliCacheService = null;
    this.bilibiliImporter = null;
    this.manualImportRibbonEl = null;
    this.manualImportInProgress = false;
    this.cancelStudyBlockReveal();
    this.transcriptFingerprintCache.clear();
    this.studyProfileListeners.clear();
    this.vocabularyListeners.clear();
    this.studyRenderers.clear();
    this.activeDictionaryHighlightOwner = null;
    if (this.pendingVocabularyJump) {
      window.clearTimeout(this.pendingVocabularyJump.timeout);
      this.pendingVocabularyJump = null;
    }
    if (this.dictionaryUtterance) {
      window.speechSynthesis.cancel();
      this.dictionaryUtterance = null;
    }
    bilibiliSession?.close();
    if (cacheService) {
      void cacheService.close();
    }
    this.getPluginDocumentBody().classList.remove("lingua-study-theme-paper");
  }

  private getPluginDocumentBody(): HTMLElement {
    return this.app.workspace.containerEl.ownerDocument.body;
  }

  private applyInterfaceTheme(): void {
    this.getPluginDocumentBody().classList.toggle(
      "lingua-study-theme-paper",
      this.settings.interfaceTheme === "paper"
    );
  }

  private scheduleStudyBlockReveal(file: TFile | null): void {
    this.cancelStudyBlockReveal();
    if (!file || file.extension !== "md") {
      return;
    }

    const generation = this.studyBlockRevealGeneration;
    let prepare: () => void;
    const requestReveal = (): void => {
      if (
        generation !== this.studyBlockRevealGeneration ||
        this.studyBlockRevealFrame !== null
      ) {
        return;
      }
      this.studyBlockRevealFrame = window.requestAnimationFrame(prepare);
    };

    const reveal = (): void => {
      if (generation !== this.studyBlockRevealGeneration) {
        return;
      }
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.file?.path !== file.path) {
        return;
      }
      if (view.getMode() !== "source") {
        this.cancelStudyBlockReveal();
        return;
      }

      const editor = view.editor;
      const lines = Array.from(
        { length: editor.lineCount() },
        (_, line) => editor.getLine(line)
      );
      if (!containsStudyBlock(lines)) {
        this.cancelStudyBlockReveal();
        return;
      }

      const rendered = Array.from(
        view.containerEl.querySelectorAll<HTMLElement>(".evs-root")
      ).some((root) => root.dataset.linguaStudySourcePath === file.path);
      if (rendered) {
        this.cancelStudyBlockReveal();
        return;
      }

      const recovery = getStudyBlockCursorRecovery(lines, editor.getCursor().line);
      if (!recovery) {
        return;
      }
      if (recovery.needsTrailingLine) {
        const closingText = lines[recovery.closingLine] ?? "";
        // 旧版生成的纯代码块笔记可能直接结束在 ```；补一个代码块外的安全行。
        editor.replaceRange("\n", {
          line: recovery.closingLine,
          ch: closingText.length
        });
      }
      editor.setCursor({ line: recovery.exitLine, ch: 0 });
      editor.blur();
      requestReveal();
    };

    prepare = (): void => {
      this.studyBlockRevealFrame = null;
      if (generation !== this.studyBlockRevealGeneration) {
        return;
      }
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.file?.path !== file.path) {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path !== file.path) {
          // file-open 也可能来自非当前页面的嵌入内容，不为它保留后台逐帧任务。
          this.cancelStudyBlockReveal();
          return;
        }
        // 当前文件已切换，但 MarkdownView 尚未就绪时逐帧重试。
        requestReveal();
        return;
      }
      if (view.getMode() !== "source") {
        this.cancelStudyBlockReveal();
        return;
      }

      if (!this.studyBlockRevealObserver) {
        const viewDocument = view.containerEl.ownerDocument;
        const MutationObserverConstructor = viewDocument.defaultView?.MutationObserver
          ?? MutationObserver;
        this.studyBlockRevealObserver = new MutationObserverConstructor(requestReveal);
        this.studyBlockRevealObserver.observe(view.containerEl, {
          childList: true,
          subtree: true
        });
        const handleEditorState = (): void => requestReveal();
        view.containerEl.addEventListener("focusin", handleEditorState, true);
        viewDocument.addEventListener("selectionchange", handleEditorState);
        this.studyBlockRevealEventCleanup = () => {
          view.containerEl.removeEventListener("focusin", handleEditorState, true);
          viewDocument.removeEventListener("selectionchange", handleEditorState);
        };
      }
      reveal();
    };

    requestReveal();
  }

  private cancelStudyBlockReveal(): void {
    this.studyBlockRevealGeneration += 1;
    if (this.studyBlockRevealFrame !== null) {
      window.cancelAnimationFrame(this.studyBlockRevealFrame);
      this.studyBlockRevealFrame = null;
    }
    this.studyBlockRevealObserver?.disconnect();
    this.studyBlockRevealObserver = null;
    this.studyBlockRevealEventCleanup?.();
    this.studyBlockRevealEventCleanup = null;
  }

  /**
   * 只在设置页请求 GitHub 最新正式 Release。一次插件会话只检查一次，
   * 失败时静默回退，不阻塞插件启动、设置或学习功能。
   */
  checkForAvailableUpdate(): Promise<PluginUpdateInfo | null> {
    if (!this.updateCheckPromise) {
      this.updateCheckPromise = requestUrl({
        url: LINGUA_STUDY_LATEST_MANIFEST_URL,
        method: "GET",
        headers: { Accept: "application/json" },
        throw: false
      }).then((response) => {
        if (response.status < 200 || response.status >= 300) {
          return null;
        }
        return getPluginUpdateInfo(this.manifest.version, response.json);
      }).catch(() => null);
    }
    return this.updateCheckPromise;
  }

  getTranscriptFingerprintData(
    file: TFile,
    transcript: TranscriptFile
  ): Promise<TranscriptFingerprintData> {
    const version = `${file.stat.mtime}:${file.stat.size}`;
    return this.transcriptFingerprintCache.getOrCreate(file.path, version, async () => {
      const [fingerprints, studyFingerprints] = await Promise.all([
        Promise.all(
          transcript.segments.map((segment) =>
            createSegmentFingerprint(segment.start, segment.end, segment.text)
          )
        ),
        Promise.all(
          transcript.segments.map((segment) => createStudyFingerprintMap(segment))
        )
      ]);
      return { fingerprints, studyFingerprints };
    });
  }

  async updateSettings(changes: Partial<LinguaStudySettings>): Promise<void> {
    const previousProfile = this.settings.studyProfile;
    const previousDailyNewWordLimit = this.settings.dailyNewWordLimit;
    const previousDesktopPlayerWidth = this.settings.desktopPlayerWidth;
    const previousInterfaceTheme = this.settings.interfaceTheme;
    this.settings = sanitizeSettings({ ...this.settings, ...changes });
    await this.saveData(this.settings);
    if (this.settings.interfaceTheme !== previousInterfaceTheme) {
      this.applyInterfaceTheme();
      for (const renderer of this.studyRenderers) {
        renderer.applyInterfaceTheme();
      }
    }
    if (this.settings.studyProfile !== previousProfile) {
      for (const listener of this.studyProfileListeners) {
        listener(this.settings.studyProfile);
      }
      for (const leaf of this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE)) {
        if (leaf.view instanceof LinguaDictionaryView) {
          leaf.view.refreshStudyProfile();
        }
      }
    }
    if (this.settings.dailyNewWordLimit !== previousDailyNewWordLimit) {
      this.notifyVocabularyChanged();
    }
    if (this.settings.desktopPlayerWidth !== previousDesktopPlayerWidth) {
      for (const renderer of this.studyRenderers) {
        renderer.applyDesktopPlayerWidth(this.settings.desktopPlayerWidth);
      }
    }
  }

  private async importVideoFromActiveNote(): Promise<void> {
    if (this.manualImportInProgress) {
      new Notice("当前视频正在创建学习内容，请稍候。", 4_000);
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || !view.editor) {
      new Notice("请先打开一篇 Markdown 笔记，再粘贴 B站或 YouTube 视频链接。", 6_000);
      return;
    }

    const editor = view.editor;
    const links = findSupportedVideoLinksByPriority(
      editor.getSelection(),
      editor.getLine(editor.getCursor().line),
      editor.getValue()
    );
    if (links.length === 0) {
      new Notice("当前笔记没有找到可处理的 B站或 YouTube 视频链接。请先粘贴链接，再点击左侧 Logo。", 7_000);
      return;
    }

    const selected = links.length === 1
      ? links[0] ?? null
      : await this.chooseManualVideoLink(links);
    if (!selected) {
      return;
    }

    this.setManualImportBusy(true);
    try {
      if (selected.platform === "youtube") {
        await this.getYouTubeImporter().importLink(editor, view, selected.link);
      } else {
        await this.getBilibiliImporter().importLink(editor, view, selected.link);
      }
    } finally {
      this.setManualImportBusy(false);
    }
  }

  private chooseManualVideoLink(links: PastedVideoLink[]): Promise<PastedVideoLink | null> {
    return new Promise((resolve) => {
      new ManualVideoLinkModal(this.app, links, resolve).open();
    });
  }

  private setManualImportBusy(busy: boolean): void {
    this.manualImportInProgress = busy;
    this.manualImportRibbonEl?.classList.toggle("is-busy", busy);
    if (busy) {
      this.manualImportRibbonEl?.setAttribute("aria-busy", "true");
    } else {
      this.manualImportRibbonEl?.removeAttribute("aria-busy");
    }
  }

  async testTranslationConnection(): Promise<string> {
    const result = await this.getTranslationService().translate(
      "Thank you for using Lingua Study."
    );
    return result.text;
  }

  async translateSentence(sourceText: string): Promise<TranslationResult> {
    return this.getTranslationService().translate(sourceText);
  }

  async analyzeSentence(
    sourceText: string,
    profile: StudyProfile
  ): Promise<StudyAnalysisResult> {
    return this.getTranslationService().analyzeSentence(
      sourceText,
      profile,
      this.collectDictionaryHints(sourceText)
    );
  }

  lookupDictionary(word: string): DictionaryLookupResult {
    return this.offlineDictionary.lookup(word);
  }

  getFullDictionaryStatus(): FullDictionaryStatus {
    return this.fullDictionaryService?.getStatus() ?? {
      installed: false,
      manifest: null,
      cacheFolder: ""
    };
  }

  getCustomDictionaryStatus(): CustomDictionaryStatus {
    return this.customDictionaryService?.getStatus() ?? {
      installed: false,
      manifest: null,
      cacheFolder: ""
    };
  }

  async installFullDictionary(
    onProgress: (message: string) => void
  ): Promise<FullDictionaryInstallResult> {
    const service = this.getFullDictionaryService();
    const result = await service.install(onProgress);
    this.syncDictionaryShardLoaders();
    this.refreshDictionaryViews();
    return result;
  }

  async clearFullDictionary(): Promise<void> {
    await this.getFullDictionaryService().clear();
    this.syncDictionaryShardLoaders();
    this.refreshDictionaryViews();
  }

  openFullDictionaryFolder(): Promise<void> {
    return this.getFullDictionaryService().openCacheFolder();
  }

  async installCustomDictionaryFromFile(
    fileName: string,
    data: Uint8Array,
    onProgress: (message: string) => void
  ): Promise<CustomDictionaryInstallResult> {
    const result = await this.getCustomDictionaryService().installFromFile(
      fileName,
      data,
      onProgress
    );
    this.syncDictionaryShardLoaders();
    this.refreshDictionaryViews();
    return result;
  }

  async clearCustomDictionary(): Promise<void> {
    await this.getCustomDictionaryService().clear();
    this.syncDictionaryShardLoaders();
    this.refreshDictionaryViews();
  }

  getDictionarySourceLabel(): string {
    const custom = this.customDictionaryService?.getStatus().manifest ?? null;
    const full = this.fullDictionaryService?.getStatus().manifest ?? null;
    const ecdict = full
      ? `ECDICT 完整版 · ${full.entryCount.toLocaleString()} 词条`
      : `ECDICT 精简版 · ${DICTIONARY_SOURCE.entryCount.toLocaleString()} 词条`;
    return custom
      ? `自定义词典 · ${custom.entryCount.toLocaleString()} 词条 + ${ecdict}`
      : ecdict;
  }

  private syncDictionaryShardLoaders(): void {
    const loaders = [];
    if (this.customDictionaryService?.getStatus().installed) {
      loaders.push((key: string) =>
        this.customDictionaryService?.readCompressedShard(key) ?? null
      );
    }
    if (this.fullDictionaryService?.getStatus().installed) {
      loaders.push((key: string) =>
        this.fullDictionaryService?.readCompressedShard(key) ?? null
      );
    }
    this.offlineDictionary.setExternalShardLoaders(loaders);
  }

  private refreshDictionaryViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE)) {
      if (leaf.view instanceof LinguaDictionaryView) {
        leaf.view.refreshDictionarySource();
      }
    }
  }

  async openDictionaryLookup(context: DictionaryLookupContext): Promise<void> {
    const view = await this.ensureDictionaryView();
    if (context.word !== "") {
      view.showLookup(context);
    }
  }

  async openDictionarySection(section: "book" | "review"): Promise<void> {
    const view = await this.ensureDictionaryView();
    if (section === "book") {
      view.openVocabularyBook();
    } else {
      view.openReview();
    }
  }

  private async ensureDictionaryView(): Promise<LinguaDictionaryView> {
    if (!this.dictionaryTabPlacementPrepared) {
      // 旧版把词典作为纵向分屏创建，会与聊天等侧栏视图瓜分高度。
      // 首次打开时移除旧位置，随后以普通标签页重新创建；之后所有查词复用同一标签。
      this.dictionaryTabPlacementPrepared = true;
      for (const existingLeaf of this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE)) {
        existingLeaf.detach();
      }
    }
    const leaf = await this.app.workspace.ensureSideLeaf(
      DICTIONARY_VIEW_TYPE,
      "right",
      { active: true, split: false, reveal: true }
    );
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof LinguaDictionaryView)) {
      throw new Error("词典侧栏尚未准备好，请重新加载插件后再试。");
    }
    return leaf.view;
  }

  activateDictionaryHighlight(owner: LinguaStudyRenderChild, element: HTMLElement): void {
    if (this.activeDictionaryHighlightOwner !== owner) {
      this.activeDictionaryHighlightOwner?.clearLookupHighlight();
    }
    this.activeDictionaryHighlightOwner = owner;
    owner.setLookupHighlight(element);
  }

  clearDictionaryHighlight(): void {
    this.activeDictionaryHighlightOwner?.clearLookupHighlight();
    this.activeDictionaryHighlightOwner = null;
  }

  registerStudyRenderer(renderer: LinguaStudyRenderChild): void {
    this.studyRenderers.add(renderer);
  }

  unregisterStudyRenderer(renderer: LinguaStudyRenderChild): void {
    this.studyRenderers.delete(renderer);
    if (this.activeDictionaryHighlightOwner === renderer) {
      renderer.clearLookupHighlight();
      this.activeDictionaryHighlightOwner = null;
    }
  }

  notifyStudyRendererReady(renderer: LinguaStudyRenderChild): void {
    this.studyRendererReadyCounter += 1;
    this.studyRendererReadyOrder.set(renderer, this.studyRendererReadyCounter);
    void this.tryResolveVocabularyJump();
  }

  async loadVocabularyBook(): Promise<VocabularyBookLoadResult> {
    return this.getVocabularyStore().load();
  }

  async exportVocabularyBookToNote(): Promise<VocabularyExportWriteResult> {
    const loaded = await this.getVocabularyStore().load();
    if (loaded.warning) {
      throw new Error(loaded.warning);
    }
    if (Object.keys(loaded.book.entries).length === 0) {
      throw new Error("生词本为空，暂时没有可以导出的单词。");
    }
    const storage: VocabularyExportStorage = {
      inspect: (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (node === null) {
          return null;
        }
        if (node instanceof TFile) {
          return "file";
        }
        if (node instanceof TFolder) {
          return "folder";
        }
        throw new Error(`无法识别导出路径类型：${path}`);
      },
      read: async (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法读取导出笔记：${path}`);
        }
        return this.app.vault.cachedRead(node);
      },
      createFolder: async (path) => {
        await this.app.vault.createFolder(normalizePath(path));
      },
      createFile: async (path, content) => {
        await this.app.vault.create(normalizePath(path), content);
      },
      updateFile: async (path, content) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法更新导出笔记：${path}`);
        }
        await this.app.vault.modify(node, content);
      }
    };
    const result = await writeVocabularyExport(storage, loaded.book, new Date());
    const exported = this.app.vault.getAbstractFileByPath(normalizePath(result.path));
    if (!(exported instanceof TFile)) {
      throw new Error("生词本笔记已经写入，但暂时无法打开，请在文件列表中手动打开。");
    }
    await this.openVocabularyExportFile(exported);
    return result;
  }

  async exportVocabularyBookToImages(): Promise<VocabularyImageExportResult> {
    if (!this.capabilities.desktop) {
      throw new Error("移动端暂不支持生词本长图导出，请在电脑端使用。");
    }
    const loaded = await this.getVocabularyStore().load();
    if (loaded.warning) {
      throw new Error(loaded.warning);
    }
    const wordCount = Object.keys(loaded.book.entries).length;
    if (wordCount === 0) {
      throw new Error("生词本为空，暂时没有可以生成的长图。");
    }
    const generatedAt = new Date();
    const pages = await renderVocabularyBookImages(loaded.book, generatedAt);
    const storage: VocabularyImageExportStorage = {
      inspect: (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (node === null) {
          return null;
        }
        if (node instanceof TFile) {
          return "file";
        }
        if (node instanceof TFolder) {
          return "folder";
        }
        throw new Error(`无法识别长图导出路径类型：${path}`);
      },
      readText: async (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法读取长图导出清单：${path}`);
        }
        return this.app.vault.cachedRead(node);
      },
      readBinary: async (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法读取已有长图：${path}`);
        }
        return this.app.vault.readBinary(node);
      },
      createFolder: async (path) => {
        await this.app.vault.createFolder(normalizePath(path));
      },
      createText: async (path, content) => {
        await this.app.vault.create(normalizePath(path), content);
      },
      updateText: async (path, content) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法更新长图导出清单：${path}`);
        }
        await this.app.vault.modify(node, content);
      },
      createBinary: async (path, content) => {
        await this.app.vault.createBinary(normalizePath(path), content);
      },
      updateBinary: async (path, content) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法更新长图：${path}`);
        }
        await this.app.vault.modifyBinary(node, content);
      },
      removeFile: async (path) => {
        const node = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(node instanceof TFile)) {
          throw new Error(`无法清理旧长图：${path}`);
        }
        await this.app.fileManager.trashFile(node);
      }
    };
    const result = await writeVocabularyImageExport(
      storage,
      pages,
      wordCount,
      generatedAt
    );
    const firstPage = this.app.vault.getAbstractFileByPath(normalizePath(result.paths[0]));
    if (!(firstPage instanceof TFile)) {
      throw new Error("生词本长图已经写入，但暂时无法打开，请在文件列表中手动打开。");
    }
    await this.openVocabularyExportFile(firstPage);
    return result;
  }

  private async openVocabularyExportFile(file: TFile): Promise<void> {
    const viewType = file.extension === "md" ? "markdown" : "image";
    const existingLeaf = this.app.workspace.getLeavesOfType(viewType).find((leaf) => {
      const view = leaf.view as typeof leaf.view & { file?: TFile | null };
      return view.file?.path === file.path;
    });
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  async addVocabularyFromLookup(
    context: DictionaryLookupContext,
    result: DictionaryLookupResult,
    customMeaning: string
  ): Promise<VocabularyBookFile> {
    const vocabularyContext: Omit<VocabularyContext, "studyProfile" | "addedAt"> | null =
      context.sentence !== null &&
      context.sourcePath !== null &&
      context.transcriptPath !== null &&
      context.videoId !== null &&
      context.segmentIndex !== null &&
      context.start !== null &&
      context.end !== null
        ? {
          sentence: context.sentence,
          sourcePath: context.sourcePath,
          transcriptPath: context.transcriptPath,
          videoId: context.videoId,
          segmentIndex: context.segmentIndex,
          start: context.start,
          end: context.end
        }
        : null;
    const book = await this.getVocabularyStore().add({
      rawWord: result.query || context.word,
      dictionaryEntry: result.entry,
      customMeaning,
      studyProfile: this.settings.studyProfile,
      context: vocabularyContext,
      now: new Date()
    });
    this.notifyVocabularyChanged();
    return book;
  }

  async removeVocabularyEntry(id: string): Promise<VocabularyBookFile> {
    const book = await this.getVocabularyStore().remove(id);
    this.notifyVocabularyChanged();
    return book;
  }

  async updateVocabularyNote(id: string, note: string): Promise<VocabularyBookFile> {
    const book = await this.getVocabularyStore().updateNote(id, note);
    this.notifyVocabularyChanged();
    return book;
  }

  async introduceVocabularyEntry(id: string, now: Date): Promise<VocabularyBookFile> {
    const book = await this.getVocabularyStore().introduce(id, now);
    this.notifyVocabularyChanged();
    return book;
  }

  async rateVocabularyEntry(
    id: string,
    rating: ReviewRating,
    now: Date
  ): Promise<VocabularyBookFile> {
    const book = await this.getVocabularyStore().rate(id, rating, now);
    this.notifyVocabularyChanged();
    return book;
  }

  subscribeVocabulary(listener: () => void): () => void {
    this.vocabularyListeners.add(listener);
    return () => this.vocabularyListeners.delete(listener);
  }

  private notifyVocabularyChanged(): void {
    for (const listener of this.vocabularyListeners) {
      listener();
    }
  }

  async openVocabularyContext(context: VocabularyContext): Promise<void> {
    await this.openVocabularyContextForNavigation(context);
  }

  private async openVocabularyContextForNavigation(context: VocabularyContext): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile)) {
      throw new Error(`找不到生词来源笔记：${context.sourcePath}`);
    }

    new Notice("正在打开来源笔记并定位原句…", 2_000);

    const mostRecentLeaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    const matchingLeaves = this.app.workspace.getLeavesOfType("markdown").filter((leaf) =>
      leaf.view instanceof MarkdownView && leaf.view.file?.path === context.sourcePath
    );
    let targetLeaf = mostRecentLeaf && matchingLeaves.includes(mostRecentLeaf)
      ? mostRecentLeaf
      : matchingLeaves.find((leaf) => leaf.view.containerEl.getClientRects().length > 0);
    targetLeaf ??= matchingLeaves[0];
    const shouldOpenFile = !targetLeaf;
    targetLeaf ??= this.app.workspace.getLeaf("tab");

    if (this.pendingVocabularyJump) {
      window.clearTimeout(this.pendingVocabularyJump.timeout);
    }
    const id = this.vocabularyJumpId + 1;
    this.vocabularyJumpId = id;
    const timeout = window.setTimeout(() => {
      if (this.pendingVocabularyJump?.id !== id) {
        return;
      }
      this.pendingVocabularyJump = null;
      new Notice("来源笔记已打开，但对应播放器未能在 10 秒内准备好。", 7_000);
    }, 10_000);
    this.pendingVocabularyJump = { id, context, targetLeaf, timeout };

    try {
      if (shouldOpenFile) {
        await targetLeaf.openFile(file);
      } else {
        await this.app.workspace.revealLeaf(targetLeaf);
      }
      if (targetLeaf.view instanceof MarkdownView && targetLeaf.view.getMode() !== "preview") {
        const viewState = targetLeaf.getViewState();
        await targetLeaf.setViewState({
          ...viewState,
          state: {
            ...viewState.state,
            file: context.sourcePath,
            mode: "preview"
          }
        });
      }
      await this.app.workspace.revealLeaf(targetLeaf);
      await this.tryResolveVocabularyJump();
    } catch (caught) {
      if (this.pendingVocabularyJump?.id === id) {
        window.clearTimeout(timeout);
        this.pendingVocabularyJump = null;
      }
      throw caught;
    }
  }

  private async tryResolveVocabularyJump(): Promise<void> {
    const pending = this.pendingVocabularyJump;
    if (!pending) {
      return;
    }
    const renderer = selectNewestEligibleRenderer(
      [...this.studyRenderers].map((candidate) => ({
        renderer: candidate,
        readyOrder: this.studyRendererReadyOrder.get(candidate) ?? 0,
        eligible: candidate.isVisibleVocabularyContextTarget(
          pending.context,
          pending.targetLeaf
        )
      }))
    );
    if (!renderer) {
      return;
    }
    window.clearTimeout(pending.timeout);
    this.pendingVocabularyJump = null;
    try {
      await renderer.navigateToVocabularyContext(pending.context);
      new Notice("已定位到生词所在原句；视频没有自动播放。", 4_000);
    } catch (caught) {
      new Notice(caught instanceof Error ? caught.message : "无法跳转到视频原句。", 7_000);
    }
  }

  speakDictionaryWord(word: string): void {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      new Notice("当前系统不支持离线单词朗读。", 4_000);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.name.toLocaleLowerCase("en-US") === "samantha")
      ?? voices.find((voice) => voice.lang.toLocaleLowerCase("en-US").startsWith("en-us"))
      ?? null;
    utterance.addEventListener("end", () => {
      if (this.dictionaryUtterance === utterance) {
        this.dictionaryUtterance = null;
      }
    }, { once: true });
    this.dictionaryUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  async setStudyProfile(profile: StudyProfile): Promise<void> {
    await this.updateSettings({ studyProfile: profile });
  }

  subscribeStudyProfile(listener: (profile: StudyProfile) => void): () => void {
    this.studyProfileListeners.add(listener);
    return () => this.studyProfileListeners.delete(listener);
  }

  getStudyProfileLabel(profile: StudyProfile = this.settings.studyProfile): string {
    return STUDY_PROFILE_LABELS[profile];
  }

  private collectDictionaryHints(sourceText: string): StudyDictionaryHint[] {
    const words = sourceText.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) ?? [];
    const hints: StudyDictionaryHint[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      const lookup = this.offlineDictionary.lookup(word);
      const entry = lookup.entry;
      if (!entry || seen.has(entry.word.toLocaleLowerCase("en-US"))) {
        continue;
      }
      seen.add(entry.word.toLocaleLowerCase("en-US"));
      if (entry.examTags.length > 0) {
        hints.push({ word: entry.word, tags: entry.examTags });
      }
      if (hints.length >= 12) {
        break;
      }
    }
    return hints;
  }

  async updateTranscriptSegmentFile(
    transcriptPath: string,
    sourcePath: string,
    identity: TranscriptSegmentIdentity,
    nextText: string
  ): Promise<TranscriptFile> {
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(transcriptPath, sourcePath);
    const fallbackFile = this.app.vault.getAbstractFileByPath(transcriptPath);
    const file = linkedFile ?? fallbackFile;
    if (!(file instanceof TFile)) {
      throw new Error(`找不到字幕文件：${transcriptPath}`);
    }
    return this.transcriptWriteQueue.run(file.path, async () => {
      let current: TranscriptFile;
      try {
        current = validateTranscript(JSON.parse(await this.app.vault.read(file)) as unknown);
      } catch (error) {
        throw new Error("字幕文件已经变化或无法读取，请重新打开笔记后再试。", {
          cause: error
        });
      }
      if (current.videoId !== identity.videoId) {
        throw new Error("字幕文件对应的视频已经变化，请重新打开笔记后再试。");
      }
      const segmentIndex = current.segments.findIndex(
        (segment) => segment.start === identity.start && segment.end === identity.end
      );
      if (segmentIndex < 0) {
        throw new Error("目标字幕的时间轴已经变化，请重新打开笔记后再试。");
      }
      const updated = updateTranscriptSegmentText(current, segmentIndex, nextText);
      await this.app.vault.modify(file, `${JSON.stringify(updated, null, 2)}\n`);
      return updated;
    });
  }

  async getCachedBilibiliVideo(
    config: BilibiliCodeBlockConfig
  ): Promise<CachedBilibiliVideo | null> {
    if (!this.bilibiliCacheService) {
      return null;
    }
    return this.bilibiliCacheService.getCachedVideo(
      config.idType,
      config.videoId,
      config.page
    );
  }

  async openBilibiliCacheFolder(): Promise<void> {
    this.requireCapability(this.capabilities.bilibiliVideoCache, "B站视频缓存");
    await this.getBilibiliCacheService().openCacheFolder();
  }

  getBilibiliCacheFolder(): string {
    return this.bilibiliCacheService?.cacheFolder ?? "移动端不使用本地视频缓存";
  }

  getWhisperAlignmentCacheFolder(): string {
    return this.localWhisperService?.cacheFolder ?? "移动端不使用本地 Whisper 缓存";
  }

  hasWhisperAlignmentModel(): Promise<boolean> {
    return this.localWhisperService?.hasCachedModel() ?? Promise.resolve(false);
  }

  openWhisperAlignmentCacheFolder(): Promise<void> {
    this.requireCapability(this.capabilities.localWhisper, "本地 Whisper 自动对齐");
    return this.getLocalWhisperService().openCacheFolder();
  }

  clearWhisperAlignmentCache(): Promise<void> {
    this.requireCapability(this.capabilities.localWhisper, "本地 Whisper 自动对齐");
    return this.getLocalWhisperService().clearCache();
  }

  openBilibiliTranscriptImport(
    sourcePath: string,
    config: BilibiliCodeBlockConfig
  ): Promise<void> {
    return this.getBilibiliImporter().openTranscriptImport(sourcePath, config);
  }

  cleanupLegacyBilibiliSourceLink(
    sourcePath: string,
    config: BilibiliCodeBlockConfig
  ): Promise<void> {
    return this.getBilibiliImporter().cleanupLegacyVisibleLink(sourcePath, config);
  }

  getBilibiliLoginStatus(): Promise<BilibiliSessionStatus> {
    return this.getBilibiliSessionService().getStatus();
  }

  async openBilibiliLogin(): Promise<void> {
    this.requireCapability(this.capabilities.bilibiliLogin, "B站插件内登录");
    await this.getBilibiliSessionService().openLogin();
  }

  async clearBilibiliLogin(): Promise<void> {
    this.requireCapability(this.capabilities.bilibiliLogin, "B站插件内登录");
    await this.getBilibiliSessionService().clearLogin();
  }

  async loadTranslationCache(
    transcriptPath: string,
    videoId: string
  ): Promise<TranslationCacheLoadResult> {
    if (!this.settings.cacheTranslations) {
      return {
        path: normalizePath(getTranslationCachePath(transcriptPath)),
        translations: {},
        warning: null
      };
    }

    return this.getTranslationCacheStore().load(transcriptPath, videoId);
  }

  async saveTranslationCache(
    transcriptPath: string,
    videoId: string,
    fingerprint: string,
    entry: TranslationCacheEntry
  ): Promise<void> {
    if (!this.settings.cacheTranslations) {
      return;
    }

    await this.getTranslationCacheStore().upsert(
      transcriptPath,
      videoId,
      fingerprint,
      entry
    );
  }

  private async saveImportedDocumentTranslations(
    transcriptPath: string,
    videoId: string,
    segments: readonly TranscriptSegment[],
    chinese: readonly string[],
    sourceLabel: string
  ): Promise<void> {
    const entries: Record<string, TranslationCacheEntry> = {};
    const updatedAt = new Date().toISOString();
    for (const [index, segment] of segments.entries()) {
      const text = chinese[index]?.trim() ?? "";
      if (text === "") {
        continue;
      }
      const fingerprint = await createSegmentFingerprint(segment.start, segment.end, segment.text);
      entries[fingerprint] = {
        sourceText: segment.text,
        text,
        provider: "imported-document",
        model: sourceLabel,
        updatedAt
      };
    }
    if (Object.keys(entries).length > 0) {
      await this.getTranslationCacheStore().upsertMany(transcriptPath, videoId, entries);
    }
  }

  async loadStudyCache(
    transcriptPath: string,
    videoId: string
  ): Promise<StudyCacheLoadResult> {
    if (!this.settings.cacheTranslations) {
      return {
        path: normalizePath(getStudyCachePath(transcriptPath)),
        analyses: {},
        warning: null
      };
    }
    return this.getStudyCacheStore().load(transcriptPath, videoId);
  }

  async saveStudyCache(
    transcriptPath: string,
    videoId: string,
    fingerprint: string,
    entry: StudyCacheEntry
  ): Promise<void> {
    if (!this.settings.cacheTranslations) {
      return;
    }
    await this.getStudyCacheStore().upsert(
      transcriptPath,
      videoId,
      fingerprint,
      entry
    );
  }

  private getTranslationService(): TranslationService {
    if (!this.translationService) {
      throw new Error("翻译服务尚未初始化，请重新加载插件。");
    }
    return this.translationService;
  }

  private getTranslationCacheStore(): TranslationCacheStore {
    if (!this.translationCacheStore) {
      throw new Error("翻译缓存尚未初始化，请重新加载插件。");
    }
    return this.translationCacheStore;
  }

  private getStudyCacheStore(): StudyCacheStore {
    if (!this.studyCacheStore) {
      throw new Error("知识卡缓存尚未初始化，请重新加载插件。");
    }
    return this.studyCacheStore;
  }

  private getVocabularyStore(): VocabularyStore {
    if (!this.vocabularyStore) {
      throw new Error("生词本尚未初始化，请重新加载插件。");
    }
    return this.vocabularyStore;
  }

  private getYouTubeImporter(): YouTubeImportController {
    if (!this.youtubeImporter) {
      throw new Error("YouTube 字幕导入功能尚未初始化，请重新加载插件。");
    }
    return this.youtubeImporter;
  }

  private getBilibiliImporter(): BilibiliImportController {
    if (!this.bilibiliImporter) {
      throw new Error("B站播放器导入功能尚未初始化，请重新加载插件。");
    }
    return this.bilibiliImporter;
  }

  private getBilibiliCacheService(): BilibiliCacheService {
    if (!this.bilibiliCacheService) {
      throw new Error("B站视频缓存功能尚未初始化，请重新加载插件。");
    }
    return this.bilibiliCacheService;
  }

  private getLocalWhisperService(): LocalWhisperService {
    if (!this.localWhisperService) {
      throw new Error("本地 Whisper 对齐服务尚未初始化，请重新加载插件。");
    }
    return this.localWhisperService;
  }

  private getFullDictionaryService(): FullDictionaryService {
    if (!this.fullDictionaryService) {
      throw new Error("完整版词典服务尚未初始化，请重新加载插件。");
    }
    return this.fullDictionaryService;
  }

  private getCustomDictionaryService(): CustomDictionaryService {
    if (!this.customDictionaryService) {
      throw new Error("自定义词典服务尚未初始化，请重新加载插件。");
    }
    return this.customDictionaryService;
  }

  private getBilibiliSessionService(): BilibiliSessionService {
    if (!this.bilibiliSessionService) {
      throw new Error("B站登录会话尚未初始化，请重新加载插件。");
    }
    return this.bilibiliSessionService;
  }

  private requireCapability(available: boolean, feature: string): void {
    if (!available) {
      throw new Error(`${feature}仅支持 Obsidian 电脑端。`);
    }
  }
}
