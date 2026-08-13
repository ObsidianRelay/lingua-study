import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  normalizePath,
  parseYaml,
  Plugin,
  TFile
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  LinguaStudySettingTab,
  sanitizeSettings,
  type LinguaStudySettings
} from "./settings";
import {
  TranslationCacheStore,
  type TranslationCacheEntry,
  type TranslationCacheLoadResult
} from "./translation-cache";
import { createSegmentFingerprint, getTranslationCachePath } from "./translation-core";
import { TranslationService, type TranslationResult } from "./translation";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptFile {
  version: 1;
  videoId: string;
  sourceUrl: string;
  language: string;
  segments: TranscriptSegment[];
}

interface CodeBlockConfig {
  transcript: string;
}

interface YouTubeMessagePayload {
  id?: string | number;
  event?: string;
  info?: unknown;
  data?: unknown;
}

interface SegmentTranslationView {
  fingerprint: string;
  primaryButton: HTMLButtonElement;
  retranslateButton: HTMLButtonElement;
  outputEl: HTMLElement;
  statusEl: HTMLElement;
  entry: TranslationCacheEntry | null;
  visible: boolean;
  loading: boolean;
  errorMessage: string | null;
  requestGeneration: number;
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

function parseCodeBlock(source: string): CodeBlockConfig {
  let value: unknown;

  try {
    value = parseYaml(source);
  } catch {
    throw new Error("代码块配置不是有效的 YAML。请检查 transcript: 后面的路径。");
  }

  if (!value || typeof value !== "object") {
    throw new Error("代码块缺少配置。请添加 transcript: 字幕文件路径。");
  }

  const transcript = (value as Record<string, unknown>).transcript;
  if (typeof transcript !== "string" || transcript.trim() === "") {
    throw new Error("没有找到 transcript 路径。请填写本地字幕 JSON 文件路径。");
  }

  return { transcript: normalizePath(transcript.trim()) };
}

function validateTranscript(value: unknown): TranscriptFile {
  if (!value || typeof value !== "object") {
    throw new Error("字幕文件的最外层必须是 JSON 对象。");
  }

  const data = value as Record<string, unknown>;
  if (data.version !== 1) {
    throw new Error("暂不支持该字幕版本，version 必须是 1。");
  }
  if (typeof data.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(data.videoId)) {
    throw new Error("videoId 格式不正确，应为 11 位 YouTube 视频 ID。");
  }
  if (typeof data.sourceUrl !== "string" || !data.sourceUrl.startsWith("https://")) {
    throw new Error("sourceUrl 缺失或不是 HTTPS 链接。");
  }
  if (typeof data.language !== "string" || data.language.trim() === "") {
    throw new Error("language 不能为空。");
  }
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    throw new Error("segments 必须包含至少一条字幕。");
  }

  const segments: TranscriptSegment[] = [];
  let previousEnd = -1;

  data.segments.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`第 ${index + 1} 条字幕不是有效对象。`);
    }

    const segment = entry as Record<string, unknown>;
    const start = segment.start;
    const end = segment.end;
    const text = segment.text;

    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      throw new Error(`第 ${index + 1} 条字幕的 start 必须是大于或等于 0 的数字。`);
    }
    if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
      throw new Error(`第 ${index + 1} 条字幕的 end 必须大于 start。`);
    }
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`第 ${index + 1} 条字幕的 text 不能为空。`);
    }
    if (start < previousEnd) {
      throw new Error(`第 ${index + 1} 条字幕与前一条重叠或顺序不正确。`);
    }

    segments.push({ start, end, text: text.trim() });
    previousEnd = end;
  });

  return {
    version: 1,
    videoId: data.videoId,
    sourceUrl: data.sourceUrl,
    language: data.language.trim(),
    segments
  };
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

class LinguaStudyRenderChild extends MarkdownRenderChild {
  private readonly plugin: LinguaStudyPlugin;
  private readonly source: string;
  private readonly sourcePath: string;
  private iframeEl: HTMLIFrameElement | null = null;
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
  private segmentRows: HTMLElement[] = [];
  private timestampButtons: HTMLButtonElement[] = [];
  private controlButtons: HTMLButtonElement[] = [];
  private speedButtons = new Map<number, HTMLButtonElement>();
  private playPauseButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private runtimeErrorEl: HTMLElement | null = null;
  private translationViews: SegmentTranslationView[] = [];

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
    void this.initialize();
  }

  onunload(): void {
    this.destroyed = true;
    this.translationViews.forEach((view) => {
      view.requestGeneration += 1;
    });
    this.clearTimer("poll");
    this.clearTimer("handshake");
    this.clearTimer("fallback");

    if (this.messageWindow && this.messageHandler) {
      this.messageWindow.removeEventListener("message", this.messageHandler);
    }

    this.messageHandler = null;
    this.messageWindow = null;
    this.iframeEl = null;
    this.transcript = null;
    this.translationViews = [];
    this.containerEl.empty();
  }

  private async initialize(): Promise<void> {
    try {
      const config = parseCodeBlock(this.source);
      const transcript = await this.readTranscript(config.transcript);
      const fingerprints = await Promise.all(
        transcript.segments.map((segment) =>
          createSegmentFingerprint(segment.start, segment.end, segment.text)
        )
      );
      const cache = await this.plugin.loadTranslationCache(config.transcript, transcript.videoId);
      this.renderLayout(transcript, config.transcript, fingerprints, cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : "出现未知错误。";
      this.renderFatalError(message);
    }
  }

  private async readTranscript(path: string): Promise<TranscriptFile> {
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

    return validateTranscript(parsed);
  }

  private renderLayout(
    transcript: TranscriptFile,
    transcriptPath: string,
    fingerprints: string[],
    cache: TranslationCacheLoadResult
  ): void {
    this.transcript = transcript;
    this.transcriptPath = transcriptPath;
    this.containerEl.empty();
    const root = this.containerEl.createDiv({ cls: "evs-root" });

    const playerFrame = root.createDiv({ cls: "evs-player-frame" });
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

    const iframe = playerFrame.createEl("iframe", {
      cls: "evs-player-host",
      attr: {
        id: iframeId,
        title: "YouTube 视频播放器",
        src: `https://www.youtube-nocookie.com/embed/${transcript.videoId}?${playerParams.toString()}`,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        referrerpolicy: "strict-origin-when-cross-origin"
      }
    });
    iframe.setAttribute("allowfullscreen", "");
    this.iframeEl = iframe;
    this.setupMessageListener();
    iframe.addEventListener("load", () => this.startPlayerHandshake());

    const toolbar = root.createDiv({ cls: "evs-toolbar" });
    toolbar.setAttribute("aria-label", "视频播放控制");

    this.playPauseButton = this.createControlButton(toolbar, "播放", () => this.togglePlayback());
    this.createControlButton(toolbar, "−5 秒", () => this.seekBy(-5));
    this.createControlButton(toolbar, "+5 秒", () => this.seekBy(5));

    const speedGroup = toolbar.createDiv({ cls: "evs-speed-group" });
    speedGroup.setAttribute("aria-label", "播放速度");
    PLAYBACK_RATES.forEach((rate) => {
      const button = speedGroup.createEl("button", {
        cls: "evs-button evs-speed-button",
        text: `${rate}×`
      });
      button.type = "button";
      button.disabled = true;
      button.addEventListener("click", () => this.setPlaybackRate(rate));
      this.speedButtons.set(rate, button);
    });

    this.statusEl = root.createDiv({ cls: "evs-status", text: "正在加载 YouTube 播放器…" });
    this.statusEl.setAttribute("role", "status");
    this.runtimeErrorEl = root.createDiv({ cls: "evs-runtime-error" });
    this.runtimeErrorEl.setAttribute("role", "alert");
    this.runtimeErrorEl.hide();

    if (cache.warning) {
      const warning = root.createDiv({ cls: "evs-cache-warning", text: cache.warning });
      warning.setAttribute("role", "status");
    }

    const transcriptList = root.createDiv({ cls: "evs-transcript" });
    transcriptList.setAttribute("aria-label", "英文视频字幕");

    transcript.segments.forEach((segment, index) => {
      const row = transcriptList.createDiv({ cls: "evs-segment" });
      row.dataset.segmentIndex = index.toString();

      const timestamp = row.createEl("button", {
        cls: "evs-timestamp",
        text: formatTimestamp(segment.start),
        attr: { "aria-label": `跳转到 ${formatTimestamp(segment.start)}` }
      });
      timestamp.type = "button";
      timestamp.disabled = true;
      timestamp.addEventListener("click", () => this.jumpTo(segment.start));

      const content = row.createDiv({ cls: "evs-segment-content" });
      content.createDiv({ cls: "evs-segment-text", text: segment.text });

      const fingerprint = fingerprints[index] ?? "";
      const cachedEntry = cache.translations[fingerprint];
      const entry = cachedEntry?.sourceText === segment.text ? cachedEntry : null;
      const actions = content.createDiv({ cls: "evs-translation-actions" });
      const primaryButton = actions.createEl("button", {
        cls: "evs-translation-button",
        text: entry ? "显示翻译" : "翻译"
      });
      primaryButton.type = "button";

      const retranslateButton = actions.createEl("button", {
        cls: "evs-translation-button evs-translation-button-secondary",
        text: "重新翻译"
      });
      retranslateButton.type = "button";

      const outputEl = content.createDiv({ cls: "evs-translation-text" });
      outputEl.setAttribute("lang", "zh-CN");
      outputEl.hide();

      const translationStatusEl = content.createDiv({ cls: "evs-translation-status" });
      translationStatusEl.setAttribute("role", "status");
      translationStatusEl.hide();

      const translationView: SegmentTranslationView = {
        fingerprint,
        primaryButton,
        retranslateButton,
        outputEl,
        statusEl: translationStatusEl,
        entry,
        visible: false,
        loading: false,
        errorMessage: null,
        requestGeneration: 0
      };
      primaryButton.addEventListener("click", () => {
        if (translationView.entry) {
          translationView.visible = !translationView.visible;
          translationView.errorMessage = null;
          this.updateTranslationView(translationView);
        } else {
          void this.requestTranslation(index);
        }
      });
      retranslateButton.addEventListener("click", () => {
        void this.requestTranslation(index);
      });
      this.translationViews.push(translationView);
      this.updateTranslationView(translationView);

      this.segmentRows.push(row);
      this.timestampButtons.push(timestamp);
    });

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

  private updateTranslationView(view: SegmentTranslationView): void {
    view.primaryButton.disabled = view.loading;
    view.retranslateButton.disabled = view.loading;

    if (view.loading) {
      view.primaryButton.setText("正在翻译…");
    } else if (view.entry) {
      view.primaryButton.setText(view.visible ? "隐藏翻译" : "显示翻译");
    } else {
      view.primaryButton.setText(view.errorMessage ? "重试翻译" : "翻译");
    }

    if (view.entry) {
      view.retranslateButton.show();
      view.outputEl.setText(view.entry.text);
      if (view.visible) {
        view.outputEl.show();
      } else {
        view.outputEl.hide();
      }
    } else {
      view.retranslateButton.hide();
      view.outputEl.empty();
      view.outputEl.hide();
    }

    if (view.errorMessage) {
      view.statusEl.setText(view.errorMessage);
      view.statusEl.classList.add("is-error");
      view.statusEl.show();
    } else if (view.loading) {
      view.statusEl.setText("正在翻译……");
      view.statusEl.classList.remove("is-error");
      view.statusEl.show();
    } else {
      view.statusEl.empty();
      view.statusEl.classList.remove("is-error");
      view.statusEl.hide();
    }
  }

  private async requestTranslation(index: number): Promise<void> {
    const transcript = this.transcript;
    const segment = transcript?.segments[index];
    const view = this.translationViews[index];
    if (!segment || !view || view.loading || this.destroyed) {
      return;
    }

    const generation = view.requestGeneration + 1;
    view.requestGeneration = generation;
    view.loading = true;
    view.errorMessage = null;
    this.updateTranslationView(view);

    let result: TranslationResult;
    try {
      result = await this.plugin.translateSentence(segment.text);
    } catch (error) {
      if (this.destroyed || view.requestGeneration !== generation) {
        return;
      }

      view.loading = false;
      view.errorMessage = error instanceof Error ? error.message : "翻译失败，请稍后重试。";
      this.updateTranslationView(view);
      return;
    }

    if (this.destroyed || view.requestGeneration !== generation) {
      return;
    }

    const entry: TranslationCacheEntry = {
      sourceText: segment.text,
      text: result.text,
      provider: result.provider,
      model: result.model,
      updatedAt: new Date().toISOString()
    };

    view.entry = entry;
    view.visible = true;
    view.loading = false;
    view.errorMessage = null;
    this.updateTranslationView(view);

    if (!this.plugin.settings.cacheTranslations) {
      return;
    }

    try {
      await this.plugin.saveTranslationCache(
        this.transcriptPath,
        transcript.videoId,
        view.fingerprint,
        entry
      );
    } catch {
      if (this.destroyed || view.requestGeneration !== generation) {
        return;
      }

      view.errorMessage = "翻译成功，但本地缓存保存失败；本次结果仍可继续查看。";
      this.updateTranslationView(view);
    }
  }

  private createControlButton(
    parent: HTMLElement,
    label: string,
    action: () => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "evs-button", text: label });
    button.type = "button";
    button.disabled = true;
    button.addEventListener("click", action);
    this.controlButtons.push(button);
    return button;
  }

  private activateControls(statusText: string): void {
    if (!this.controlsActivated) {
      this.controlsActivated = true;
      this.controlButtons.forEach((button) => (button.disabled = false));
      this.timestampButtons.forEach((button) => (button.disabled = false));

      this.speedButtons.forEach((button, rate) => {
        button.disabled = false;
        button.setAttribute("aria-label", `设置为 ${rate} 倍速`);
      });
    }

    this.updateSpeedButtons(this.playbackRate);
    this.statusEl?.setText(statusText);

    if (this.pollTimer === null) {
      this.pollTimer = window.setInterval(() => this.updateActiveSegment(), 250);
    }
    this.updateActiveSegment();
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
        this.playbackRate = rate;
        this.updateSpeedButtons(rate);
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
      this.playbackRate = info.playbackRate;
      this.updateSpeedButtons(info.playbackRate);
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

    if (this.playPauseButton) {
      this.playPauseButton.setText(state === PLAYER_STATE_PLAYING ? "暂停" : "播放");
    }
  }

  private postPlayerMessage(message: Record<string, unknown>): void {
    const iframe = this.iframeEl;
    if (!iframe?.contentWindow) {
      return;
    }

    let targetOrigin: string;
    try {
      targetOrigin = new URL(iframe.src).origin;
    } catch {
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
    if (!this.iframeEl) {
      return;
    }

    if (this.playerState === PLAYER_STATE_PLAYING) {
      this.sendCommand("pauseVideo");
      this.onPlayerStateChange(PLAYER_STATE_PAUSED);
    } else {
      this.sendCommand("playVideo");
      this.onPlayerStateChange(PLAYER_STATE_PLAYING);
    }
  }

  private seekBy(deltaSeconds: number): void {
    if (!this.iframeEl) {
      return;
    }

    const requested = Math.max(0, this.getEstimatedCurrentTime() + deltaSeconds);
    const target = this.duration > 0 ? Math.min(this.duration, requested) : requested;
    this.setCurrentTime(target);
    this.sendCommand("seekTo", [target, true]);
    this.updateActiveSegment();
  }

  private jumpTo(seconds: number): void {
    if (!this.iframeEl) {
      return;
    }

    this.setCurrentTime(seconds);
    this.sendCommand("seekTo", [seconds, true]);
    this.sendCommand("playVideo");
    this.onPlayerStateChange(PLAYER_STATE_PLAYING);
    this.updateActiveSegment();
  }

  private setPlaybackRate(rate: number): void {
    if (!this.iframeEl) {
      return;
    }

    this.playbackRate = rate;
    this.sendCommand("setPlaybackRate", [rate]);
    this.updateSpeedButtons(rate);
  }

  private getEstimatedCurrentTime(): number {
    if (this.playerState !== PLAYER_STATE_PLAYING) {
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

  private updateSpeedButtons(currentRate: number): void {
    this.speedButtons.forEach((button, rate) => {
      const active = Math.abs(rate - currentRate) < 0.01;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active.toString());
    });
  }

  private updateActiveSegment(): void {
    const segments = this.transcript?.segments;
    if (!segments) {
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
    }
  }

  private showRuntimeError(message: string): void {
    this.playerState = PLAYER_STATE_PAUSED;
    this.playPauseButton?.setText("播放");
    this.clearTimer("poll");
    this.controlButtons.forEach((button) => (button.disabled = true));
    this.timestampButtons.forEach((button) => (button.disabled = true));
    this.speedButtons.forEach((button) => (button.disabled = true));

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
    if (this.statusEl) {
      this.statusEl.setText("播放器未能正常工作");
    }
  }

  private renderFatalError(message: string): void {
    this.containerEl.empty();
    const error = this.containerEl.createDiv({ cls: "evs-fatal-error" });
    error.setAttribute("role", "alert");
    error.createEl("strong", { text: "无法加载插件" });
    error.createDiv({ text: message });
  }
}

export default class LinguaStudyPlugin extends Plugin {
  settings: LinguaStudySettings = { ...DEFAULT_SETTINGS };
  private translationService: TranslationService | null = null;
  private translationCacheStore: TranslationCacheStore | null = null;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.translationService = new TranslationService(this.app, () => this.settings);
    this.translationCacheStore = new TranslationCacheStore(this.app);
    this.addSettingTab(new LinguaStudySettingTab(this.app, this));

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
  }

  async updateSettings(changes: Partial<LinguaStudySettings>): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, ...changes });
    await this.saveData(this.settings);
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
}
