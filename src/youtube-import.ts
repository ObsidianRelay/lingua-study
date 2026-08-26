import {
  App,
  Editor,
  MarkdownView,
  Modal,
  normalizePath,
  Notice,
  requestUrl,
  TFile,
  TFolder
} from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  buildStudyBlock,
  chooseAvailableTranscriptPath,
  extractInitialPlayerResponse,
  extractInnerTubeConfig,
  extractTranscriptPathsFromStudyBlocks,
  extractYouTubeLinks,
  findYouTubeLinksByPriority,
  getCaptionTracks,
  groupTranscriptSegmentsIntoSentences,
  mapHttpFailure,
  mapPlayerFailure,
  parseJson3Captions,
  parseSubtitleFile,
  parseTimedTextXml,
  parseYouTubeLink,
  removeMatchingVideoLinkFromLine,
  sanitizeTranscriptFolder,
  selectEnglishCaptionTrack,
  type CaptionTrackDescriptor,
  type InnerTubeConfig,
  type YouTubeImportErrorCode,
  type YouTubeLink
} from "./import-core";
import type { LinguaStudySettings } from "./settings";
import { validateTranscript, type TranscriptFile, type TranscriptSegment } from "./transcript-core";
import { fetchTranscriptWithYtDlp } from "./yt-dlp";
import { addStudyBlockExitLine } from "./live-preview-core";

const MAX_LOCAL_SUBTITLE_BYTES = 10 * 1024 * 1024;
const IOS_CLIENT_VERSION = "20.10.38";
const ANDROID_CLIENT_VERSION = "20.10.38";
const YTRANSCRIPT_IOS_USER_AGENT =
  "com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

class TranscriptImportError extends Error {
  constructor(readonly code: YouTubeImportErrorCode, message: string) {
    super(message);
    this.name = "TranscriptImportError";
  }
}

interface ImportedSubtitleFile {
  name: string;
  text: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "字幕导入失败，请稍后重试。";
}

class YouTubeLinkModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly links: YouTubeLink[],
    private readonly resolveValue: (value: YouTubeLink | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.links.length > 1 ? "选择 YouTube 视频" : "粘贴 YouTube 链接");
    this.contentEl.createEl("p", {
      text: this.links.length > 1
        ? "当前范围内找到了多个 YouTube 链接，请选择要导入的一个。"
        : "没有找到唯一链接，请在下面粘贴 YouTube 视频链接。"
    });

    for (const link of this.links) {
      const button = this.contentEl.createEl("button", {
        cls: "mod-cta lingua-study-link-choice",
        text: `${link.videoId} — ${link.originalUrl}`
      });
      button.addEventListener("click", () => this.finish(link));
    }

    const input = this.contentEl.createEl("input", {
      type: "url",
      placeholder: "https://www.youtube.com/watch?v=..."
    });
    input.addClass("lingua-study-url-input");
    const errorEl = this.contentEl.createDiv({ cls: "lingua-study-import-error" });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const importButton = actions.createEl("button", { cls: "mod-cta", text: "导入" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));

    const submit = (): void => {
      const link = parseYouTubeLink(input.value);
      if (!link) {
        errorEl.setText("请输入有效的 YouTube 视频链接。只接受正式 YouTube 域名和 11 位视频 ID。");
        return;
      }
      this.finish(link);
    };
    importButton.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private finish(value: YouTubeLink | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

class SubtitleFallbackModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly reason: string,
    private readonly resolveValue: (value: ImportedSubtitleFile | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("无法自动获取英文字幕");
    this.contentEl.createEl("p", { text: this.reason });
    this.contentEl.createEl("p", {
      text: "可改选本机 .srt 或 .vtt 文件继续。文件只在本机读取，不会上传，最大 10 MB。"
    });
    const errorEl = this.contentEl.createDiv({ cls: "lingua-study-import-error" });
    const fileInput = this.contentEl.createEl("input", { type: "file" });
    fileInput.accept = ".srt,.vtt,text/vtt,application/x-subrip";
    fileInput.addClass("lingua-study-file-input");
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const chooseButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "选择本地字幕文件（.srt / .vtt）"
    });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));

    chooseButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      const extension = file.name.toLowerCase().split(".").at(-1);
      if (extension !== "srt" && extension !== "vtt") {
        errorEl.setText("只支持 .srt 或 .vtt 字幕文件。");
        fileInput.value = "";
        return;
      }
      if (file.size > MAX_LOCAL_SUBTITLE_BYTES) {
        errorEl.setText("字幕文件超过 10 兆字节，未读取任何内容。");
        fileInput.value = "";
        return;
      }
      void file.text().then((text) => {
        try {
          parseSubtitleFile(text);
          this.finish({ name: file.name, text });
        } catch (error) {
          errorEl.setText(errorMessage(error));
          fileInput.value = "";
        }
      }).catch(() => {
        errorEl.setText("无法读取该本地字幕文件，请检查文件权限后重试。");
        fileInput.value = "";
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private finish(value: ImportedSubtitleFile | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

export class YouTubeImportController {
  private readonly activeVideoIds = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async importFromEditor(editor: Editor, view: MarkdownView): Promise<void> {
    const link = await this.resolveLink(editor);
    if (!link) {
      return;
    }
    await this.importLink(editor, view, link);
  }

  async importLink(editor: Editor, view: MarkdownView, link: YouTubeLink): Promise<void> {
    if (this.activeVideoIds.has(link.videoId)) {
      new Notice("这个视频正在导入，请稍候。", 4_000);
      return;
    }

    this.activeVideoIds.add(link.videoId);
    const progress = new Notice("正在读取 YouTube 英文字幕…", 0);
    try {
      const markdown = editor.getValue();
      if (await this.noteAlreadyContainsVideo(markdown, link.videoId)) {
        this.removeVisibleSourceLink(editor, link);
        progress.hide();
        new Notice("当前笔记已经包含这个视频的学习内容，未重复插入。", 5_000);
        await this.switchToReadingView(view);
        return;
      }

      const cachedPath = await this.findReusableCache(link.videoId);
      if (cachedPath) {
        await this.completeEditorImport(editor, view, link, cachedPath);
        progress.hide();
        new Notice("已复用本地字幕并创建学习内容。", 5_000);
        return;
      }

      let segments: TranscriptSegment[];
      let usedYtDlp = false;
      try {
        segments = await this.fetchPublicEnglishTranscript(link);
      } catch (error) {
        const directReason = errorMessage(error);
        progress.setMessage("YouTube 直接获取失败，正在尝试本机 yt-dlp…");
        const ytDlpResult = await fetchTranscriptWithYtDlp(
          link.canonicalUrl,
          this.getSettings().ytDlpPath
        );
        if (ytDlpResult.status === "success") {
          segments = ytDlpResult.segments;
          usedYtDlp = true;
        } else {
          progress.hide();
          const fallback = await this.chooseLocalSubtitle(
            `${directReason}\n\n${ytDlpResult.message}`
          );
          if (!fallback) {
            return;
          }
          segments = parseSubtitleFile(fallback.text);
        }
      }

      segments = groupTranscriptSegmentsIntoSentences(segments);
      progress.setMessage("正在保存字幕并更新当前笔记…");
      const transcriptPath = await this.saveTranscript(link, segments);
      await this.completeEditorImport(editor, view, link, transcriptPath);
      progress.hide();
      new Notice(
        `${usedYtDlp ? "已通过本机 yt-dlp 获取字幕并创建" : "已创建"}学习内容，共 ${segments.length} 条英文字幕。`,
        6_000
      );
    } catch (error) {
      progress.hide();
      new Notice(errorMessage(error), 8_000);
    } finally {
      this.activeVideoIds.delete(link.videoId);
    }
  }

  private async resolveLink(editor: Editor): Promise<YouTubeLink | null> {
    const links = findYouTubeLinksByPriority(
      editor.getSelection(),
      editor.getLine(editor.getCursor().line),
      editor.getValue()
    );
    if (links.length === 1) {
      return links[0] ?? null;
    }
    return this.openLinkModal(links);
  }

  private openLinkModal(links: YouTubeLink[]): Promise<YouTubeLink | null> {
    return new Promise((resolve) => {
      new YouTubeLinkModal(this.app, links, resolve).open();
    });
  }

  private chooseLocalSubtitle(reason: string): Promise<ImportedSubtitleFile | null> {
    return new Promise((resolve) => {
      new SubtitleFallbackModal(this.app, reason, resolve).open();
    });
  }

  private async findReusableCache(videoId: string): Promise<string | null> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    const path = normalizePath(`${folder}/${videoId}.json`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    try {
      const transcript = validateTranscript(JSON.parse(await this.app.vault.read(file)) as unknown);
      return transcript.videoId === videoId ? path : null;
    } catch {
      return null;
    }
  }

  private async noteAlreadyContainsVideo(markdown: string, videoId: string): Promise<boolean> {
    for (const path of extractTranscriptPathsFromStudyBlocks(markdown)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) {
        continue;
      }
      try {
        const transcript = validateTranscript(JSON.parse(await this.app.vault.read(file)) as unknown);
        if (transcript.videoId === videoId) {
          return true;
        }
      } catch {
        const escapedId = videoId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        if (new RegExp(`^${escapedId}(?:-\\d+)?\\.json$`, "u").test(file.name)) {
          return true;
        }
      }
    }
    return false;
  }

  private async fetchPublicEnglishTranscript(link: YouTubeLink): Promise<TranscriptSegment[]> {
    const failures: TranscriptImportError[] = [];
    let watchHtml = "";
    try {
      const response = await this.requestYouTube({
        url: `${link.canonicalUrl}&hl=en`,
        method: "GET",
        headers: {
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": BROWSER_USER_AGENT
        },
        throw: false
      });
      const failure = mapHttpFailure(response.status);
      if (failure) {
        throw new TranscriptImportError(failure.code, failure.message);
      }
      watchHtml = response.text;
    } catch (error) {
      failures.push(this.toTranscriptImportError(error));
    }

    const pageSegments = await this.tryPlayerResponse(
      extractInitialPlayerResponse(watchHtml),
      failures
    );
    if (pageSegments) {
      return pageSegments;
    }

    const androidSegments = await this.tryPlayerRequest(
      () => this.requestAndroidPlayer(link.videoId),
      failures
    );
    if (androidSegments) {
      return androidSegments;
    }

    try {
      const config = await this.resolveInnerTubeConfig(link.videoId, watchHtml);
      if (config !== null) {
        const webSegments = await this.tryPlayerRequest(
          () => this.requestInnerTubePlayer(
            link.videoId,
            config.apiKey,
            config.clientVersion,
            false
          ),
          failures
        );
        if (webSegments) {
          return webSegments;
        }

        const dynamicIosSegments = await this.tryPlayerRequest(
          () => this.requestInnerTubePlayer(
            link.videoId,
            config.apiKey,
            IOS_CLIENT_VERSION,
            true
          ),
          failures
        );
        if (dynamicIosSegments) {
          return dynamicIosSegments;
        }
      }
    } catch (error) {
      failures.push(this.toTranscriptImportError(error));
    }

    // 这条路线不依赖 watch/embed 页面提供配置，页面被拦截时仍可独立尝试。
    const keylessMobileSegments = await this.tryPlayerRequest(
      () => this.requestKeylessMobilePlayer(link.videoId),
      failures
    );
    if (keylessMobileSegments) {
      return keylessMobileSegments;
    }

    const failurePriority: YouTubeImportErrorCode[] = [
      "no-english-captions",
      "login-required",
      "private-or-unavailable",
      "rate-limited",
      "network",
      "invalid-response"
    ];
    for (const code of failurePriority) {
      const failure = failures.find((candidate) => candidate.code === code);
      if (failure) {
        throw failure;
      }
    }
    throw new TranscriptImportError("no-captions", "这个视频没有可读取的公开字幕。");
  }

  private toTranscriptImportError(error: unknown): TranscriptImportError {
    if (error instanceof TranscriptImportError) {
      return error;
    }
    return new TranscriptImportError("invalid-response", errorMessage(error));
  }

  private async tryPlayerRequest(
    request: () => Promise<unknown>,
    failures: TranscriptImportError[]
  ): Promise<TranscriptSegment[] | null> {
    try {
      return await this.tryPlayerResponse(await request(), failures);
    } catch (error) {
      failures.push(this.toTranscriptImportError(error));
      return null;
    }
  }

  private async tryPlayerResponse(
    playerResponse: unknown,
    failures: TranscriptImportError[]
  ): Promise<TranscriptSegment[] | null> {
    if (!playerResponse) {
      return null;
    }
    const playerFailure = mapPlayerFailure(playerResponse);
    if (playerFailure) {
      failures.push(new TranscriptImportError(playerFailure.code, playerFailure.message));
      return null;
    }
    const tracks = getCaptionTracks(playerResponse);
    if (tracks.length === 0) {
      return null;
    }
    const track = selectEnglishCaptionTrack(tracks);
    if (!track) {
      failures.push(new TranscriptImportError(
        "no-english-captions",
        "这个视频有字幕，但没有英文字幕。Lingua Study 不会把其他语言静默翻译成英文。"
      ));
      return null;
    }
    try {
      return await this.fetchCaptionTrack(track);
    } catch (error) {
      failures.push(this.toTranscriptImportError(error));
      return null;
    }
  }

  private async resolveInnerTubeConfig(
    videoId: string,
    watchHtml: string
  ): Promise<InnerTubeConfig | null> {
    const watchConfig = extractInnerTubeConfig(watchHtml);
    if (watchConfig) {
      return watchConfig;
    }
    const response = await this.requestYouTube({
      url: `https://www.youtube.com/embed/${videoId}?hl=en`,
      method: "GET",
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": BROWSER_USER_AGENT
      },
      throw: false
    });
    const failure = mapHttpFailure(response.status);
    if (failure) {
      throw new TranscriptImportError(failure.code, failure.message);
    }
    return extractInnerTubeConfig(response.text);
  }

  private async requestAndroidPlayer(videoId: string): Promise<unknown> {
    const response = await this.requestYouTube({
      url: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: ANDROID_CLIENT_VERSION,
            hl: "en",
            gl: "US"
          }
        }
      }),
      throw: false
    });
    const failure = mapHttpFailure(response.status);
    if (failure) {
      throw new TranscriptImportError(failure.code, failure.message);
    }
    return response.json as unknown;
  }

  private async requestInnerTubePlayer(
    videoId: string,
    apiKey: string,
    clientVersion: string,
    ios: boolean
  ): Promise<unknown> {
    const client = ios
      ? {
          clientName: "IOS",
          clientVersion,
          deviceMake: "Apple",
          deviceModel: "iPhone16,2",
          hl: "en",
          gl: "US",
          osName: "iPhone",
          osVersion: "18.3.1.22D72",
          utcOffsetMinutes: 0
        }
      : { clientName: "WEB", clientVersion, hl: "en", gl: "US", utcOffsetMinutes: 0 };
    const response = await this.requestYouTube({
      url: `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.youtube.com",
        ...(ios ? { "User-Agent": `com.google.ios.youtube/${clientVersion}` } : {})
      },
      body: JSON.stringify({ videoId, context: { client } }),
      throw: false
    });
    const failure = mapHttpFailure(response.status);
    if (failure) {
      throw new TranscriptImportError(failure.code, failure.message);
    }
    return response.json as unknown;
  }

  /**
   * 使用源自 YTranscript 1.4.0 的 YouTube iOS 客户端请求协议，但不打包固定 API key。
   * 这只是运行在桌面端的字幕网络请求，不代表插件支持 iPhone 或移动版 Obsidian。
   * 来源采用 MIT 许可证，版权与许可说明保存在 THIRD_PARTY_NOTICES.md。
   */
  private async requestKeylessMobilePlayer(videoId: string): Promise<unknown> {
    const response = await this.requestYouTube({
      url: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": YTRANSCRIPT_IOS_USER_AGENT
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "IOS",
            clientVersion: IOS_CLIENT_VERSION,
            hl: "en",
            gl: "US"
          }
        }
      }),
      throw: false
    });
    const failure = mapHttpFailure(response.status);
    if (failure) {
      throw new TranscriptImportError(failure.code, failure.message);
    }
    return response.json as unknown;
  }

  private async fetchCaptionTrack(track: CaptionTrackDescriptor): Promise<TranscriptSegment[]> {
    const url = this.validateTimedTextUrl(track.baseUrl);
    url.searchParams.set("fmt", "json3");
    const jsonResponse = await this.requestYouTube({
      url: url.toString(),
      method: "GET",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      throw: false
    });
    const jsonFailure = mapHttpFailure(jsonResponse.status);
    if (jsonFailure) {
      throw new TranscriptImportError(jsonFailure.code, jsonFailure.message);
    }
    try {
      return parseJson3Captions(jsonResponse.text);
    } catch {
      url.searchParams.set("fmt", "srv3");
      const xmlResponse = await this.requestYouTube({
        url: url.toString(),
        method: "GET",
        headers: { "User-Agent": BROWSER_USER_AGENT },
        throw: false
      });
      const xmlFailure = mapHttpFailure(xmlResponse.status);
      if (xmlFailure) {
        throw new TranscriptImportError(xmlFailure.code, xmlFailure.message);
      }
      try {
        return parseTimedTextXml(xmlResponse.text);
      } catch {
        throw new TranscriptImportError("invalid-response", "YouTube 返回的字幕为空或格式已发生变化。");
      }
    }
  }

  private validateTimedTextUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TranscriptImportError("invalid-response", "YouTube 返回了无效的字幕地址。");
    }
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "www.youtube.com" && url.hostname !== "youtube.com") ||
      url.pathname !== "/api/timedtext"
    ) {
      throw new TranscriptImportError("invalid-response", "已阻止非 YouTube HTTPS 字幕地址。");
    }
    return url;
  }

  private async requestYouTube(params: RequestUrlParam): Promise<RequestUrlResponse> {
    let url: URL;
    try {
      url = new URL(params.url);
    } catch {
      throw new TranscriptImportError("invalid-response", "已阻止无效的网络请求地址。");
    }
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "www.youtube.com" && url.hostname !== "youtube.com")
    ) {
      throw new TranscriptImportError("invalid-response", "已阻止非 YouTube HTTPS 网络请求。");
    }
    try {
      return await requestUrl(params);
    } catch {
      throw new TranscriptImportError("network", "无法连接 YouTube，请检查网络后重试。");
    }
  }

  private async saveTranscript(link: YouTubeLink, segments: TranscriptSegment[]): Promise<string> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    await this.ensureFolder(folder);
    const path = this.findAvailableTranscriptPath(folder, link.videoId);
    const studySegments = groupTranscriptSegmentsIntoSentences(segments);
    const transcript: TranscriptFile = validateTranscript({
      version: 1,
      videoId: link.videoId,
      sourceUrl: link.canonicalUrl,
      language: "en",
      segments: studySegments
    });
    await this.app.vault.create(path, `${JSON.stringify(transcript, null, 2)}\n`);
    return path;
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = normalizePath(current === "" ? part : `${current}/${part}`);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) {
        throw new Error(`无法创建字幕文件夹：${current} 已经是一个文件。`);
      }
      if (!(existing instanceof TFolder)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private findAvailableTranscriptPath(folder: string, videoId: string): string {
    const result = chooseAvailableTranscriptPath(folder, videoId, (candidate) =>
      this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null
    );
    if (result.conflict) {
      new Notice(`同名字幕文件无效或不匹配，已安全保存为 ${result.path}。`, 7_000);
    }
    return normalizePath(result.path);
  }

  private async completeEditorImport(
    editor: Editor,
    view: MarkdownView,
    link: YouTubeLink,
    transcriptPath: string
  ): Promise<void> {
    if (await this.noteAlreadyContainsVideo(editor.getValue(), link.videoId)) {
      this.removeVisibleSourceLink(editor, link);
      new Notice("导入期间当前笔记已加入相同视频，未重复插入。", 5_000);
      await this.switchToReadingView(view);
      return;
    }

    const block = addStudyBlockExitLine(buildStudyBlock(transcriptPath));
    const lines = editor.getValue().split("\n");
    const linkLine = lines.findIndex((line) =>
      extractYouTubeLinks(line).some((candidate) => candidate.videoId === link.videoId)
    );
    if (linkLine >= 0) {
      const originalLine = lines[linkLine] ?? "";
      const cleaned = removeMatchingVideoLinkFromLine(
        originalLine,
        (url) => parseYouTubeLink(url)?.videoId === link.videoId
      ).line;
      const replacement = cleaned.trim() === "" ? block : `${cleaned}\n\n${block}`;
      editor.replaceRange(
        replacement,
        { line: linkLine, ch: 0 },
        { line: linkLine, ch: originalLine.length }
      );
    } else {
      const cursor = editor.getCursor();
      const prefix = cursor.ch === 0 ? "" : "\n";
      editor.replaceRange(`${prefix}${block}`, cursor);
    }
    await this.switchToReadingView(view);
  }

  private removeVisibleSourceLink(editor: Editor, link: YouTubeLink): boolean {
    const lines = editor.getValue().split("\n");
    const lineIndex = lines.findIndex((line) =>
      extractYouTubeLinks(line).some((candidate) => candidate.videoId === link.videoId)
    );
    if (lineIndex < 0) {
      return false;
    }
    const originalLine = lines[lineIndex] ?? "";
    const result = removeMatchingVideoLinkFromLine(
      originalLine,
      (url) => parseYouTubeLink(url)?.videoId === link.videoId
    );
    if (!result.removed) {
      return false;
    }
    editor.replaceRange(
      result.line,
      { line: lineIndex, ch: 0 },
      { line: lineIndex, ch: originalLine.length }
    );
    return true;
  }

  private async switchToReadingView(view: MarkdownView): Promise<void> {
    const state = view.leaf.getViewState();
    await view.leaf.setViewState({
      ...state,
      state: { ...state.state, mode: "preview" },
      active: true
    });
  }
}
