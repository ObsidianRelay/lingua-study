import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  addNewSubscriptionData,
  addSubscriptionCategory,
  assignSubscriptionCategory,
  emptySubscriptionData,
  parseSubscriptionData,
  removeSubscriptionData,
  removeSubscriptionCategory,
  renameImportedNote,
  updateSubscriptionCategory,
  upsertSubscriptionData,
  type SubscriptionColor,
  type CategoryChoice,
  type RssSubscription,
  type RssSubscriptionData
} from "./rss-subscription-core";

export const SUBSCRIPTIONS_PATH = "Lingua Study/Subscriptions/subscriptions.json";
export type { CategoryChoice } from "./rss-subscription-core";

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

  async refreshExistingFeed(feed: RssSubscription): Promise<RssSubscriptionData> {
    // A feed may be unsubscribed while its network request is in flight; never re-create it.
    return this.update((data) => data.feeds.some((entry) => entry.id === feed.id)
      ? upsertSubscriptionData(data, feed) : data);
  }

  async addFeed(feed: RssSubscription, category: CategoryChoice): Promise<RssSubscriptionData> {
    return this.update((data) => addNewSubscriptionData(data, feed, category));
  }

  createCategory(name: string, color: SubscriptionColor): Promise<RssSubscriptionData> {
    return this.update((data) => addSubscriptionCategory(data, name, color));
  }

  editCategory(id: string, name: string, color: SubscriptionColor): Promise<RssSubscriptionData> {
    return this.update((data) => updateSubscriptionCategory(data, id, name, color));
  }

  deleteCategory(id: string): Promise<RssSubscriptionData> {
    return this.update((data) => removeSubscriptionCategory(data, id));
  }

  setFeedCategory(feedId: string, categoryId: string | null): Promise<RssSubscriptionData> {
    return this.update((data) => assignSubscriptionCategory(data, feedId, categoryId));
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
      if (node instanceof TFile) {
        const original = await this.app.vault.read(node);
        const parsed = JSON.parse(original) as unknown;
        parseSubscriptionData(parsed);
        if (original !== text) {
          if ((parsed as { version?: unknown }).version === 1) await this.backupLegacyData(original);
          await this.app.vault.modify(node, text);
        }
      }
      else if (node === null) await this.app.vault.create(SUBSCRIPTIONS_PATH, text);
      else throw new Error("订阅数据路径已被文件夹占用，未写入任何内容。");
      this.hasSeenFile = true;
      return structuredClone(next);
    };
    const result = this.pending.then(run, run);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async backupLegacyData(original: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    for (let suffix = 0; suffix < 100; suffix++) {
      const path = `Lingua Study/Subscriptions/subscriptions.v1.backup-${stamp}${suffix ? `-${suffix}` : ""}.json`;
      if (this.app.vault.getAbstractFileByPath(path) !== null) continue;
      await this.app.vault.create(path, original);
      return;
    }
    throw new Error("无法为旧订阅数据创建唯一备份，已取消写入。");
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
