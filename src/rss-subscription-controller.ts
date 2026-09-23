import { App, getFrontMatterInfo, MarkdownView, normalizePath, parseYaml, requestUrl, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { extractPodcastSourceIdsFromStudyBlocks, extractTranscriptPathsFromStudyBlocks, parseYouTubeLink } from "./import-core";
import type { PodcastCacheService } from "./podcast-cache";
import type { PodcastImportController } from "./podcast-import";
import {
  canonicalFeedUrl,
  escapeSubscriptionNoteTitle,
  parseSubscriptionFeed,
  subscriptionItemKey,
  subscriptionNotePath,
  type RssSubscription,
  type RssSubscriptionData,
  type SubscriptionItem
} from "./rss-subscription-core";
import { RssSubscriptionStore } from "./rss-subscription-store";
import { validateTranscript } from "./transcript-core";
import type { YouTubeImportController } from "./youtube-import";

const MAX_FEED_BYTES = 10 * 1024 * 1024;
export class RssSubscriptionController {
  readonly store: RssSubscriptionStore;

  constructor(
    private readonly app: App,
    private readonly podcastImporter: PodcastImportController,
    private readonly podcastCache: PodcastCacheService,
    private readonly youtubeImporter: YouTubeImportController
  ) {
    this.store = new RssSubscriptionStore(app);
  }

  read(): Promise<RssSubscriptionData> { return this.store.read(); }

  async add(urlInput: string): Promise<RssSubscriptionData> {
    const feed = await this.fetch(canonicalFeedUrl(urlInput));
    return this.store.upsertFeed(feed);
  }

  async refresh(feed: RssSubscription): Promise<RssSubscriptionData> {
    return this.store.upsertFeed(await this.fetch(feed.url));
  }

  remove(id: string): Promise<RssSubscriptionData> { return this.store.removeFeed(id); }

  async openItem(item: SubscriptionItem): Promise<boolean> {
    const key = subscriptionItemKey(item);
    const data = await this.store.read();
    const savedPath = data.imports[key];
    if (savedPath) {
      const file = this.app.vault.getAbstractFileByPath(savedPath);
      if (file instanceof TFile && await this.noteBelongsToItem(file, key)) {
        return this.openImportedNote(file, item);
      }
      const moved = this.findNoteBySource(key);
      if (moved) {
        await this.store.recordImport(key, moved.path);
        return this.openImportedNote(moved, item);
      }
      throw new Error("原学习笔记已移动、删除或路径被其他文件占用；暂不重复创建。请先找到原笔记。");
    }

    const path = subscriptionNotePath(item);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file === null) {
      const moved = this.findNoteBySource(key);
      if (moved) {
        file = moved;
      } else {
        await this.ensureFolder(path);
        const title = escapeSubscriptionNoteTitle(item.title);
        file = await this.app.vault.create(path,
          `---\nlingua-study-source: ${JSON.stringify(key)}\n---\n\n# ${title}\n`);
      }
    }
    if (!(file instanceof TFile)) throw new Error("学习笔记路径已被文件夹占用，未覆盖任何文件。");
    if (!await this.noteBelongsToItem(file, key)) {
      throw new Error("目标笔记已存在但属于其他内容，未覆盖任何文件。");
    }
    const view = await this.openNote(file, true);
    const alreadyImported = await this.noteContainsItem(view.editor.getValue(), item);
    if (alreadyImported) {
      await this.store.recordImport(key, file.path);
      if (item.kind === "podcast" && !await this.podcastCache.getCachedEpisode(item.sourceId)) {
        return this.podcastImporter.importEpisode(view.editor, view, item);
      }
      await this.openNote(file);
      return true;
    }

    const editor = view.editor;
    const lastLine = editor.lineCount() - 1;
    editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
    if (item.kind === "podcast") {
      if (!await this.podcastImporter.importEpisode(editor, view, item)) return false;
    } else {
      const link = parseYouTubeLink(item.url);
      if (!link) throw new Error("订阅条目没有有效的 YouTube 视频链接。");
      await this.youtubeImporter.importLink(editor, view, link);
    }
    if (!await this.noteContainsItem(editor.getValue(), item)) return false;
    await this.store.recordImport(key, file.path);
    return true;
  }

  private async openImportedNote(file: TFile, item: SubscriptionItem): Promise<boolean> {
    if (item.kind === "podcast" && !await this.podcastCache.getCachedEpisode(item.sourceId)) {
      const view = await this.openNote(file, true);
      return this.podcastImporter.importEpisode(view.editor, view, item);
    }
    await this.openNote(file);
    return true;
  }

  private async fetch(url: string): Promise<RssSubscription> {
    const response = await requestUrl({ url, method: "GET", throw: false });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`RSS 请求失败（HTTP ${response.status}）。`);
    }
    if (response.arrayBuffer.byteLength > MAX_FEED_BYTES) {
      throw new Error("RSS 超过 10 MB，已停止读取。");
    }
    return parseSubscriptionFeed(response.text, url);
  }

  private findNoteBySource(key: string): TFile | null {
    return this.app.vault.getMarkdownFiles().find((file) =>
      this.app.metadataCache.getFileCache(file)?.frontmatter?.["lingua-study-source"] === key
    ) ?? null;
  }

  private async noteBelongsToItem(file: TFile, key: string): Promise<boolean> {
    const markdown = await this.app.vault.read(file);
    const info = getFrontMatterInfo(markdown);
    if (!info.exists) return false;
    try {
      const frontmatter = parseYaml(markdown.slice(info.from, info.to)) as unknown;
      return !!frontmatter && typeof frontmatter === "object" &&
        (frontmatter as Record<string, unknown>)["lingua-study-source"] === key;
    } catch {
      return false;
    }
  }

  private async noteContainsItem(markdown: string, item: SubscriptionItem): Promise<boolean> {
    if (item.kind === "podcast") {
      return extractPodcastSourceIdsFromStudyBlocks(markdown).includes(item.sourceId);
    }
    for (const path of extractTranscriptPathsFromStudyBlocks(markdown)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      try {
        const transcript = validateTranscript(JSON.parse(await this.app.vault.read(file)) as unknown);
        if (transcript.videoId === item.id) return true;
      } catch { /* 不把损坏的字幕文件视为成功导入。 */ }
    }
    return false;
  }

  private async openNote(file: TFile, sourceMode = false): Promise<MarkdownView> {
    const existing = this.app.workspace.getLeavesOfType("markdown").find((leaf) =>
      leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path
    );
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.openFile(file);
    if (sourceMode && leaf.view instanceof MarkdownView && leaf.view.getMode() !== "source") {
      const state = leaf.getViewState();
      await leaf.setViewState({ ...state, state: { ...state.state, file: file.path, mode: "source" }, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof MarkdownView)) throw new Error("学习笔记未能打开为 Markdown 视图。");
    return leaf.view;
  }

  private async ensureFolder(filePath: string): Promise<void> {
    let path = "";
    for (const part of filePath.split("/").slice(0, -1)) {
      path = normalizePath(path ? `${path}/${part}` : part);
      const node = this.app.vault.getAbstractFileByPath(path);
      if (node instanceof TFile) throw new Error(`无法创建笔记文件夹：${path} 已经是文件。`);
      if (!(node instanceof TFolder)) await this.app.vault.createFolder(path);
    }
  }
}
