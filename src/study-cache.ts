import { App, normalizePath, TFile } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import {
  createEmptyStudyCache,
  getStudyCachePath,
  upsertStudyCacheEntry,
  validateStudyCache,
  type StudyCacheEntry
} from "./study-cache-core";

export interface StudyCacheLoadResult {
  path: string;
  analyses: Record<string, StudyCacheEntry>;
  warning: string | null;
}
export class StudyCacheStore {
  private readonly writeQueue = new AsyncKeyedQueue();

  constructor(private readonly app: App) {}

  async load(transcriptPath: string, videoId: string): Promise<StudyCacheLoadResult> {
    const path = normalizePath(getStudyCachePath(transcriptPath));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file === null) {
      return { path, analyses: {}, warning: null };
    }
    if (!(file instanceof TFile)) {
      return {
        path,
        analyses: {},
        warning: `知识卡缓存路径不是文件，已忽略：${path}`
      };
    }
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.cachedRead(file));
      const cache = validateStudyCache(parsed, videoId);
      return { path, analyses: cache.analyses, warning: null };
    } catch {
      return {
        path,
        analyses: {},
        warning: `知识卡缓存格式错误，已忽略：${path}`
      };
    }
  }

  async upsert(
    transcriptPath: string,
    videoId: string,
    fingerprint: string,
    entry: StudyCacheEntry
  ): Promise<void> {
    const path = normalizePath(getStudyCachePath(transcriptPath));
    await this.writeQueue.run(path, async () => this.upsertNow(path, videoId, fingerprint, entry));
  }

  private async upsertNow(
    path: string,
    videoId: string,
    fingerprint: string,
    entry: StudyCacheEntry
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file !== null && !(file instanceof TFile)) {
      throw new Error(`知识卡缓存路径不是文件：${path}`);
    }
    if (file instanceof TFile) {
      await this.app.vault.process(file, (raw) => {
        let cache = createEmptyStudyCache(videoId);
        try {
          cache = validateStudyCache(JSON.parse(raw) as unknown, videoId);
        } catch {
          // 损坏缓存会在下一次成功生成时重建，不影响已有字幕和纯译文。
        }
        return `${JSON.stringify(upsertStudyCacheEntry(cache, fingerprint, entry), null, 2)}\n`;
      });
      return;
    }
    const cache = upsertStudyCacheEntry(createEmptyStudyCache(videoId), fingerprint, entry);
    await this.app.vault.create(path, `${JSON.stringify(cache, null, 2)}\n`);
  }
}
