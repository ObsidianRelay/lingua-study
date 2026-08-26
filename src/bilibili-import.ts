import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  normalizePath,
  requestUrl,
  TFile,
  TFolder
} from "obsidian";
import {
  addTranscriptToBilibiliStudyBlock,
  buildBilibiliStudyBlock,
  chooseAvailableTranscriptPath,
  extractBilibiliLinks,
  extractBilibiliVideosFromStudyBlocks,
  extractTranscriptPathsFromStudyBlocks,
  findBilibiliLinksByPriority,
  groupTranscriptSegmentsIntoSentences,
  normalizeTranscriptSegments,
  parseBilibiliLink,
  parseSubtitleFile,
  removeMatchingVideoLinkFromLine,
  removeVisibleBilibiliLinksFromMarkdown,
  sanitizeTranscriptFolder,
  type BilibiliLink,
  type BilibiliVideoLink
} from "./import-core";
import {
  BilibiliCacheService
} from "./bilibili-cache";
import type {
  BilibiliSubtitleErrorResult,
  BilibiliSubtitleSuccessResult
} from "./bilibili-api-core";
import { BilibiliSessionService } from "./bilibili-session";
import type { LinguaStudySettings } from "./settings";
import {
  validateTranscript,
  type TranscriptFile,
  type TranscriptSegment
} from "./transcript-core";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import { DocumentTranscriptImportModal } from "./document-transcript-import";
import {
  createDocumentImportDraftKey,
  DocumentImportDraftStore
} from "./document-import-draft";
import type { LocalWhisperService } from "./local-whisper";
import { getTranslationCachePath } from "./translation-core";
import { addStudyBlockExitLine } from "./live-preview-core";

const BILIBILI_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const MAX_LOCAL_SUBTITLE_BYTES = 10 * 1024 * 1024;

type BilibiliFallbackChoice =
  | { kind: "retry" }
  | { kind: "login" }
  | { kind: "file"; name: string; text: string }
  | { kind: "document" }
  | { kind: "player-only" };

interface BilibiliFallbackOptions {
  allowRetry: boolean;
  allowLogin: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "B站学习内容创建失败，请稍后重试。";
}

function linkLabel(link: BilibiliLink): string {
  if (link.kind === "short") {
    return link.shortUrl;
  }
  return `${link.videoId}${link.page > 1 ? `（第 ${link.page} P）` : ""} — ${link.originalUrl}`;
}

function sameVideo(
  left: Pick<BilibiliVideoLink, "idType" | "videoId" | "page">,
  right: Pick<BilibiliVideoLink, "idType" | "videoId" | "page">
): boolean {
  return left.idType === right.idType && left.videoId === right.videoId && left.page === right.page;
}

class BilibiliLinkModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly links: BilibiliLink[],
    private readonly resolveValue: (value: BilibiliLink | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.links.length > 1 ? "选择 B站视频" : "粘贴 B站链接");
    this.contentEl.createEl("p", {
      text: this.links.length > 1
        ? "当前范围内找到了多个 B站链接，请选择要创建学习内容的一个。"
        : "没有找到唯一链接，请在下面粘贴 B站视频链接。"
    });

    for (const link of this.links) {
      const button = this.contentEl.createEl("button", {
        cls: "mod-cta lingua-study-link-choice",
        text: linkLabel(link)
      });
      button.addEventListener("click", () => this.finish(link));
    }

    const input = this.contentEl.createEl("input", {
      type: "url",
      placeholder: "https://www.bilibili.com/video/BV..."
    });
    input.addClass("lingua-study-url-input");
    const errorEl = this.contentEl.createDiv({ cls: "lingua-study-import-error" });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const importButton = actions.createEl("button", { cls: "mod-cta", text: "创建学习内容" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));

    const submit = (): void => {
      const link = parseBilibiliLink(input.value);
      if (!link) {
        errorEl.setText("请输入有效的 B站视频链接，支持 BV、av、多 P 和 b23.tv 分享短链。");
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

  private finish(value: BilibiliLink | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

class BilibiliSubtitleFallbackModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly reason: string,
    private readonly options: BilibiliFallbackOptions,
    private readonly resolveValue: (value: BilibiliFallbackChoice | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.allowRetry
      ? "暂时无法直接获取 B站字幕"
      : "B站没有可直接使用的英文字幕");
    this.contentEl.createEl("p", { text: this.reason });
    this.contentEl.createEl("p", {
      text: "也可以选择本机 .srt 或 .vtt 文件（最大 10 MB），或只创建播放器。"
    });
    const errorEl = this.contentEl.createDiv({ cls: "lingua-study-import-error" });
    const fileInput = this.contentEl.createEl("input", { type: "file" });
    fileInput.accept = ".srt,.vtt,text/vtt,application/x-subrip";
    fileInput.addClass("lingua-study-file-input");
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    if (this.options.allowLogin) {
      actions.createEl("button", {
        cls: "mod-cta",
        text: "在 Obsidian 内登录 B站并重试"
      }).addEventListener("click", () => this.finish({ kind: "login" }));
    }
    if (this.options.allowRetry) {
      actions.createEl("button", {
        cls: this.options.allowLogin ? undefined : "mod-cta",
        text: "重新尝试"
      }).addEventListener("click", () => this.finish({ kind: "retry" }));
    }
    actions.createEl("button", {
      text: "选择 srt/vtt"
    }).addEventListener("click", () => fileInput.click());
    actions.createEl("button", { text: "导入博主文稿" })
      .addEventListener("click", () => this.finish({ kind: "document" }));
    actions.createEl("button", { text: "仅创建播放器" })
      .addEventListener("click", () => this.finish({ kind: "player-only" }));
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));

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
          this.finish({ kind: "file", name: file.name, text });
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

  private finish(value: BilibiliFallbackChoice | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

export class BilibiliImportController {
  private readonly activeVideos = new Set<string>();
  private readonly noteWriteQueue = new AsyncKeyedQueue();
  private readonly documentImportDraftStore: DocumentImportDraftStore;
  private readonly documentImportModals = new Map<string, DocumentTranscriptImportModal>();
  private readonly documentImportOpening = new Map<string, Promise<DocumentTranscriptImportModal>>();

  constructor(
    private readonly app: App,
    private readonly cacheService: BilibiliCacheService,
    private readonly bilibiliSession: BilibiliSessionService,
    private readonly getSettings: () => LinguaStudySettings,
    private readonly localWhisper: LocalWhisperService,
    private readonly saveImportedTranslations: (
      transcriptPath: string,
      videoId: string,
      segments: readonly TranscriptSegment[],
      chinese: readonly string[],
      sourceLabel: string
    ) => Promise<void>
  ) {
    this.documentImportDraftStore = new DocumentImportDraftStore(app, "lingua-study");
  }

  async openTranscriptImport(
    sourcePath: string,
    identity: Pick<BilibiliVideoLink, "idType" | "videoId" | "page">
  ): Promise<void> {
    const draftKey = createDocumentImportDraftKey(
      sourcePath,
      identity.idType,
      identity.videoId,
      identity.page
    );
    const existing = this.documentImportModals.get(draftKey);
    if (existing) {
      existing.openOrFocus();
      return;
    }
    const opening = this.documentImportOpening.get(draftKey);
    if (opening) {
      (await opening).openOrFocus();
      return;
    }
    const link: BilibiliVideoLink = {
      kind: "video",
      ...identity,
      canonicalUrl: identity.idType === "bvid"
        ? `https://www.bilibili.com/video/${identity.videoId}${identity.page > 1 ? `?p=${identity.page}` : ""}`
        : `https://www.bilibili.com/video/av${identity.videoId.slice(2)}${identity.page > 1 ? `?p=${identity.page}` : ""}`,
      originalUrl: identity.idType === "bvid"
        ? `https://www.bilibili.com/video/${identity.videoId}`
        : `https://www.bilibili.com/video/av${identity.videoId.slice(2)}`
    };
    const createModal = this.documentImportDraftStore.load(draftKey).then((loadedDraft) => {
      if (loadedDraft.warning) {
        new Notice(loadedDraft.warning, 7_000);
      }
      return new DocumentTranscriptImportModal(this.app, {
        initialDraft: loadedDraft.draft,
        getCachedVideo: async (onProgress) => {
          const result = await this.cacheService.cacheVideo(link, onProgress);
          return result.cached;
        },
        localModelCached: () => this.localWhisper.hasCachedModel(),
        transcribeLocal: (cached, onProgress) => this.localWhisper.transcribe(cached, onProgress),
        apply: (segments, chinese, sourceLabel) =>
          this.applyImportedTranscript(sourcePath, link, segments, chinese, sourceLabel),
        saveDraft: (draft) => this.documentImportDraftStore.save(draftKey, draft),
        clearDraft: () => this.documentImportDraftStore.remove(draftKey),
        onFinished: () => this.documentImportModals.delete(draftKey)
      });
    });
    this.documentImportOpening.set(draftKey, createModal);
    try {
      const modal = await createModal;
      this.documentImportModals.set(draftKey, modal);
      modal.openOrFocus();
    } finally {
      this.documentImportOpening.delete(draftKey);
    }
  }

  async cleanupLegacyVisibleLink(
    sourcePath: string,
    identity: Pick<BilibiliVideoLink, "idType" | "videoId" | "page">
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    if (!(file instanceof TFile)) {
      return;
    }
    await this.noteWriteQueue.run(file.path, async () => {
      const current = await this.app.vault.cachedRead(file);
      if (removeVisibleBilibiliLinksFromMarkdown(current, identity).removed === 0) {
        return;
      }
      await this.app.vault.process(file, (markdown) =>
        removeVisibleBilibiliLinksFromMarkdown(markdown, identity).markdown
      );
    });
  }

  async importFromEditor(editor: Editor, view: MarkdownView): Promise<void> {
    const candidate = await this.resolveLink(editor);
    if (!candidate) {
      return;
    }
    await this.importLink(editor, view, candidate);
  }

  async importLink(editor: Editor, view: MarkdownView, candidate: BilibiliLink): Promise<void> {

    let progress = new Notice(
      candidate.kind === "short" ? "正在解析 B站分享短链…" : "正在准备 B站学习内容…",
      0
    );
    const requestKey = candidate.kind === "short"
      ? candidate.shortUrl
      : `${candidate.idType}:${candidate.videoId}:p${candidate.page}`;
    if (this.activeVideos.has(requestKey)) {
      progress.hide();
      new Notice("这个哔哩哔哩视频正在处理，请稍候。", 4_000);
      return;
    }
    this.activeVideos.add(requestKey);
    try {
      const resolvedLink = candidate.kind === "short"
        ? await this.resolveShortLink(candidate)
        : candidate;
      let link = resolvedLink;
      let cacheWarning: string | null = null;
      if (link.idType === "aid") {
        const cacheResult = await this.cacheService.cacheVideo(
          link,
          (message) => progress.setMessage(message)
        );
        link = cacheResult.link;
      }
      const reusablePath = await this.findReusableTranscript(editor.getValue(), link);
      if (reusablePath) {
        await this.completeEditorImport(editor, view, link, reusablePath);
        progress.setMessage("已显示文字稿，正在准备 B站视频缓存…");
        try {
          const cacheResult = await this.cacheService.cacheVideo(
            link,
            (message) => progress.setMessage(message)
          );
          link = cacheResult.link;
          await this.switchToReadingView(view);
        } catch (error) {
          cacheWarning = errorMessage(error);
        }
        progress.hide();
        new Notice(
          cacheWarning
            ? `已复用本地文字稿；视频缓存失败，将使用在线播放器。${cacheWarning}`
            : "已复用本地文字稿并创建 B站学习内容。",
          8_000
        );
        return;
      }

      progress.setMessage("正在直接读取 B站英文字幕…");
      let subtitleResult = await this.requestBilibiliTranscript(link.videoId, link);
      let segments: TranscriptSegment[] | null = subtitleResult.status === "success"
        ? normalizeTranscriptSegments(subtitleResult.subtitle.segments)
        : null;
      let sourceLabel = subtitleResult.status === "success"
        ? this.subtitleSourceLabel(subtitleResult)
        : "B站英文字幕";

      while (!segments && subtitleResult.status === "error") {
        progress.hide();
        const fallback = await this.chooseSubtitleFallback(subtitleResult.error.message, {
          allowRetry: this.isRetryableSubtitleError(subtitleResult),
          allowLogin: subtitleResult.error.kind === "login-required"
        });
        if (!fallback) {
          return;
        }
        if (fallback.kind === "retry") {
          progress = new Notice("正在重新读取 B站字幕…", 0);
          subtitleResult = await this.requestBilibiliTranscript(link.videoId, link);
          if (subtitleResult.status === "success") {
            segments = normalizeTranscriptSegments(subtitleResult.subtitle.segments);
            sourceLabel = this.subtitleSourceLabel(subtitleResult);
          }
          continue;
        }
        if (fallback.kind === "login") {
          progress = new Notice("请在 Obsidian 登录窗口完成 B站登录；成功后会自动继续…", 0);
          subtitleResult = await this.bilibiliSession.loginAndRequestTranscript(
            link.videoId,
            link.page
          );
          if (subtitleResult.status === "success") {
            segments = normalizeTranscriptSegments(subtitleResult.subtitle.segments);
            sourceLabel = this.subtitleSourceLabel(subtitleResult);
          }
          continue;
        }
        if (fallback.kind === "player-only") {
          await this.completeEditorImport(editor, view, link, null);
          progress = new Notice("已显示 B站播放器，正在准备视频缓存…", 0);
          let reused = false;
          try {
            const cacheResult = await this.cacheService.cacheVideo(
              link,
              (message) => progress.setMessage(message)
            );
            link = cacheResult.link;
            reused = cacheResult.reused;
            await this.switchToReadingView(view);
          } catch (error) {
            cacheWarning = errorMessage(error);
          }
          progress.hide();
          new Notice(
            cacheWarning
              ? `已创建在线 B站播放器；视频缓存失败：${cacheWarning}`
              : reused
              ? "已复用缓存并保留 B站播放器；未创建文字稿。"
              : "已缓存视频并创建 B站播放器；未创建文字稿。",
            8_000
          );
          return;
        }
        if (fallback.kind === "document") {
          await this.completeEditorImport(editor, view, link, null);
          progress.hide();
          await this.openTranscriptImport(view.file?.path ?? "", link);
          return;
        }
        if (fallback.kind === "file") {
          progress = new Notice("正在读取本地字幕文件…", 0);
          segments = parseSubtitleFile(fallback.text);
          sourceLabel = `本地字幕文件 ${fallback.name}`;
          break;
        }
      }

      if (!segments) {
        return;
      }

      segments = groupTranscriptSegmentsIntoSentences(segments);
      progress.setMessage("正在保存英文文字稿并更新当前笔记…");
      const transcriptPath = await this.saveTranscript(link, segments);
      await this.completeEditorImport(editor, view, link, transcriptPath);
      progress.setMessage("英文文字稿已显示，正在准备 B站视频缓存…");
      try {
        const cacheResult = await this.cacheService.cacheVideo(
          link,
          (message) => progress.setMessage(message)
        );
        link = cacheResult.link;
        await this.switchToReadingView(view);
      } catch (error) {
        cacheWarning = errorMessage(error);
      }
      progress.hide();
      new Notice(
        cacheWarning
          ? `已通过${sourceLabel}创建 ${segments.length} 条英文字幕；视频缓存失败，将使用在线播放器。${cacheWarning}`
          : `已通过${sourceLabel}创建学习内容，共 ${segments.length} 条英文字幕。`,
        9_000
      );
    } catch (error) {
      progress.hide();
      new Notice(errorMessage(error), 8_000);
    } finally {
      this.activeVideos.delete(requestKey);
    }
  }

  private async resolveLink(editor: Editor): Promise<BilibiliLink | null> {
    const links = findBilibiliLinksByPriority(
      editor.getSelection(),
      editor.getLine(editor.getCursor().line),
      editor.getValue()
    );
    if (links.length === 1) {
      return links[0] ?? null;
    }
    return new Promise((resolve) => {
      new BilibiliLinkModal(this.app, links, resolve).open();
    });
  }

  private chooseSubtitleFallback(
    reason: string,
    options: BilibiliFallbackOptions
  ): Promise<BilibiliFallbackChoice | null> {
    return new Promise((resolve) => {
      new BilibiliSubtitleFallbackModal(this.app, reason, options, resolve).open();
    });
  }

  private async resolveShortLink(link: Extract<BilibiliLink, { kind: "short" }>): Promise<BilibiliVideoLink> {
    const response = await requestUrl({
      url: link.shortUrl,
      method: "GET",
      headers: { "User-Agent": BILIBILI_BROWSER_USER_AGENT },
      throw: false
    });
    if (response.status === 429) {
      throw new Error("B站暂时限制了短链接解析，请稍后再试，或改用完整的 bilibili.com/video/BV... 链接。");
    }
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`B站分享短链无法访问（HTTP ${response.status}），请改用完整视频链接。`);
    }

    const location = Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === "location"
    )?.[1];
    if (location) {
      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(location, link.shortUrl).toString();
      } catch {
        throw new Error("B站分享短链返回了无效地址，请改用完整视频链接。");
      }
      const direct = parseBilibiliLink(resolvedUrl);
      if (direct?.kind === "video") {
        return { ...direct, originalUrl: link.originalUrl };
      }
    }

    // Obsidian 的网络请求通常会自动跟随跳转，因此也从最终页面的
    // canonical 地址或页面数据中提取 BV/av 号，不执行页面脚本。
    const normalizedHtml = response.text
      .replace(/\\u002F/giu, "/")
      .replace(/\\\//gu, "/");
    const fullUrl = /https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(?:BV[0-9A-Za-z]{10}|av[1-9][0-9]*)(?:\?[^\s"'<>]*)?/iu
      .exec(normalizedHtml)?.[0];
    if (fullUrl) {
      const direct = parseBilibiliLink(fullUrl.replace(/&amp;/giu, "&"));
      if (direct?.kind === "video") {
        return { ...direct, originalUrl: link.originalUrl };
      }
    }

    const bvid = /\bBV[0-9A-Za-z]{10}\b/u.exec(normalizedHtml)?.[0];
    if (bvid) {
      return {
        kind: "video",
        idType: "bvid",
        videoId: bvid,
        page: 1,
        canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
        originalUrl: link.originalUrl
      };
    }
    throw new Error("无法从 B站分享短链识别视频，请在浏览器打开后复制完整的 bilibili.com/video/BV... 链接。");
  }

  private async requestBilibiliTranscript(
    bvid: string,
    link: BilibiliVideoLink
  ): Promise<BilibiliSubtitleSuccessResult | BilibiliSubtitleErrorResult> {
    return this.bilibiliSession.requestTranscript(bvid, link.page);
  }

  private subtitleSourceLabel(payload: BilibiliSubtitleSuccessResult): string {
    return payload.subtitle.automatic ? "B站自动英文字幕" : "B站人工英文字幕";
  }

  private isRetryableSubtitleError(payload: BilibiliSubtitleErrorResult): boolean {
    return payload.error.kind !== "no-english" && payload.error.kind !== "no-tracks";
  }

  private async findReusableTranscript(
    markdown: string,
    link: BilibiliVideoLink
  ): Promise<string | null> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    const expected = normalizePath(`${folder}/${link.videoId}-p${link.page}.json`);
    const candidates = [...new Set([
      ...extractTranscriptPathsFromStudyBlocks(markdown).map((path) => normalizePath(path)),
      expected
    ])];
    for (const path of candidates) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }
      try {
        const transcript = validateTranscript(JSON.parse(await this.app.vault.read(file)) as unknown);
        const source = parseBilibiliLink(transcript.sourceUrl);
        if (
          transcript.videoId === link.videoId &&
          source?.kind === "video" &&
          sameVideo(source, link)
        ) {
          return path;
        }
      } catch {
        // 损坏或不匹配的同名文件由保存逻辑另存，不覆盖原文件。
      }
    }
    return null;
  }

  private noteAlreadyContainsVideo(markdown: string, link: BilibiliVideoLink): boolean {
    return extractBilibiliVideosFromStudyBlocks(markdown).some((video) =>
      sameVideo(link, video)
    );
  }

  private async saveTranscript(
    link: BilibiliVideoLink,
    segments: TranscriptSegment[],
    normalizeSentences = true
  ): Promise<string> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    await this.ensureFolder(folder);
    const baseName = `${link.videoId}-p${link.page}`;
    const result = chooseAvailableTranscriptPath(folder, baseName, (candidate) =>
      this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null
    );
    if (result.conflict) {
      new Notice(`同名文字稿文件无效或不匹配，已安全保存为 ${result.path}。`, 7_000);
    }
    const studySegments = normalizeSentences
      ? groupTranscriptSegmentsIntoSentences(segments)
      : segments;
    const transcript: TranscriptFile = validateTranscript({
      version: 1,
      videoId: link.videoId,
      sourceUrl: link.canonicalUrl,
      language: "en",
      segments: studySegments
    });
    const path = normalizePath(result.path);
    await this.app.vault.create(path, `${JSON.stringify(transcript, null, 2)}\n`);
    return path;
  }

  private async applyImportedTranscript(
    sourcePath: string,
    link: BilibiliVideoLink,
    segments: TranscriptSegment[],
    chinese: readonly string[],
    sourceLabel: string
  ): Promise<void> {
    const sourceFile = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    if (!(sourceFile instanceof TFile)) {
      throw new Error("找不到当前播放器所在的笔记，请重新打开笔记后再试。");
    }
    // 向导中的 srt/vtt 已完成整句整理，文稿行则是用户确认后的真实字幕单位。
    // 这里不能再次合并，否则中英文数组与最终时间轴会错位。
    const transcriptPath = await this.saveTranscript(link, segments, false);
    try {
      if (chinese.some((value) => value.trim() !== "")) {
        await this.saveImportedTranslations(
          transcriptPath,
          link.videoId,
          segments,
          chinese,
          sourceLabel
        );
      }
      await this.noteWriteQueue.run(sourceFile.path, async () => {
        await this.app.vault.process(sourceFile, (markdown) => {
          const updated = addTranscriptToBilibiliStudyBlock(markdown, link, transcriptPath);
          if (updated === null) {
            throw new Error("当前笔记中找不到对应的 B站播放器代码块。");
          }
          return removeVisibleBilibiliLinksFromMarkdown(updated, link).markdown;
        });
      });
    } catch (error) {
      const translationFile = this.app.vault.getAbstractFileByPath(
        normalizePath(getTranslationCachePath(transcriptPath))
      );
      if (translationFile instanceof TFile) {
        await this.app.fileManager.trashFile(translationFile);
      }
      const transcriptFile = this.app.vault.getAbstractFileByPath(transcriptPath);
      if (transcriptFile instanceof TFile) {
        await this.app.fileManager.trashFile(transcriptFile);
      }
      throw error;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = normalizePath(current === "" ? part : `${current}/${part}`);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) {
        throw new Error(`无法创建文字稿文件夹：${current} 已经是一个文件。`);
      }
      if (!(existing instanceof TFolder)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async completeEditorImport(
    editor: Editor,
    view: MarkdownView,
    link: BilibiliVideoLink,
    transcriptPath: string | null
  ): Promise<void> {
    const markdown = editor.getValue();
    if (transcriptPath) {
      const updated = addTranscriptToBilibiliStudyBlock(markdown, link, transcriptPath);
      if (updated !== null) {
        if (updated !== markdown) {
          editor.setValue(updated);
        }
        this.removeVisibleSourceLink(editor, link);
        await this.switchToReadingView(view);
        return;
      }
    }
    if (!this.noteAlreadyContainsVideo(markdown, link)) {
      this.insertStudyBlock(editor, link, transcriptPath ?? undefined);
    } else {
      this.removeVisibleSourceLink(editor, link);
    }
    await this.switchToReadingView(view);
  }

  private insertStudyBlock(
    editor: Editor,
    link: BilibiliVideoLink,
    transcriptPath?: string
  ): void {
    const block = addStudyBlockExitLine(buildBilibiliStudyBlock(link, transcriptPath));
    const source = parseBilibiliLink(link.originalUrl);
    const lines = editor.getValue().split("\n");
    const linkLine = lines.findIndex((line) =>
      extractBilibiliLinks(line).some((candidate) => {
        return this.matchesSourceLink(candidate, link, source);
      })
    );
    if (linkLine >= 0) {
      const originalLine = lines[linkLine] ?? "";
      const cleaned = removeMatchingVideoLinkFromLine(
        originalLine,
        (url) => {
          const candidate = parseBilibiliLink(url);
          return candidate !== null && this.matchesSourceLink(candidate, link, source);
        }
      ).line;
      const replacement = cleaned.trim() === "" ? block : `${cleaned}\n\n${block}`;
      editor.replaceRange(
        replacement,
        { line: linkLine, ch: 0 },
        { line: linkLine, ch: originalLine.length }
      );
      return;
    }

    const cursor = editor.getCursor();
    const prefix = cursor.ch === 0 ? "" : "\n";
    editor.replaceRange(`${prefix}${block}`, cursor);
  }

  private matchesSourceLink(
    candidate: BilibiliLink,
    link: BilibiliVideoLink,
    source: BilibiliLink | null
  ): boolean {
    if (candidate.kind === "video") {
      return sameVideo(candidate, link);
    }
    return source?.kind === "short" && candidate.shortUrl === source.shortUrl;
  }

  private removeVisibleSourceLink(editor: Editor, link: BilibiliVideoLink): boolean {
    const source = parseBilibiliLink(link.originalUrl);
    const lines = editor.getValue().split("\n");
    const lineIndex = lines.findIndex((line) =>
      extractBilibiliLinks(line).some((candidate) =>
        this.matchesSourceLink(candidate, link, source)
      )
    );
    if (lineIndex < 0) {
      return false;
    }
    const originalLine = lines[lineIndex] ?? "";
    const result = removeMatchingVideoLinkFromLine(
      originalLine,
      (url) => {
        const candidate = parseBilibiliLink(url);
        return candidate !== null && this.matchesSourceLink(candidate, link, source);
      }
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

    // 如果命令是在阅读视图中执行，setViewState 可能会复用当前页面，
    // 导致下载前生成的官方 iframe 一直保留。缓存完成后强制重新渲染，
    // 让代码块再次检查本地缓存并切换为带控制栏的本地播放器。
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const readingView = activeView && activeView.file?.path === view.file?.path
      ? activeView
      : view;
    readingView.previewMode.rerender(true);
  }
}
