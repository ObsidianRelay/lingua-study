import { App, normalizePath, TFile } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import { recoverCacheForWrite } from "./cache-recovery";
import {
  createEmptyStudyCache,
  getStudyCachePath,
  recoverStudyCache,
  upsertStudyCacheEntry,
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
      const recovered = recoverStudyCache(parsed, videoId);
      const invalidCount = Object.keys(recovered.invalidEntries).length;
      return {
        path,
        analyses: recovered.cache.analyses,
        warning: invalidCount > 0 ? `知识卡缓存有 ${invalidCount} 条无效条目，其他条目仍可使用：${path}` : null
      };
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
      const original = await this.app.vault.read(file);
      const cache = await recoverCacheForWrite(this.app, path, original,
        (value) => recoverStudyCache(value, videoId), () => createEmptyStudyCache(videoId));
      await this.app.vault.process(file, (raw) => {
        if (raw !== original) throw new Error("知识卡缓存发生变化，请重试以避免覆盖同步内容。");
        return `${JSON.stringify(upsertStudyCacheEntry(cache, fingerprint, entry), null, 2)}\n`;
      });
      return;
    }
    const cache = upsertStudyCacheEntry(createEmptyStudyCache(videoId), fingerprint, entry);
    await this.app.vault.create(path, `${JSON.stringify(cache, null, 2)}\n`);
  }
}
