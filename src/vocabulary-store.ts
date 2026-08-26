import { App, normalizePath, TFile, TFolder } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import {
  VOCABULARY_BOOK_PATH,
  addVocabularyEntry,
  createEmptyVocabularyBook,
  introduceVocabularyEntry,
  rateVocabularyEntry,
  removeVocabularyEntry,
  updateVocabularyNote,
  validateVocabularyBook,
  type ReviewRating,
  type VocabularyAddInput,
  type VocabularyBookFile
} from "./vocabulary-core";

export interface VocabularyBookLoadResult {
  book: VocabularyBookFile;
  warning: string | null;
}

export class VocabularyStore {
  private readonly writeQueue = new AsyncKeyedQueue();
  readonly path = normalizePath(VOCABULARY_BOOK_PATH);

  constructor(private readonly app: App) {}

  async load(): Promise<VocabularyBookLoadResult> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file === null) {
      return { book: createEmptyVocabularyBook(), warning: null };
    }
    if (!(file instanceof TFile)) {
      return { book: createEmptyVocabularyBook(), warning: `生词本路径不是文件：${this.path}` };
    }
    try {
      return {
        book: validateVocabularyBook(JSON.parse(await this.app.vault.cachedRead(file)) as unknown),
        warning: null
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

  async remove(id: string): Promise<VocabularyBookFile> {
    return this.mutate((book) => removeVocabularyEntry(book, id));
  }

  async updateNote(id: string, note: string): Promise<VocabularyBookFile> {
    return this.mutate((book) => updateVocabularyNote(book, id, note));
  }

  async introduce(id: string, now: Date): Promise<VocabularyBookFile> {
    return this.mutate((book) => introduceVocabularyEntry(book, id, now));
  }

  async rate(id: string, rating: ReviewRating, now: Date): Promise<VocabularyBookFile> {
    return this.mutate((book) => rateVocabularyEntry(book, id, rating, now));
  }

  private async mutate(
    change: (book: VocabularyBookFile) => VocabularyBookFile
  ): Promise<VocabularyBookFile> {
    return this.writeQueue.run(this.path, async () => {
      const existing = this.app.vault.getAbstractFileByPath(this.path);
      if (existing !== null && !(existing instanceof TFile)) {
        throw new Error(`生词本路径不是文件：${this.path}`);
      }
      let committed: VocabularyBookFile;
      if (existing instanceof TFile) {
        await this.app.vault.process(existing, (raw) => {
          const current = validateVocabularyBook(JSON.parse(raw) as unknown);
          committed = change(current);
          return `${JSON.stringify(committed, null, 2)}\n`;
        });
        return committed!;
      }
      await this.ensureParentFolder();
      committed = change(createEmptyVocabularyBook());
      await this.app.vault.create(this.path, `${JSON.stringify(committed, null, 2)}\n`);
      return committed;
    });
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
