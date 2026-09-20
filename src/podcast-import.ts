import { App, Editor, MarkdownView, Modal, Notice, normalizePath, requestUrl, TFile, TFolder } from "obsidian";
import { addStudyBlockExitLine } from "./live-preview-core";
import { buildPodcastStudyBlock, chooseAvailableTranscriptPath, extractPodcastSourceIdsFromStudyBlocks, groupTranscriptSegmentsIntoSentences, parseSubtitleFile, sanitizeTranscriptFolder } from "./import-core";
import { confirmLocalWhisperDownload } from "./document-transcript-import";
import { whisperTokensToTranscriptSegments } from "./local-whisper-core";
import type { LocalWhisperService } from "./local-whisper";
import { PodcastCacheService, type CachedPodcastEpisode } from "./podcast-cache";
import { parsePodcastFeed, selectEnglishPodcastTranscript, type PodcastEpisode, type PodcastFeed } from "./podcast-rss-core";
import type { LinguaStudySettings } from "./settings";
import { validateTranscript, type TranscriptSegment } from "./transcript-core";

const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

class PodcastUrlModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly resolveValue: (value: string | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("导入 podcast RSS");
    this.contentEl.createEl("p", { text: "粘贴公开播客 RSS 或 atom feed 地址。" });
    const input = this.contentEl.createEl("input", { type: "url", placeholder: "https://example.com/podcast.xml" });
    input.focus();
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
    const submit = actions.createEl("button", { cls: "mod-cta", text: "读取节目" });
    submit.addEventListener("click", () => this.finish(input.value.trim() || null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); this.finish(input.value.trim() || null); }
    });
  }

  onClose(): void { this.contentEl.empty(); if (!this.resolved) this.finish(null); }
  private finish(value: string | null): void { if (!this.resolved) { this.resolved = true; this.resolveValue(value); this.close(); } }
}

class PodcastEpisodeModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly feed: PodcastFeed, private readonly resolveValue: (value: PodcastEpisode | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.feed.title);
    this.contentEl.createEl("p", { text: `选择节目（共 ${this.feed.episodes.length} 条）。` });
    const list = this.contentEl.createDiv({ cls: "lingua-study-local-import-list" });
    for (const episode of this.feed.episodes) {
      const button = list.createEl("button", { text: episode.publishedAt ? `${episode.title} · ${episode.publishedAt}` : episode.title });
      button.addEventListener("click", () => this.finish(episode));
    }
    this.contentEl.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
  }

  onClose(): void { this.contentEl.empty(); if (!this.resolved) this.finish(null); }
  private finish(value: PodcastEpisode | null): void { if (!this.resolved) { this.resolved = true; this.resolveValue(value); this.close(); } }
}

export class PodcastImportController {
  constructor(
    private readonly app: App,
    private readonly cache: PodcastCacheService,
    private readonly localWhisper: LocalWhisperService,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async importFromEditor(editor: Editor, view: MarkdownView): Promise<void> {
    const url = await new Promise<string | null>((resolve) => new PodcastUrlModal(this.app, resolve).open());
    if (!url) return;
    let progress = new Notice("正在读取播客 RSS…", 0);
    try {
      const feedResponse = await requestUrl({ url, method: "GET", throw: false });
      if (feedResponse.status < 200 || feedResponse.status >= 300) throw new Error(`播客 RSS 请求失败（HTTP ${feedResponse.status}）。`);
      if (feedResponse.arrayBuffer.byteLength > MAX_FEED_BYTES) throw new Error("播客 RSS 超过 10 MB，已停止读取。");
      const feed = parsePodcastFeed(feedResponse.text, url);
      progress.hide();
      const episode = await new Promise<PodcastEpisode | null>((resolve) => new PodcastEpisodeModal(this.app, feed, resolve).open());
      if (!episode) return;
      if (extractPodcastSourceIdsFromStudyBlocks(editor.getValue()).includes(episode.sourceId)) {
        throw new Error("当前笔记已经有这个播客节目，未重复创建学习内容。");
      }
      progress = new Notice("正在准备播客节目…", 0);
      const cached = await this.cache.cacheEpisode(episode, (message) => progress.setMessage(message));
      const segments = await this.resolveTranscript(episode, cached.cached, (message) => progress.setMessage(message));
      progress.setMessage("正在保存英文字幕…");
      const transcriptPath = await this.saveTranscript(episode, segments);
      editor.replaceRange(
        `${editor.getCursor().ch === 0 ? "" : "\n"}${addStudyBlockExitLine(buildPodcastStudyBlock({ sourceId: episode.sourceId, transcriptPath }))}`,
        editor.getCursor()
      );
      await this.switchToReadingView(view);
      progress.hide();
      new Notice(`已创建播客学习内容：${episode.title}。`, 7_000);
    } catch (error) {
      progress.hide();
      new Notice(error instanceof Error ? error.message : "Podcast RSS 导入失败。", 9_000);
    }
  }

  private async resolveTranscript(episode: PodcastEpisode, cached: CachedPodcastEpisode, onProgress: (message: string) => void): Promise<TranscriptSegment[]> {
    const reference = selectEnglishPodcastTranscript(episode.transcripts);
    if (reference && /(?:vtt|srt)/u.test(reference.type ?? reference.url)) {
      onProgress("正在读取发布者英文字幕…");
      const response = await requestUrl({ url: reference.url, method: "GET", throw: false });
      if (response.status >= 200 && response.status < 300 && response.arrayBuffer.byteLength <= MAX_TRANSCRIPT_BYTES) {
        const parsed = groupTranscriptSegmentsIntoSentences(parseSubtitleFile(response.text));
        if (parsed.length > 0) return parsed;
      }
      new Notice("发布者英文字幕不可用，已改用本地 Whisper。", 6_000);
    }
    if (!await this.localWhisper.hasCachedModel() && !await confirmLocalWhisperDownload(this.app)) {
      throw new Error("尚未下载本地 Whisper 模型，已取消播客导入。");
    }
    const media = cached ?? await this.cache.getCachedEpisode(episode.sourceId);
    if (!media) throw new Error("播客缓存丢失，请重新导入节目。");
    const tokens = await this.localWhisper.transcribe(media, onProgress);
    return whisperTokensToTranscriptSegments(tokens);
  }

  private async saveTranscript(episode: PodcastEpisode, segments: TranscriptSegment[]): Promise<string> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    await this.ensureFolder(folder);
    const target = chooseAvailableTranscriptPath(folder, episode.sourceId, (candidate) => this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null);
    const path = normalizePath(target.path);
    const transcript = validateTranscript({ version: 1, videoId: episode.sourceId, sourceUrl: episode.enclosureUrl, language: "en", segments });
    await this.app.vault.create(path, `${JSON.stringify(transcript, null, 2)}\n`);
    return path;
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = normalizePath(current === "" ? part : `${current}/${part}`);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`无法创建字幕文件夹：${current} 已经是文件。`);
      if (!(existing instanceof TFolder)) await this.app.vault.createFolder(current);
    }
  }

  private async switchToReadingView(view: MarkdownView): Promise<void> {
    const state = view.leaf.getViewState();
    await view.leaf.setViewState({ ...state, state: { ...state.state, mode: "preview" }, active: true });
    view.previewMode.rerender(true);
  }
}
