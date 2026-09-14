import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  normalizePath,
  TFile,
  TFolder
} from "obsidian";
import type { BilibiliCacheService } from "./bilibili-cache";
import {
  buildLocalVideoStudyBlock,
  chooseAvailableTranscriptPath,
  extractLocalVideoIdsFromStudyBlocks,
  groupTranscriptSegmentsIntoSentences,
  parseSubtitleFile,
  replaceLocalVideoPathInStudyBlock,
  sanitizeTranscriptFolder
} from "./import-core";
import {
  findMatchingLocalSubtitleNames,
  isSupportedLocalSubtitlePath,
  isSupportedLocalVideoPath
} from "./local-video-core";
import { addStudyBlockExitLine } from "./live-preview-core";
import type { LinguaStudySettings } from "./settings";
import { validateTranscript, type TranscriptFile } from "./transcript-core";

const MAX_LOCAL_SUBTITLE_BYTES = 10 * 1024 * 1024;

interface ElectronDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronDialogLike {
  showOpenDialog: (options: Record<string, unknown>) => Promise<ElectronDialogResult>;
}

interface ElectronRemoteLike {
  dialog?: ElectronDialogLike;
}

interface LocalVideoImportChoice {
  videoPath: string;
  subtitlePath: string;
}

type LocalVideoSourceChoice = "file" | "folder";

function loadDesktopDialog(): ElectronDialogLike | null {
  try {
    const electron = require("electron") as { remote?: ElectronRemoteLike };
    if (electron.remote?.dialog) {
      return electron.remote.dialog;
    }
  } catch {
    // 继续尝试 Obsidian 桌面端内置的 @electron/remote。
  }
  try {
    const remote = require("@electron/remote") as ElectronRemoteLike;
    return remote.dialog ?? null;
  } catch {
    return null;
  }
}

async function selectFile(
  title: string,
  extensions: string[],
  defaultPath?: string
): Promise<string | null> {
  const dialog = loadDesktopDialog();
  if (!dialog) {
    throw new Error("当前 Obsidian 无法打开系统文件选择器。");
  }
  const result = await dialog.showOpenDialog({
    title,
    ...(defaultPath ? { defaultPath } : {}),
    properties: ["openFile"],
    filters: [{
      name: extensions.map((value) => value.toUpperCase()).join(" / "),
      extensions
    }]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function selectDirectory(title: string): Promise<string | null> {
  const dialog = loadDesktopDialog();
  if (!dialog) {
    throw new Error("当前 Obsidian 无法打开系统文件选择器。");
  }
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

class LocalVideoSourceModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly resolveValue: (choice: LocalVideoSourceChoice | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("导入本地视频");
    this.contentEl.createEl("p", {
      text: "选择一个本地视频，或扫描文件夹中的全部视频与同名字幕。"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { cls: "mod-cta", text: "选择视频" })
      .addEventListener("click", () => this.finish("file"));
    actions.createEl("button", { text: "选择文件夹" })
      .addEventListener("click", () => this.finish("folder"));
    actions.createEl("button", { text: "取消" })
      .addEventListener("click", () => this.finish(null));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private finish(value: LocalVideoSourceChoice | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

class LocalVideoImportModal extends Modal {
  private selectedSubtitlePath: string | null;
  private resolved = false;

  constructor(
    app: App,
    private readonly videoPath: string,
    private subtitleCandidates: string[],
    private readonly chooseSubtitle: () => Promise<string | null>,
    private readonly resolveValue: (choice: LocalVideoImportChoice | null) => void
  ) {
    super(app);
    this.selectedSubtitlePath = subtitleCandidates[0] ?? null;
  }

  onOpen(): void {
    this.renderContent();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private renderContent(): void {
    this.titleEl.setText("导入本地视频");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "视频保持在原文件夹中，不会复制到 Obsidian 仓库。"
    });
    const video = this.contentEl.createDiv({ cls: "lingua-study-local-import-file" });
    video.createEl("strong", { text: "视频：" });
    video.createSpan({ text: basename(this.videoPath) });
    video.createEl("small", { text: this.videoPath });

    const subtitle = this.contentEl.createDiv({ cls: "lingua-study-local-import-file" });
    subtitle.createEl("strong", { text: "字幕：" });
    if (this.subtitleCandidates.length > 0) {
      const select = subtitle.createEl("select");
      for (const path of this.subtitleCandidates) {
        const option = select.createEl("option", {
          text: basename(path),
          value: path
        });
        option.selected = path === this.selectedSubtitlePath;
      }
      select.addEventListener("change", () => {
        this.selectedSubtitlePath = select.value;
      });
    } else {
      subtitle.createSpan({ text: "没有找到同名 SRT/VTT 字幕" });
    }

    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const chooseButton = actions.createEl("button", { text: "选择其他字幕" });
    chooseButton.addEventListener("click", () => {
      chooseButton.disabled = true;
      void this.chooseSubtitle().then((path) => {
        if (path) {
          this.subtitleCandidates = [path, ...this.subtitleCandidates.filter((item) => item !== path)];
          this.selectedSubtitlePath = path;
          this.renderContent();
        } else {
          chooseButton.disabled = false;
        }
      }).catch((error: unknown) => {
        chooseButton.disabled = false;
        new Notice(error instanceof Error ? error.message : "无法选择字幕文件。", 6_000);
      });
    });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
    const confirm = actions.createEl("button", { cls: "mod-cta", text: "生成学习资料" });
    confirm.disabled = this.selectedSubtitlePath === null;
    confirm.addEventListener("click", () => {
      if (!this.selectedSubtitlePath) {
        return;
      }
      this.finish({ videoPath: this.videoPath, subtitlePath: this.selectedSubtitlePath });
    });
  }

  private finish(value: LocalVideoImportChoice | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

class LocalVideoFolderImportModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly folderPath: string,
    private readonly matches: LocalVideoImportChoice[],
    private readonly unmatchedCount: number,
    private readonly resolveValue: (choices: LocalVideoImportChoice[] | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("确认批量导入");
    this.contentEl.createEl("p", {
      text: `找到 ${this.matches.length} 组视频与字幕${this.unmatchedCount > 0 ? `，另有 ${this.unmatchedCount} 个 MP4 没有同名字幕` : ""}。`
    });
    const list = this.contentEl.createDiv({ cls: "lingua-study-local-import-list" });
    for (const match of this.matches) {
      const row = list.createDiv({ cls: "lingua-study-local-import-pair" });
      row.createSpan({ text: basename(match.videoPath) });
      row.createSpan({ text: basename(match.subtitlePath) });
    }
    if (this.matches.length === 0) {
      list.createDiv({
        text: "没有可导入的组合。请让视频与字幕使用相同文件名，例如 S01E01.mp4 和 S01E01.en.srt。"
      });
    }
    const path = this.contentEl.createEl("small", { text: this.folderPath });
    path.addClass("lingua-study-local-import-path");
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.finish(null));
    const confirm = actions.createEl("button", { cls: "mod-cta", text: "批量生成学习资料" });
    confirm.disabled = this.matches.length === 0;
    confirm.addEventListener("click", () => this.finish(this.matches));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(null);
    }
  }

  private finish(value: LocalVideoImportChoice[] | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

export class LocalVideoImportController {
  constructor(
    private readonly app: App,
    private readonly mediaService: BilibiliCacheService,
    private readonly getSettings: () => LinguaStudySettings
  ) {}

  async importFromEditor(editor: Editor, view: MarkdownView): Promise<void> {
    try {
      const source = await new Promise<LocalVideoSourceChoice | null>((resolve) => {
        new LocalVideoSourceModal(this.app, resolve).open();
      });
      if (source === "folder") {
        await this.importFolder(editor, view);
        return;
      }
      if (source !== "file") {
        return;
      }
      const videoPath = await selectFile("选择本地 MP4 视频", ["mp4"]);
      if (!videoPath) {
        return;
      }
      await this.validateVideoPath(videoPath);
      const subtitleCandidates = await this.findSubtitleCandidates(videoPath);
      const choice = await new Promise<LocalVideoImportChoice | null>((resolve) => {
        new LocalVideoImportModal(
          this.app,
          videoPath,
          subtitleCandidates,
          () => selectFile("选择 SRT 或 VTT 字幕", ["srt", "vtt"], dirname(videoPath)),
          resolve
        ).open();
      });
      if (!choice) {
        return;
      }
      await this.createLearningMaterials(editor, view, [choice]);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "本地视频导入失败。", 8_000);
    }
  }

  async relinkVideo(sourcePath: string, localId: string): Promise<void> {
    const videoPath = await selectFile("重新选择本地 MP4 视频", ["mp4"]);
    if (!videoPath) {
      return;
    }
    await this.validateVideoPath(videoPath);
    const sourceFile = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    if (!(sourceFile instanceof TFile)) {
      throw new Error("找不到当前学习笔记，无法更新视频路径。");
    }
    await this.app.vault.process(sourceFile, (markdown) => {
      const updated = replaceLocalVideoPathInStudyBlock(markdown, localId, videoPath);
      if (updated === null) {
        throw new Error("当前笔记中找不到对应的本地视频代码块。");
      }
      return updated;
    });
    this.rerenderNote(sourceFile.path);
    new Notice("本地视频路径已更新。", 4_000);
  }

  async exposeVideo(filePath: string, localId: string) {
    return this.mediaService.exposeExternalMp4(filePath, localId);
  }

  private async importFolder(editor: Editor, view: MarkdownView): Promise<void> {
    const folderPath = await selectDirectory("选择包含 MP4 和字幕的文件夹");
    if (!folderPath) {
      return;
    }
    const entries = await readdir(folderPath, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const videos = fileNames.filter(isSupportedLocalVideoPath).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    );
    const matches: LocalVideoImportChoice[] = [];
    let unmatchedCount = 0;
    for (const videoName of videos) {
      const subtitleName = findMatchingLocalSubtitleNames(videoName, fileNames)[0];
      if (!subtitleName) {
        unmatchedCount += 1;
        continue;
      }
      matches.push({
        videoPath: join(folderPath, videoName),
        subtitlePath: join(folderPath, subtitleName)
      });
    }
    const confirmed = await new Promise<LocalVideoImportChoice[] | null>((resolve) => {
      new LocalVideoFolderImportModal(
        this.app,
        folderPath,
        matches,
        unmatchedCount,
        resolve
      ).open();
    });
    if (confirmed) {
      await this.createLearningMaterials(editor, view, confirmed);
    }
  }

  private async createLearningMaterials(
    editor: Editor,
    view: MarkdownView,
    choices: LocalVideoImportChoice[]
  ): Promise<void> {
    const progress = new Notice("正在读取本地字幕并生成学习资料…", 0);
    const existingIds = new Set(extractLocalVideoIdsFromStudyBlocks(editor.getValue()));
    const prepared: Array<{
      choice: LocalVideoImportChoice;
      localId: string;
      segments: TranscriptFile["segments"];
    }> = [];
    const createdTranscriptPaths: string[] = [];
    let blocksInserted = false;
    try {
      for (const choice of choices) {
        await this.validateVideoPath(choice.videoPath);
        const localId = createHash("sha256")
          .update(choice.videoPath)
          .digest("base64url")
          .slice(0, 11);
        if (existingIds.has(localId)) {
          continue;
        }
        prepared.push({
          choice,
          localId,
          segments: groupTranscriptSegmentsIntoSentences(
            parseSubtitleFile(await this.readSubtitle(choice.subtitlePath))
          )
        });
      }
      if (prepared.length === 0) {
        throw new Error("所选视频都已存在于当前笔记，未重复导入。");
      }
      const blocks: string[] = [];
      let segmentCount = 0;
      for (const item of prepared) {
        const transcriptPath = await this.saveTranscript(item.localId, item.segments);
        createdTranscriptPaths.push(transcriptPath);
        blocks.push(buildLocalVideoStudyBlock({
          localId: item.localId,
          videoPath: item.choice.videoPath,
          transcriptPath
        }));
        segmentCount += item.segments.length;
      }
      const cursor = editor.getCursor();
      const blockText = addStudyBlockExitLine(blocks.join("\n\n"));
      editor.replaceRange(`${cursor.ch === 0 ? "" : "\n"}${blockText}`, cursor);
      blocksInserted = true;
      await this.switchToReadingView(view);
      progress.hide();
      new Notice(
        `已生成 ${prepared.length} 个本地视频学习块，共 ${segmentCount} 条英文字幕。`,
        7_000
      );
    } catch (error) {
      progress.hide();
      if (!blocksInserted) {
        for (const path of createdTranscriptPaths) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file).catch(() => undefined);
          }
        }
      }
      throw error;
    }
  }

  private async validateVideoPath(path: string): Promise<void> {
    if (!isAbsolute(path) || !isSupportedLocalVideoPath(path)) {
      throw new Error("目前只支持电脑中的 MP4 视频文件。");
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      throw new Error("选择的 MP4 视频不存在或无法读取。");
    }
  }

  private async findSubtitleCandidates(videoPath: string): Promise<string[]> {
    const folder = dirname(videoPath);
    const entries = await readdir(folder, { withFileTypes: true });
    return findMatchingLocalSubtitleNames(
      videoPath,
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    ).map((name) => join(folder, name));
  }

  private async readSubtitle(path: string): Promise<string> {
    if (!isAbsolute(path) || !isSupportedLocalSubtitlePath(path)) {
      throw new Error("字幕必须是 SRT 或 VTT 文件。");
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      throw new Error("选择的字幕不存在或无法读取。");
    }
    if (info.size > MAX_LOCAL_SUBTITLE_BYTES) {
      throw new Error("字幕文件超过 10 MB，已停止读取。");
    }
    const bytes = await readFile(path);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("字幕不是有效的 UTF-8 文本，请转换编码后再导入。");
    }
  }

  private async saveTranscript(
    localId: string,
    segments: TranscriptFile["segments"]
  ): Promise<string> {
    const folder = sanitizeTranscriptFolder(this.getSettings().transcriptFolder);
    await this.ensureFolder(folder);
    const target = chooseAvailableTranscriptPath(folder, `local-${localId}`, (candidate) =>
      this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null
    );
    const transcript = validateTranscript({
      version: 1,
      videoId: localId,
      sourceUrl: `lingua-local://${localId}`,
      language: "en",
      segments
    });
    const path = normalizePath(target.path);
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

  private async switchToReadingView(view: MarkdownView): Promise<void> {
    const state = view.leaf.getViewState();
    await view.leaf.setViewState({
      ...state,
      state: { ...state.state, mode: "preview" },
      active: true
    });
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const readingView = active && active.file?.path === view.file?.path ? active : view;
    readingView.previewMode.rerender(true);
  }

  private rerenderNote(sourcePath: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath) {
        leaf.view.previewMode.rerender(true);
      }
    }
  }
}
