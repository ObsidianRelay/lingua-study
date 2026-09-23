import { ItemView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { RssSubscriptionController } from "./rss-subscription-controller";
import { canonicalFeedUrl, subscriptionItemKey, subscriptionNotePath, type RssSubscription, type RssSubscriptionData, type SubscriptionItem } from "./rss-subscription-core";

export const RSS_SUBSCRIPTION_VIEW_TYPE = "lingua-study-rss-subscriptions";

class RemoveSubscriptionModal extends Modal {
  constructor(
    app: ItemView["app"],
    private readonly title: string,
    private readonly onConfirm: () => Promise<void>
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("取消订阅？");
    this.contentEl.createEl("p", { text: `将从列表移除“${this.title}”。已有学习笔记、字幕和缓存不会删除。` });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { text: "保留" }).addEventListener("click", () => this.close());
    const remove = actions.createEl("button", { cls: "mod-warning", text: "取消订阅" });
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void this.onConfirm().then(() => this.close()).catch((error) => {
        remove.disabled = false;
        new Notice(error instanceof Error ? error.message : "取消订阅失败。", 7_000);
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export class RssSubscriptionView extends ItemView {
  private selectedId: string | null = null;
  private data: RssSubscriptionData | null = null;
  private busy = false;
  private opened = false;

  constructor(leaf: WorkspaceLeaf, private readonly controller: RssSubscriptionController) {
    super(leaf);
  }

  getViewType(): string { return RSS_SUBSCRIPTION_VIEW_TYPE; }
  getDisplayText(): string { return "Lingua Study 订阅"; }
  getIcon(): string { return "rss"; }

  async onOpen(): Promise<void> {
    this.opened = true;
    await this.reload();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.contentEl.empty();
  }

  private async reload(): Promise<void> {
    try {
      this.data = await this.controller.read();
      if (this.selectedId && !this.data.feeds.some((feed) => feed.id === this.selectedId)) {
        this.selectedId = null;
      }
      this.selectedId ??= this.data.feeds[0]?.id ?? null;
      if (this.opened) this.render();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: error instanceof Error ? error.message : "订阅数据读取失败。" });
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
      await this.reload();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "订阅操作失败。", 8_000);
    } finally {
      this.busy = false;
      if (this.opened) this.render();
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("lingua-rss-view");
    root.createEl("h2", { text: "订阅" });
    root.createEl("p", { cls: "lingua-rss-intro", text: "播客与 YouTube 频道更新；选择条目后在学习笔记中播放。" });

    const form = root.createEl("form", { cls: "lingua-rss-add-form" });
    const input = form.createEl("input", {
      type: "url", placeholder: "粘贴 Podcast 或 YouTube 频道 RSS 地址",
      attr: { "aria-label": "RSS 地址" }
    });
    input.required = true;
    input.disabled = this.busy;
    const add = form.createEl("button", { text: "添加" });
    add.type = "submit";
    add.disabled = this.busy;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = input.value.trim();
      if (!url) return;
      void this.run(async () => {
        const canonical = canonicalFeedUrl(url);
        const data = await this.controller.add(canonical);
        this.data = data;
        const added = data.feeds.find((feed) => feed.url === canonical);
        this.selectedId = added?.id ?? this.selectedId;
      });
    });

    const heading = root.createDiv({ cls: "lingua-rss-section-heading" });
    heading.createEl("h3", { text: "订阅源" });
    if (!this.data?.feeds.length) {
      root.createEl("p", { cls: "lingua-rss-empty", text: "还没有订阅。添加一个公开 RSS 地址开始。" });
      return;
    }
    const feeds = root.createDiv({ cls: "lingua-rss-feed-list" });
    for (const feed of this.data.feeds) {
      const button = feeds.createEl("button", { cls: "lingua-rss-feed" });
      button.type = "button";
      button.disabled = this.busy;
      if (feed.id === this.selectedId) button.addClass("is-selected");
      button.createSpan({ cls: "lingua-rss-feed-kind", text: feed.kind === "podcast" ? "播客" : "YouTube" });
      button.createSpan({ text: feed.title });
      button.addEventListener("click", () => { this.selectedId = feed.id; this.render(); });
    }
    const selected = this.data.feeds.find((feed) => feed.id === this.selectedId);
    if (!selected) return;
    this.renderSelected(root, selected);
  }

  private renderSelected(root: HTMLElement, feed: RssSubscription): void {
    const heading = root.createDiv({ cls: "lingua-rss-section-heading" });
    heading.createEl("h3", { text: feed.title });
    const actions = heading.createDiv({ cls: "lingua-rss-source-actions" });
    const refresh = actions.createEl("button", { text: "刷新" });
    refresh.disabled = this.busy;
    refresh.addEventListener("click", () => void this.run(async () => {
      this.data = await this.controller.refresh(feed);
      new Notice("订阅已刷新。", 4_000);
    }));
    const remove = actions.createEl("button", { text: "退订" });
    remove.disabled = this.busy;
    remove.addEventListener("click", () => {
      new RemoveSubscriptionModal(this.app, feed.title, async () => {
        this.data = await this.controller.remove(feed.id);
        await this.reload();
      }).open();
    });
    const list = root.createDiv({ cls: "lingua-rss-item-list" });
    if (!feed.items.length) list.createEl("p", { text: "此订阅源暂无条目。" });
    for (const item of feed.items) this.renderItem(list, item);
  }

  private renderItem(list: HTMLElement, item: SubscriptionItem): void {
    const row = list.createDiv({ cls: "lingua-rss-item" });
    row.createDiv({ cls: "lingua-rss-item-title", text: item.title });
    if (item.publishedAt) row.createDiv({ cls: "lingua-rss-item-date", text: item.publishedAt });
    const mapped = this.data?.imports[subscriptionItemKey(item)];
    const mappedFile = mapped ? this.app.vault.getAbstractFileByPath(mapped) : null;
    const draft = this.app.vault.getAbstractFileByPath(subscriptionNotePath(item)) instanceof TFile;
    if (mappedFile instanceof TFile) {
      row.createDiv({ cls: "lingua-rss-item-status", text: "已导入" });
    } else if (mapped) {
      row.createDiv({ cls: "lingua-rss-item-status", text: "原笔记未找到" });
    } else if (draft) {
      row.createDiv({ cls: "lingua-rss-item-status", text: "导入未完成" });
    }
    const button = row.createEl("button", {
      text: mappedFile instanceof TFile ? "打开学习笔记" : mapped ? "查找原笔记" : draft ? "继续导入" : "开始学习"
    });
    button.disabled = this.busy;
    button.addEventListener("click", () => void this.run(async () => {
      const success = await this.controller.openItem(item);
      if (!success) new Notice("学习内容尚未导入完成，可稍后从这里重试。", 6_000);
    }));
  }
}
