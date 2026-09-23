import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  emptySubscriptionData,
  parseSubscriptionData,
  removeSubscriptionData,
  renameImportedNote,
  upsertSubscriptionData,
  type RssSubscription,
  type RssSubscriptionData
} from "./rss-subscription-core";

export const SUBSCRIPTIONS_PATH = "Lingua Study/Subscriptions/subscriptions.json";

export class RssSubscriptionStore {
  private hasSeenFile = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: App) {}

  async read(): Promise<RssSubscriptionData> {
    const node = this.app.vault.getAbstractFileByPath(SUBSCRIPTIONS_PATH);
    if (node === null) {
      if (this.hasSeenFile) {
        throw new Error("订阅数据文件在运行中消失，已停止写入以保护已有订阅。");
      }
      return emptySubscriptionData();
    } else if (node instanceof TFile) {
      try {
        const data = parseSubscriptionData(JSON.parse(await this.app.vault.read(node)) as unknown);
        this.hasSeenFile = true;
        return data;
      } catch (error) {
        throw new Error(`订阅数据读取失败：${error instanceof Error ? error.message : "格式无效"}`);
      }
    } else {
      throw new Error("订阅数据路径已被文件夹占用，未写入任何内容。");
    }
  }

  async upsertFeed(feed: RssSubscription): Promise<RssSubscriptionData> {
    return this.update((data) => upsertSubscriptionData(data, feed));
  }

  async removeFeed(id: string): Promise<RssSubscriptionData> {
    // 保留导入记录；退订不删除学习笔记，再次订阅时仍可找到原笔记。
    return this.update((data) => removeSubscriptionData(data, id));
  }

  async recordImport(key: string, path: string): Promise<RssSubscriptionData> {
    return this.update((data) => ({ ...data, imports: { ...data.imports, [key]: path } }));
  }

  async noteRenamed(oldPath: string, newPath: string): Promise<void> {
    const data = await this.read();
    if (!Object.values(data.imports).some((path) =>
      path === oldPath || path.startsWith(`${oldPath}/`))) return;
    await this.update((data) => renameImportedNote(data, oldPath, newPath));
  }

  private async update(change: (data: RssSubscriptionData) => RssSubscriptionData): Promise<RssSubscriptionData> {
    const run = async (): Promise<RssSubscriptionData> => {
      const next = change(await this.read());
      await this.ensureFolder();
      const node = this.app.vault.getAbstractFileByPath(SUBSCRIPTIONS_PATH);
      const text = `${JSON.stringify(next, null, 2)}\n`;
      if (node instanceof TFile) await this.app.vault.modify(node, text);
      else if (node === null) await this.app.vault.create(SUBSCRIPTIONS_PATH, text);
      else throw new Error("订阅数据路径已被文件夹占用，未写入任何内容。");
      this.hasSeenFile = true;
      return structuredClone(next);
    };
    const result = this.pending.then(run, run);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureFolder(): Promise<void> {
    let path = "";
    for (const part of SUBSCRIPTIONS_PATH.split("/").slice(0, -1)) {
      path = normalizePath(path ? `${path}/${part}` : part);
      const node = this.app.vault.getAbstractFileByPath(path);
      if (node instanceof TFile) throw new Error(`无法创建订阅文件夹：${path} 已经是文件。`);
      if (!(node instanceof TFolder)) await this.app.vault.createFolder(path);
    }
  }
}
