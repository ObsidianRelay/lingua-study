import { App, Editor, MarkdownView, Modal, Notice, normalizePath, requestUrl, TFile, TFolder } from "obsidian";
import { addStudyBlockExitLine } from "./live-preview-core";
import { buildPodcastStudyBlock, chooseAvailableTranscriptPath, extractPodcastSourceIdsFromStudyBlocks, groupTranscriptSegmentsIntoSentences, parseSubtitleFile, replacePodcastStudyBlockTranscript, sanitizeTranscriptFolder } from "./import-core";
import { confirmLocalWhisperDownload } from "./document-transcript-import";
import { whisperTokensToTranscriptSegments } from "./local-whisper-core";
import type { LocalWhisperService } from "./local-whisper";
import { PodcastCacheService, type CachedPodcastEpisode } from "./podcast-cache";
import { PodcastImportLog } from "./podcast-import-log";
import { parsePodcastFeed, selectEnglishPodcastTranscript, type PodcastEpisode, type PodcastFeed } from "./podcast-rss-core";
import {
  buildApplePodcastLookupUrl,
  buildApplePodcastSearchUrl,
  findSpotifyPodcastEpisode,
  parseApplePodcastCandidates,
  parseApplePodcastFeedUrl,
  parsePodcastSourceInput,
  readSpotifyPodcastMetadata,
  type SpotifyPodcastCandidate
} from "./podcast-source-core";
import type { LinguaStudySettings } from "./settings";
import { validateTranscript, type TranscriptFile, type TranscriptSegment } from "./transcript-core";

const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;
const MAX_CATALOG_BYTES = 1024 * 1024;

class PodcastUrlModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly resolveValue: (value: string | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("导入播客节目");
    this.contentEl.createEl("p", { text: "粘贴播客节目或单集的分享链接，或公开 RSS 地址。" });
    const input = this.contentEl.createEl("input", { type: "url", placeholder: "https://open.spotify.com/episode/…" });
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

class SpotifyPodcastCandidateModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly candidates: SpotifyPodcastCandidate[],
    private readonly isVideo: boolean,
    private readonly resolveValue: (value: SpotifyPodcastCandidate | null) => void
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("确认播客来源");
    this.contentEl.createEl("p", { text: `Spotify 标题：${this.title}` });
    this.contentEl.createEl("p", { text: this.isVideo
      ? "下列是其他平台公开发布的音频版本；Spotify 视频画面不会导入，时间轴也可能不同。请核对节目名称。"
      : "下列是其他平台公开发布的音频版本。请核对节目名称，避免导入同名节目。" });
    const list = this.contentEl.createDiv({ cls: "lingua-study-local-import-list" });
    for (const candidate of this.candidates) {
      list.createEl("button", {
        text: candidate.episodeTitle
          ? `${candidate.episodeTitle} · ${candidate.collectionName}`
          : candidate.collectionName
      }).addEventListener("click", () => this.finish(candidate));
    }
    this.contentEl.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
  }

  onClose(): void { this.contentEl.empty(); if (!this.resolved) this.finish(null); }
  private finish(value: SpotifyPodcastCandidate | null): void {
    if (!this.resolved) { this.resolved = true; this.resolveValue(value); this.close(); }
  }
}

class PodcastEpisodeModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly feed: PodcastFeed, private readonly resolveValue: (value: PodcastEpisode | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.feed.title);
    this.contentEl.createEl("p", { text: this.feed.episodes.length === 1
      ? "确认要导入的单集；点击标题后才会开始缓存音频和生成字幕。"
      : `选择节目（共 ${this.feed.episodes.length} 条）。` });
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

type PodcastTranscriptTimingChoice = "publisher" | "whisper";

class PodcastTranscriptTimingModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly resolveChoice: (choice: PodcastTranscriptTimingChoice | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("这份播客字幕只有整句时间");
    this.contentEl.createEl("p", {
      text: "发布者字幕没有逐词时间。你可以保留发布者原文并按整句高亮，或用本地 Whisper 重新识别音频，生成逐词高亮。识别文字可能与发布者原文不同。"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { cls: "mod-cta", text: "本地识别并逐词高亮" })
      .addEventListener("click", () => this.finish("whisper"));
    actions.createEl("button", { text: "使用发布者字幕（整句）" })
      .addEventListener("click", () => this.finish("publisher"));
    actions.createEl("button", { text: "取消" })
      .addEventListener("click", () => this.finish(null));
  }

  onClose(): void { this.contentEl.empty(); if (!this.resolved) this.finish(null); }
  private finish(choice: PodcastTranscriptTimingChoice | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveChoice(choice);
    this.close();
  }
}

export class PodcastImportController {
  constructor(
    private readonly app: App,
    private readonly cache: PodcastCacheService,
    private readonly localWhisper: LocalWhisperService,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async regenerateTimedTranscript(sourcePath: string, sourceId: string, transcriptPath: string): Promise<void> {
    const note = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    const transcriptFile = this.app.vault.getAbstractFileByPath(normalizePath(transcriptPath));
    if (!(note instanceof TFile) || !(transcriptFile instanceof TFile)) {
      throw new Error("找不到播客笔记或字幕文件，请重新打开笔记后再试。");
    }
    const original = validateTranscript(JSON.parse(await this.app.vault.read(transcriptFile)) as unknown);
    if (original.videoId !== sourceId || !/^en(?:[-_]|$)/iu.test(original.language)) {
      throw new Error("当前字幕不是这集播客的英文字幕。");
    }
    const noteText = await this.app.vault.read(note);
    // 在耗时的本地识别前确认学习块仍指向这份字幕。
    replacePodcastStudyBlockTranscript(noteText, sourceId, transcriptPath, transcriptPath);
    const cached = await this.cache.getCachedEpisode(sourceId);
    if (!cached) throw new Error("找不到已缓存的播客音频，请重新导入该节目。");
    if (!await this.localWhisper.hasCachedModel() && !await confirmLocalWhisperDownload(this.app)) return;

    const progress = new Notice("正在本地生成播客逐词字幕…", 0);
    try {
      const tokens = await this.localWhisper.transcribe(cached, (message) => progress.setMessage(message));
      const segments = whisperTokensToTranscriptSegments(tokens);
      const nextPath = await this.saveTranscript({ ...original, segments });
      await this.app.vault.process(note, (current) =>
        replacePodcastStudyBlockTranscript(current, sourceId, transcriptPath, nextPath));
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath) {
          leaf.view.previewMode.rerender(true);
        }
      }
      new Notice("已生成逐词字幕，原字幕文件已保留。", 7_000);
    } finally {
      progress.hide();
    }
  }

  async importFromEditor(editor: Editor, view: MarkdownView): Promise<void> {
    const url = await new Promise<string | null>((resolve) => new PodcastUrlModal(this.app, resolve).open());
    if (!url) return;
    const log = new PodcastImportLog();
    let progress = new Notice("正在读取播客来源…", 0);
    try {
      const source = parsePodcastSourceInput(url);
      let spotifyCandidate: SpotifyPodcastCandidate | null = null;
      let feedUrl: string;
      if (source.kind === "spotify") {
        progress.setMessage("正在识别 Spotify 播客并查找公开音频源…");
        const spotify = await readSpotifyPodcastMetadata(source, (url, label) => this.getCatalogResponse(url, label));
        const search = await this.getCatalogResponse(
          buildApplePodcastSearchUrl(spotify.title, source.entity), "Apple Podcasts 搜索结果");
        const candidates = parseApplePodcastCandidates(search, spotify.title, source.entity);
        if (candidates.length === 0) {
          throw new Error("未找到同名的公开播客音频。请粘贴该节目的 RSS 地址；仅在 Spotify 提供的内容无法生成本地播放器和字幕。");
        }
        progress.hide();
        spotifyCandidate = await new Promise<SpotifyPodcastCandidate | null>((resolve) =>
          new SpotifyPodcastCandidateModal(this.app, spotify.title, candidates, spotify.isVideo, resolve).open());
        if (!spotifyCandidate) return;
        progress = new Notice("正在读取匹配节目的 RSS…", 0);
        feedUrl = await this.resolveApplePodcastFeedUrl(spotifyCandidate.collectionId, log, progress);
      } else if (source.kind === "apple") {
        feedUrl = await this.resolveApplePodcastFeedUrl(source.collectionId, log, progress);
      } else {
        feedUrl = source.feedUrl;
      }
      await log.write("start", `读取 RSS：${new URL(feedUrl).origin}`);
      const feedResponse = await requestUrl({ url: feedUrl, method: "GET", throw: false });
      if (feedResponse.status < 200 || feedResponse.status >= 300) throw new Error(`播客 RSS 请求失败（HTTP ${feedResponse.status}）。`);
      if (feedResponse.arrayBuffer.byteLength > MAX_FEED_BYTES) throw new Error("播客 RSS 超过 10 MB，已停止读取。");
      const feed = parsePodcastFeed(feedResponse.text, feedUrl);
      await log.write("feed", `解析成功，节目数 ${feed.episodes.length}`);
      progress.hide();
      const matchedEpisode = spotifyCandidate?.episodeTitle
        ? feed.episodes[findSpotifyPodcastEpisode(feed.episodes, spotifyCandidate)] ?? null : null;
      if (spotifyCandidate?.episodeTitle && !matchedEpisode) {
        throw new Error("已找到节目 RSS，但里面没有可确认的这集音频。请改用节目 RSS 选择单集。");
      }
      const selectableFeed = matchedEpisode ? { ...feed, episodes: [matchedEpisode] } : feed;
      const episode = await new Promise<PodcastEpisode | null>((resolve) =>
        new PodcastEpisodeModal(this.app, selectableFeed, resolve).open());
      if (!episode) return;
      await this.importEpisode(editor, view, episode);
    } catch (error) {
      progress.hide();
      const message = error instanceof Error ? error.message : "Podcast RSS 导入失败。";
      await log.write("error", error instanceof Error && error.stack ? `${message}\n${error.stack}` : message);
      new Notice(message, 9_000);
    }
  }

  private async getCatalogResponse(url: string, label: string): Promise<string> {
    const response = await requestUrl({ url, method: "GET", throw: false });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${label}读取失败（HTTP ${response.status}）。请改用公开 RSS 地址。`);
    }
    if (response.arrayBuffer.byteLength > MAX_CATALOG_BYTES) {
      throw new Error(`${label}超过 1 MB，已停止读取。`);
    }
    return response.text;
  }

  async importEpisode(editor: Editor, view: MarkdownView, episode: PodcastEpisode): Promise<boolean> {
    const log = new PodcastImportLog();
    const progress = new Notice("正在准备播客节目…", 0);
    try {
      await log.write("episode", `已选择 ${episode.sourceId}：${episode.title}`);
      if (extractPodcastSourceIdsFromStudyBlocks(editor.getValue()).includes(episode.sourceId)) {
        if (!await this.cache.getCachedEpisode(episode.sourceId)) {
          await this.cache.cacheEpisode(episode, (message) => progress.setMessage(message));
          new Notice("播客音频缓存已恢复，原学习笔记保持不变。", 6_000);
        } else {
          new Notice("当前笔记已经有这个播客节目，未重复创建学习内容。", 5_000);
        }
        await this.switchToReadingView(view);
        return true;
      }
      const cached = await this.cache.cacheEpisode(episode, (message) => progress.setMessage(message));
      await log.write("cache", cached.reused ? "复用已有音频缓存" : "音频缓存完成");
      const segments = await this.resolveTranscript(episode, cached.cached, (message) => progress.setMessage(message), log);
      progress.setMessage("正在保存英文字幕…");
      const transcriptPath = await this.saveTranscript({
        version: 1,
        videoId: episode.sourceId,
        sourceUrl: episode.enclosureUrl,
        language: "en",
        segments
      });
      await log.write("transcript", `已保存 ${transcriptPath}，共 ${segments.length} 条`);
      editor.replaceRange(
        `${editor.getCursor().ch === 0 ? "" : "\n"}${addStudyBlockExitLine(buildPodcastStudyBlock({ sourceId: episode.sourceId, transcriptPath }))}`,
        editor.getCursor()
      );
      await this.switchToReadingView(view);
      progress.hide();
      await log.write("complete", "已创建学习块");
      new Notice(`已创建播客学习内容：${episode.title}。`, 7_000);
      return true;
    } catch (error) {
      progress.hide();
      const message = error instanceof Error ? error.message : "Podcast RSS 导入失败。";
      await log.write("error", error instanceof Error && error.stack ? `${message}\n${error.stack}` : message);
      new Notice(message, 9_000);
      return false;
    } finally {
      progress.hide();
    }
  }

  private async resolveApplePodcastFeedUrl(
    collectionId: string,
    log: PodcastImportLog,
    progress: Notice
  ): Promise<string> {
    progress.setMessage("正在从 Apple Podcasts 查找节目 RSS…");
    await log.write("apple", `解析 Apple Podcasts 节目 ${collectionId}`);
    const response = await requestUrl({
      url: buildApplePodcastLookupUrl(collectionId),
      method: "GET",
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Apple Podcasts 查询失败（HTTP ${response.status}）。请改为粘贴 RSS 地址。`);
    }
    const feedUrl = parseApplePodcastFeedUrl(response.text);
    await log.write("apple", `已找到 RSS：${new URL(feedUrl).origin}`);
    return feedUrl;
  }

  private async resolveTranscript(episode: PodcastEpisode, cached: CachedPodcastEpisode, onProgress: (message: string) => void, log: PodcastImportLog): Promise<TranscriptSegment[]> {
    const reference = selectEnglishPodcastTranscript(episode.transcripts);
    if (reference && /(?:vtt|srt)/u.test(reference.type ?? reference.url)) {
      await log.write("publisher-transcript", "尝试读取发布者英文字幕");
      onProgress("正在读取发布者英文字幕…");
      const response = await requestUrl({ url: reference.url, method: "GET", throw: false });
      if (response.status >= 200 && response.status < 300 && response.arrayBuffer.byteLength <= MAX_TRANSCRIPT_BYTES) {
        const parsed = groupTranscriptSegmentsIntoSentences(parseSubtitleFile(response.text));
        if (parsed.length > 0) {
          await log.write("publisher-transcript", `读取成功，共 ${parsed.length} 条`);
          if (parsed.every((segment) => segment.words?.length)) return parsed;
          onProgress("发布者字幕只有整句时间，请选择字幕方式…");
          const choice = await new Promise<PodcastTranscriptTimingChoice | null>((resolve) =>
            new PodcastTranscriptTimingModal(this.app, resolve).open());
          if (choice === "publisher") return parsed;
          if (!choice) throw new Error("已取消播客导入。");
          await log.write("publisher-transcript", "选择本地 Whisper 生成逐词字幕");
        }
      } else {
        new Notice("发布者英文字幕不可用，已改用本地 Whisper。", 6_000);
      }
    }
    if (!await this.localWhisper.hasCachedModel() && !await confirmLocalWhisperDownload(this.app)) {
      throw new Error("尚未下载本地 Whisper 模型，已取消播客导入。");
    }
    await log.write("whisper", "开始本地 Whisper：模型已就绪，正在解码音频");
    const media = cached ?? await this.cache.getCachedEpisode(episode.sourceId);
    if (!media) throw new Error("播客缓存丢失，请重新导入节目。");
    const tokens = await this.localWhisper.transcribe(media, onProgress);
    await log.write("whisper", `识别完成，返回 ${tokens.length} 个词级时间点`);
    return whisperTokensToTranscriptSegments(tokens);
  }

  private async saveTranscript(transcript: TranscriptFile): Promise<string> {
    const validated = validateTranscript(transcript);
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    await this.ensureFolder(folder);
    const target = chooseAvailableTranscriptPath(folder, validated.videoId, (candidate) => this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null);
    const path = normalizePath(target.path);
    await this.app.vault.create(path, `${JSON.stringify(validated, null, 2)}\n`);
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
