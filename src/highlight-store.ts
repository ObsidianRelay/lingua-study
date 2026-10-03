import { App, normalizePath, TFile, TFolder } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import { replaceRenamedPath } from "./rename-path-core";
import {
  HIGHLIGHT_BOOK_PATH,
  HIGHLIGHT_BOOK_V1_BACKUP_PATH,
  HIGHLIGHT_BOOK_V2_BACKUP_PATH,
  addHighlightAnnotation,
  createEmptyHighlightBook,
  createHighlightAnnotation,
  createStudyHighlightAnnotation,
  migrateHighlightCategory,
  removeHighlightAnnotation,
  resolveHighlightAnchor,
  updateHighlightAnnotation,
  parseHighlightBook,
  type HighlightAnchorInput,
  type HighlightAnnotation,
  type HighlightBookFile,
  type StudyHighlightAnchorInput
} from "./highlight-core";

export interface HighlightBookLoadResult {
  book: HighlightBookFile;
  warning: string | null;
}

export class HighlightStore {
  private readonly writeQueue = new AsyncKeyedQueue();
  private writeBlockedReason: string | null = null;
  private hasSeenFile = false;
  private readonly seenStorageKey = "lingua-study:seen-highlight-book-v1";
  readonly path = normalizePath(HIGHLIGHT_BOOK_PATH);
  readonly legacyBackupPath = normalizePath(HIGHLIGHT_BOOK_V1_BACKUP_PATH);
  readonly v2BackupPath = normalizePath(HIGHLIGHT_BOOK_V2_BACKUP_PATH);

  constructor(
    private readonly app: App,
    private readonly confirmCreate: (path: string, previouslySeen?: boolean) => Promise<boolean> = async () => false
  ) {
    this.hasSeenFile = app.loadLocalStorage(this.seenStorageKey) === true;
  }

  private markFileSeen(): void {
    if (this.hasSeenFile) return;
    this.hasSeenFile = true;
    this.app.saveLocalStorage(this.seenStorageKey, true);
  }

  async load(): Promise<HighlightBookLoadResult> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file === null) {
      return { book: createEmptyHighlightBook(), warning: this.writeBlockedReason ?? (this.hasSeenFile
        ? `高亮笔记文件曾存在但当前缺失。请检查同步；若已主动删除，可用命令“重新建立空高亮笔记”。` : null) };
    }
    if (!(file instanceof TFile)) {
      return {
        book: createEmptyHighlightBook(),
        warning: `高亮笔记路径不是文件：${this.path}`
      };
    }
    this.markFileSeen();
    try {
      return {
        book: parseHighlightBook(JSON.parse(await this.app.vault.cachedRead(file)) as unknown).book,
        warning: this.writeBlockedReason
      };
    } catch {
      return {
        book: createEmptyHighlightBook(),
        warning: `高亮笔记文件格式错误，已停止读取和写入：${this.path}`
      };
    }
  }

  async add(input: HighlightAnchorInput): Promise<HighlightBookFile> {
    return this.mutate((book) => addHighlightAnnotation(
      book,
      createHighlightAnnotation(input)
    ));
  }

  /** 仅由用户明确启动；若同步文件在确认期间出现，则不覆盖。 */
  async recreateMissingFile(): Promise<boolean> {
    return this.writeQueue.run(this.path, async () => {
      if (this.writeBlockedReason) throw new Error(this.writeBlockedReason);
      if (this.app.vault.getAbstractFileByPath(this.path) !== null) return false;
      if (!(await this.confirmCreate(this.path, this.hasSeenFile))) return false;
      if (this.app.vault.getAbstractFileByPath(this.path) !== null) return false;
      await this.ensureParentFolder();
      const serialized = `${JSON.stringify(createEmptyHighlightBook(), null, 2)}\n`;
      await this.app.vault.create(this.path, serialized);
      this.markFileSeen();
      try {
        await this.verifyDiskWrite(serialized);
      } catch (caught) {
        this.writeBlockedReason = caught instanceof Error
          ? caught.message : `高亮笔记写入校验失败：${this.path}`;
        throw new Error(this.writeBlockedReason);
      }
      return true;
    });
  }

  async addStudy(input: StudyHighlightAnchorInput): Promise<HighlightBookFile> {
    return this.mutate((book) => addHighlightAnnotation(book, createStudyHighlightAnnotation(input)));
  }

  async update(
    id: string,
    categoryIds: string[],
    note: string,
    now: Date
  ): Promise<HighlightBookFile> {
    return this.mutate((book) => updateHighlightAnnotation(book, id, { categoryIds, note }, now));
  }

  async remove(id: string): Promise<HighlightBookFile> {
    return this.mutate((book) => removeHighlightAnnotation(book, id));
  }

  async migrateCategory(
    fromCategoryId: string,
    toCategoryId: string,
    now: Date
  ): Promise<HighlightBookFile> {
    return this.mutate((book) =>
      migrateHighlightCategory(book, fromCategoryId, toCategoryId, now)
    );
  }

  async reanchorSegment(
    transcriptPath: string,
    segmentStart: number,
    segmentText: string,
    now: Date
  ): Promise<HighlightBookFile> {
    return this.mutate((book) => {
      let changed = false;
      const updatedAt = now.toISOString();
      const annotations: Record<string, HighlightAnnotation> = {};
      for (const [id, annotation] of Object.entries(book.annotations)) {
        if (
          annotation.transcriptPath !== transcriptPath ||
          annotation.segmentStart !== segmentStart ||
          annotation.targetType !== "transcript"
        ) {
          annotations[id] = annotation;
          continue;
        }
        const resolution = resolveHighlightAnchor(annotation, segmentText);
        if (
          resolution.status === "resolved" &&
          (resolution.startOffset !== annotation.startOffset ||
            resolution.endOffset !== annotation.endOffset)
        ) {
          changed = true;
          annotations[id] = {
            ...annotation,
            startOffset: resolution.startOffset,
            endOffset: resolution.endOffset,
            prefix: segmentText.slice(Math.max(0, resolution.startOffset - 32), resolution.startOffset),
            suffix: segmentText.slice(resolution.endOffset, resolution.endOffset + 32),
            updatedAt
          };
        } else {
          annotations[id] = annotation;
        }
      }
      return changed ? { ...book, annotations } : book;
    });
  }

  async pathsRenamed(oldPath: string, newPath: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return false;
    const raw = await this.app.vault.cachedRead(file);
    const escapedOldPath = JSON.stringify(oldPath).slice(1, -1);
    if (!raw.includes(oldPath) && !raw.includes(escapedOldPath)) return false;
    let changed = false;
    await this.mutate((book) => {
      const annotations = Object.fromEntries(Object.entries(book.annotations).map(([id, annotation]) => {
        const sourcePath = replaceRenamedPath(annotation.sourcePath, oldPath, newPath);
        const transcriptPath = replaceRenamedPath(annotation.transcriptPath, oldPath, newPath);
        if (sourcePath === annotation.sourcePath && transcriptPath === annotation.transcriptPath) {
          return [id, annotation];
        }
        changed = true;
        return [id, { ...annotation, sourcePath, transcriptPath }];
      }));
      return changed ? { ...book, annotations } : book;
    });
    return changed;
  }

  private async mutate(
    change: (book: HighlightBookFile) => HighlightBookFile
  ): Promise<HighlightBookFile> {
    return this.writeQueue.run(this.path, async () => {
      if (this.writeBlockedReason) {
        throw new Error(this.writeBlockedReason);
      }
      let existing = this.app.vault.getAbstractFileByPath(this.path);
      if (existing !== null && !(existing instanceof TFile)) {
        throw new Error(`高亮笔记路径不是文件：${this.path}`);
      }
      let initialOnMissing: HighlightBookFile | null = null;
      if (existing === null) {
        if (this.hasSeenFile) {
          throw new Error(`高亮笔记文件曾存在但当前缺失，已停止写入，请检查同步：${this.path}`);
        }
        const empty = createEmptyHighlightBook();
        initialOnMissing = change(empty);
        if (initialOnMissing === empty) return empty;
        if (!(await this.confirmCreate(this.path))) {
          throw new Error(`未创建高亮笔记；请先确认同步完成：${this.path}`);
        }
        existing = this.app.vault.getAbstractFileByPath(this.path);
        if (existing !== null && !(existing instanceof TFile)) {
          throw new Error(`高亮笔记路径不是文件：${this.path}`);
        }
      }
      let current = createEmptyHighlightBook();
      let migratedFromVersion: 1 | 2 | null = null;
      let originalSerialized: string | null = null;
      if (existing instanceof TFile) {
        this.markFileSeen();
        try {
          originalSerialized = await this.app.vault.read(existing);
          const parsed = parseHighlightBook(JSON.parse(originalSerialized) as unknown);
          current = parsed.book;
          migratedFromVersion = parsed.migratedFromVersion;
        } catch {
          throw new Error(`高亮笔记文件格式错误，已停止写入：${this.path}`);
        }
      }
      const committed = existing === null && initialOnMissing !== null
        ? initialOnMissing : change(current);
      if (committed === current) return current;
      const serialized = `${JSON.stringify(committed, null, 2)}\n`;
      if (existing instanceof TFile) {
        if (migratedFromVersion !== null && originalSerialized !== null) {
          await this.ensureLegacyBackup(originalSerialized, migratedFromVersion);
        }
        await this.app.vault.process(existing, (raw) => {
          if (raw !== originalSerialized) {
            throw new Error("高亮笔记在写入前发生变化，请重试，避免覆盖同步内容。");
          }
          return serialized;
        });
      } else {
        await this.ensureParentFolder();
        await this.app.vault.create(this.path, serialized);
        this.markFileSeen();
      }
      try {
        await this.verifyDiskWrite(serialized);
      } catch (caught) {
        this.writeBlockedReason = caught instanceof Error
          ? caught.message
          : `高亮笔记写入校验失败：${this.path}`;
        throw new Error(this.writeBlockedReason);
      }
      return committed;
    });
  }

  private async ensureLegacyBackup(originalSerialized: string, version: 1 | 2): Promise<void> {
    const path = version === 1 ? this.legacyBackupPath : this.v2BackupPath;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return;
    if (existing !== null) {
      throw new Error(`高亮笔记 v${version} 备份路径不是文件：${path}`);
    }
    await this.ensureParentFolder();
    await this.app.vault.create(path, originalSerialized);
    const existsOnDisk = await this.app.vault.adapter.exists(path);
    if (!existsOnDisk) {
      throw new Error(`高亮笔记 v${version} 备份写入失败：${path}`);
    }
  }

  private async ensureParentFolder(): Promise<void> {
    const parts = this.path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current === "" ? part : `${current}/${part}`;
      const node = this.app.vault.getAbstractFileByPath(current);
      if (node === null) {
        await this.app.vault.createFolder(current);
      } else if (!(node instanceof TFolder)) {
        throw new Error(`无法创建高亮笔记文件夹，路径已被文件占用：${current}`);
      }
    }
  }

  private async verifyDiskWrite(expected: string): Promise<void> {
    const exists = await this.app.vault.adapter.exists(this.path);
    if (!exists) {
      throw new Error(
        `高亮笔记已提交给 Obsidian，但磁盘文件不存在：${this.path}。请检查附件管理或同步插件。`
      );
    }
    const actual = await this.app.vault.adapter.read(this.path);
    if (actual !== expected) {
      throw new Error(
        `高亮笔记写入后内容不一致：${this.path}。已停止继续修改，请检查同步或附件管理插件。`
      );
    }
  }
}
