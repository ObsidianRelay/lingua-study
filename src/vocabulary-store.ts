import { App, normalizePath, TFile, TFolder } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import { replaceRenamedPath } from "./rename-path-core";
import { ensureRecoveryBackup } from "./recovery-backup";
import {
  VOCABULARY_BOOK_PATH,
  VOCABULARY_BOOK_VERSION,
  addVocabularyEntry,
  createEmptyVocabularyBook,
  introduceVocabularyEntry,
  rateVocabularyEntry,
  recoverVocabularyBook,
  removeVocabularyEntry,
  updateVocabularyEntry,
  updateVocabularyNote,
  type ReviewRating,
  type VocabularyAddInput,
  type VocabularyBookFile,
  type VocabularyEditInput
} from "./vocabulary-core";

export interface VocabularyBookLoadResult {
  book: VocabularyBookFile;
  warning: string | null;
}

export class VocabularyStore {
  private readonly writeQueue = new AsyncKeyedQueue();
  private hasSeenFile = false;
  private readonly seenStorageKey = "lingua-study:seen-vocabulary-book-v1";
  readonly path = normalizePath(VOCABULARY_BOOK_PATH);

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

  async load(): Promise<VocabularyBookLoadResult> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file === null) {
      return { book: createEmptyVocabularyBook(), warning: this.hasSeenFile
        ? `生词本文件曾存在但当前缺失。请检查同步；若已主动删除，可用命令“重新建立空生词本”。` : null };
    }
    if (!(file instanceof TFile)) {
      return { book: createEmptyVocabularyBook(), warning: `生词本路径不是文件：${this.path}` };
    }
    this.markFileSeen();
    try {
      const recovered = recoverVocabularyBook(JSON.parse(await this.app.vault.cachedRead(file)) as unknown);
      const invalidCount = Object.keys(recovered.invalidEntries).length;
      return {
        book: recovered.book,
        warning: invalidCount > 0
          ? `生词本有 ${invalidCount} 条格式错误的词条；可读取其余词条，下一次写入前会保存原文件和坏条目。`
          : null
      };
    } catch {
      return {
        book: createEmptyVocabularyBook(),
        warning: `生词本格式错误，已停止读取：${this.path}`
      };
    }
  }

  async add(input: VocabularyAddInput): Promise<VocabularyBookFile> {
    return this.mutate((book) => addVocabularyEntry(book, input).book);
  }

  /** 用户主动发起的空库重建；写入队列和二次检查避免覆盖同步到达的文件。 */
  async recreateMissingFile(): Promise<boolean> {
    return this.writeQueue.run(this.path, async () => {
      if (this.app.vault.getAbstractFileByPath(this.path) !== null) return false;
      if (!(await this.confirmCreate(this.path, this.hasSeenFile))) return false;
      if (this.app.vault.getAbstractFileByPath(this.path) !== null) return false;
      await this.ensureParentFolder();
      await this.app.vault.create(this.path, `${JSON.stringify(createEmptyVocabularyBook(), null, 2)}\n`);
      this.markFileSeen();
      return true;
    });
  }

  async remove(id: string): Promise<VocabularyBookFile> {
    return this.mutate((book) => removeVocabularyEntry(book, id));
  }

  async updateNote(id: string, note: string): Promise<VocabularyBookFile> {
    return this.mutate((book) => updateVocabularyNote(book, id, note));
  }

  async update(id: string, input: VocabularyEditInput): Promise<VocabularyBookFile> {
    return this.mutate((book) => updateVocabularyEntry(book, id, input));
  }

  async introduce(id: string, now: Date): Promise<VocabularyBookFile> {
    return this.mutate((book) => introduceVocabularyEntry(book, id, now));
  }

  async rate(
    id: string,
    rating: ReviewRating,
    now: Date,
    requestRetention: number
  ): Promise<VocabularyBookFile> {
    return this.mutate((book) =>
      rateVocabularyEntry(book, id, rating, now, requestRetention)
    );
  }

  async pathsRenamed(oldPath: string, newPath: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return false;
    const raw = await this.app.vault.cachedRead(file);
    const escapedOldPath = JSON.stringify(oldPath).slice(1, -1);
    if (!raw.includes(oldPath) && !raw.includes(escapedOldPath)) return false;
    const current = recoverVocabularyBook(JSON.parse(raw) as unknown).book;
    const hasMatchingContext = Object.values(current.entries).some((entry) =>
      entry.contexts.some((context) =>
        replaceRenamedPath(context.sourcePath, oldPath, newPath) !== context.sourcePath ||
        replaceRenamedPath(context.transcriptPath, oldPath, newPath) !== context.transcriptPath));
    if (!hasMatchingContext) return false;
    let changed = false;
    await this.mutate((book) => {
      const entries = Object.fromEntries(Object.entries(book.entries).map(([id, entry]) => {
        const contexts = entry.contexts.map((context) => {
          const sourcePath = replaceRenamedPath(context.sourcePath, oldPath, newPath);
          const transcriptPath = replaceRenamedPath(context.transcriptPath, oldPath, newPath);
          if (sourcePath === context.sourcePath && transcriptPath === context.transcriptPath) return context;
          changed = true;
          return { ...context, sourcePath, transcriptPath };
        });
        return [id, contexts.some((context, index) => context !== entry.contexts[index])
          ? { ...entry, contexts } : entry];
      }));
      return changed ? { ...book, entries } : book;
    });
    return changed;
  }

  private async mutate(
    change: (book: VocabularyBookFile) => VocabularyBookFile
  ): Promise<VocabularyBookFile> {
    return this.writeQueue.run(this.path, async () => {
      let existing = this.app.vault.getAbstractFileByPath(this.path);
      if (existing !== null && !(existing instanceof TFile)) {
        throw new Error(`生词本路径不是文件：${this.path}`);
      }
      let initialOnMissing: VocabularyBookFile | null = null;
      if (existing === null) {
        if (this.hasSeenFile) {
          throw new Error(`生词本文件曾存在但当前缺失，已停止写入，请检查同步：${this.path}`);
        }
        const empty = createEmptyVocabularyBook();
        initialOnMissing = change(empty);
        if (initialOnMissing === empty) return empty;
        if (!(await this.confirmCreate(this.path))) {
          throw new Error(`未创建生词本；请先确认同步完成：${this.path}`);
        }
        existing = this.app.vault.getAbstractFileByPath(this.path);
        if (existing !== null && !(existing instanceof TFile)) {
          throw new Error(`生词本路径不是文件：${this.path}`);
        }
      }
      let committed: VocabularyBookFile;
      if (existing instanceof TFile) {
        this.markFileSeen();
        const original = await this.app.vault.read(existing);
        const recovered = recoverVocabularyBook(JSON.parse(original) as unknown);
        if (Object.keys(recovered.invalidEntries).length > 0) {
          await this.backupDamagedBook(original, recovered.invalidEntries);
        }
        await this.app.vault.process(existing, (raw) => {
          if (raw !== original) {
            throw new Error("生词本在恢复前发生变化，请重试，避免覆盖同步内容。");
          }
          const current = recovered.book;
          committed = change(current);
          if (committed === current && Object.keys(recovered.invalidEntries).length === 0) return raw;
          return `${JSON.stringify(committed, null, 2)}\n`;
        });
        return committed!;
      }
      await this.ensureParentFolder();
      committed = initialOnMissing ?? change(createEmptyVocabularyBook());
      await this.app.vault.create(this.path, `${JSON.stringify(committed, null, 2)}\n`);
      this.markFileSeen();
      return committed;
    });
  }

  private async backupDamagedBook(raw: string, invalidEntries: Record<string, unknown>): Promise<void> {
    await ensureRecoveryBackup(this.app, this.path, raw,
      `${JSON.stringify({ version: VOCABULARY_BOOK_VERSION, invalidEntries }, null, 2)}\n`);
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
        throw new Error(`无法创建生词本文件夹，路径已被文件占用：${current}`);
      }
    }
  }
}
