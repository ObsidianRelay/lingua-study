import { ItemView, Modal, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { RssSubscriptionController, SubscriptionPreview } from "./rss-subscription-controller";
import { selectSubscriptionSources, SUBSCRIPTION_COLORS, subscriptionItemKey, subscriptionNotePath, youtubeThumbnailUrl,
  type RssSubscription, type RssSubscriptionData, type SubscriptionCategory, type SubscriptionColor, type SubscriptionItem,
  type SubscriptionKind, type SubscriptionSourceKind } from "./rss-subscription-core";
import type { CategoryChoice } from "./rss-subscription-store";

export const RSS_SUBSCRIPTION_VIEW_TYPE = "lingua-study-rss-subscriptions";
export const RSS_SUBSCRIPTION_HOME_VIEW_TYPE = "lingua-study-rss-home";
const PAGE_SIZE = 30;
const errorText = (error: unknown): string => error instanceof Error ? error.message : "操作失败，请重试。";
const colorClass = (color: SubscriptionColor): string => `lingua-rss-color-${color}`;
const displayDate = (value: string): string => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString().slice(0, 10);
};

class ConfirmModal extends Modal {
  constructor(app: ItemView["app"], private readonly heading: string, private readonly message: string,
    private readonly confirm: string, private readonly action: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("lingua-rss-paper-modal");
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("p", { text: this.message });
    const actions = this.contentEl.createDiv({ cls: "lingua-rss-modal-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const button = actions.createEl("button", { cls: "mod-warning", text: this.confirm });
    button.addEventListener("click", () => {
      button.disabled = true;
      void this.action().then(() => this.close()).catch((error) => { button.disabled = false; new Notice(errorText(error), 8_000); });
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

class SubscriptionItemDetailsModal extends Modal {
  constructor(app: ItemView["app"], private readonly feed: RssSubscription,
    private readonly item: SubscriptionItem, private readonly action: string,
    private readonly onLearn: () => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("lingua-rss-paper-modal");
    this.titleEl.setText(this.item.title);
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-detail");
    root.createEl("p", { cls: "lingua-rss-detail-source",
      text: `${this.feed.kind === "youtube" ? "YouTube" : "播客"} · ${this.feed.title}${this.item.publishedAt ? ` · ${this.item.publishedAt}` : ""}` });
    root.createEl("h3", { text: "发布者简介" });
    root.createEl("p", { cls: "lingua-rss-detail-description",
      text: this.item.description || "当前 RSS 未提供这条内容的简介。刷新后若来源补充了简介，这里会自动显示。" });
    const actions = root.createDiv({ cls: "lingua-rss-modal-actions" });
    actions.createEl("button", { text: "关闭" }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: this.action }).addEventListener("click", () => {
      this.close(); this.onLearn();
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

class CategoryModal extends Modal {
  private name: string;
  private color: SubscriptionColor;
  constructor(app: ItemView["app"], private readonly controller: RssSubscriptionController,
    private readonly category: SubscriptionCategory | null, private readonly onSaved: () => Promise<void>) {
    super(app); this.name = category?.name ?? ""; this.color = category?.color ?? "blue";
  }
  onOpen(): void { this.modalEl.addClass("lingua-rss-paper-modal"); this.render(); }
  onClose(): void { this.contentEl.empty(); }
  private render(): void {
    this.titleEl.setText(this.category ? "编辑标签" : "创建标签");
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-modal");
    const input = root.createEl("input", { type: "text", placeholder: "标签名称", attr: { "aria-label": "标签名称", maxlength: "40" } });
    input.value = this.name;
    input.addEventListener("input", () => { this.name = input.value; });
    renderColorChoices(root, this.color, (color) => { this.color = color; this.render(); });
    const actions = root.createDiv({ cls: "lingua-rss-modal-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存" });
    save.addEventListener("click", () => {
      save.disabled = true;
      const task = this.category
        ? this.controller.store.editCategory(this.category.id, this.name, this.color)
        : this.controller.store.createCategory(this.name, this.color);
      void task.then(async () => { await this.onSaved(); this.close(); })
        .catch((error) => { save.disabled = false; new Notice(errorText(error), 8_000); });
    });
  }
}

class CategoryManagerModal extends Modal {
  private data: RssSubscriptionData | null = null;
  constructor(app: ItemView["app"], private readonly controller: RssSubscriptionController,
    private readonly onChanged: () => Promise<void>) { super(app); }
  onOpen(): void { this.modalEl.addClass("lingua-rss-paper-modal"); void this.reload(); }
  onClose(): void { this.contentEl.empty(); }
  private async reload(): Promise<void> {
    try { this.data = await this.controller.read(); this.render(); }
    catch (error) { this.contentEl.setText(errorText(error)); }
  }
  private render(): void {
    this.titleEl.setText("管理标签");
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-modal");
    if (!this.data?.categories.length) root.createEl("p", { text: "还没有自建标签。" });
    for (const category of this.data?.categories ?? []) {
      const row = root.createDiv({ cls: "lingua-rss-category-manage-row" });
      row.createSpan({ cls: `lingua-rss-card-tag ${colorClass(category.color)}`, text: category.name });
      row.createSpan({ text: `${this.data?.feeds.filter((feed) => feed.categoryId === category.id).length ?? 0} 个订阅源` });
      row.createEl("button", { text: "编辑" }).addEventListener("click", () =>
        new CategoryModal(this.app, this.controller, category, async () => { await this.reload(); await this.onChanged(); }).open());
      row.createEl("button", { text: "删除" }).addEventListener("click", () =>
        new ConfirmModal(this.app, "删除标签？", `删除“${category.name}”后，频道和节目会变为“无标签”；不会删除订阅或学习笔记。`, "删除标签",
          async () => { await this.controller.store.deleteCategory(category.id); await this.reload(); await this.onChanged(); }).open());
    }
    root.createEl("button", { cls: "mod-cta", text: "＋ 创建标签" }).addEventListener("click", () =>
      new CategoryModal(this.app, this.controller, null, async () => { await this.reload(); await this.onChanged(); }).open());
    root.createEl("p", { cls: "lingua-rss-modal-hint", text: "一个频道或节目目前可选择一个彩色标签。删除标签不会删除订阅源。" });
  }
}

function renderColorChoices(root: HTMLElement, selected: SubscriptionColor, choose: (color: SubscriptionColor) => void): void {
  const colors = root.createDiv({ cls: "lingua-rss-colors" });
  for (const color of SUBSCRIPTION_COLORS) {
    const button = colors.createEl("button", { cls: `lingua-rss-color-choice ${colorClass(color)}`,
      attr: { "aria-label": `${color} 标签颜色`, "aria-pressed": String(selected === color) } });
    button.type = "button";
    if (selected === color) button.addClass("is-selected");
    button.addEventListener("click", () => choose(color));
  }
}

class AddSubscriptionModal extends Modal {
  private data: RssSubscriptionData | null = null;
  private preview: SubscriptionPreview | null = null;
  private input = "";
  private resolvedInput = "";
  private categoryId = "";
  private newName = "";
  private color: SubscriptionColor = "blue";
  private busy = false;
  private message = "";
  private duplicate = false;
  constructor(app: ItemView["app"], private readonly controller: RssSubscriptionController,
    private readonly onSaved: (feed: RssSubscription) => Promise<void>) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("lingua-rss-paper-modal");
    void this.controller.read().then((data) => { this.data = data; this.render(); })
      .catch((error) => { this.message = errorText(error); this.render(); });
    this.render();
  }
  onClose(): void { this.contentEl.empty(); }
  private render(): void {
    this.titleEl.setText("添加订阅");
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-modal");
    root.createEl("p", { cls: "lingua-rss-modal-intro", text: "粘贴 YouTube 频道、播客节目或 RSS 地址。" });
    const form = root.createEl("form", { cls: "lingua-rss-modal-form" });
    const input = form.createEl("input", { type: "url", placeholder: "https://www.youtube.com/@TED",
      attr: { "aria-label": "频道或 RSS 地址" } });
    input.value = this.input; input.required = true; input.disabled = this.busy;
    input.addEventListener("input", () => { this.input = input.value; this.preview = null; this.resolvedInput = ""; });
    const resolve = form.createEl("button", { text: this.busy ? "正在解析…" : "解析链接" });
    resolve.type = "submit"; resolve.disabled = this.busy;
    form.addEventListener("submit", (event) => {
      event.preventDefault(); this.input = input.value.trim(); this.busy = true; this.preview = null;
      this.message = ""; this.duplicate = false; this.render();
      void this.controller.preview(this.input).then(async (preview) => {
        this.data = await this.controller.read();
        this.preview = preview;
        this.resolvedInput = this.input;
        this.duplicate = this.data.feeds.some((feed) => feed.id === preview.feed.id);
        if (this.duplicate) this.message = "这个订阅源已添加，可在订阅主页调整标签。";
      }).catch((error) => { this.message = errorText(error); })
        .finally(() => { this.busy = false; this.render(); });
    });
    if (!this.preview && !this.message && !this.busy) root.createEl("p", { cls: "lingua-rss-modal-hint", text: "解析成功后可预览频道信息、选择分类，再确认订阅。" });
    if (this.message) root.createEl("p", { cls: this.duplicate ? "lingua-rss-warning" : "lingua-rss-error", text: this.message });
    if (!this.preview || this.duplicate) return;
    const card = root.createDiv({ cls: "lingua-rss-preview" });
    card.createEl("strong", { text: this.preview.feed.title });
    card.createEl("p", { text: `${this.preview.feed.kind === "youtube" ? "YouTube" : "播客"} · ${this.preview.feed.items.length} 条内容` });
    card.createEl("small", { text: `RSS：${this.preview.feed.url}` });
    if (this.preview.warning) card.createEl("p", { cls: "lingua-rss-warning", text: this.preview.warning });
    root.createEl("label", { text: "频道或节目标签（可选）" });
    const selector = root.createEl("select", { attr: { "aria-label": "订阅标签" } });
    selector.createEl("option", { value: "", text: "无标签" });
    for (const entry of this.data?.categories ?? []) selector.createEl("option", { value: entry.id, text: entry.name });
    selector.createEl("option", { value: "__new", text: "＋ 创建新标签" });
    selector.value = this.categoryId;
    selector.addEventListener("change", () => { this.categoryId = selector.value; this.render(); });
    if (this.categoryId === "__new") {
      const name = root.createEl("input", { type: "text", placeholder: "新标签名称", attr: { "aria-label": "新标签名称", maxlength: "40" } });
      name.value = this.newName;
      name.addEventListener("input", () => { this.newName = name.value; });
      renderColorChoices(root, this.color, (color) => { this.color = color; this.render(); });
    }
    const actions = root.createDiv({ cls: "lingua-rss-modal-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: "确认订阅" });
    save.disabled = this.busy;
    save.addEventListener("click", () => {
      if (!this.preview || this.input !== this.resolvedInput) {
        new Notice("链接已改变，请重新解析后再订阅。", 6_000);
        return;
      }
      const choice: CategoryChoice = this.categoryId === "__new"
        ? { name: this.newName, color: this.color } : { existingId: this.categoryId || null };
      const preview = this.preview;
      save.disabled = true;
      void this.controller.addPreview(preview, choice).then(async () => { await this.onSaved(preview.feed); this.close(); })
        .catch((error) => { save.disabled = false; new Notice(errorText(error), 8_000); });
    });
  }
}

function itemStatus(app: ItemView["app"], data: RssSubscriptionData, item: SubscriptionItem): { label: string; action: string } {
  const mapped = data.imports[subscriptionItemKey(item)];
  const mappedFile = mapped ? app.vault.getAbstractFileByPath(mapped) : null;
  const draft = app.vault.getAbstractFileByPath(subscriptionNotePath(item)) instanceof TFile;
  if (mappedFile instanceof TFile) return { label: "已导入", action: "打开学习笔记" };
  if (mapped) return { label: "原笔记未找到", action: "查找原笔记" };
  if (draft) return { label: "导入未完成", action: "继续导入" };
  return { label: "", action: "开始学习" };
}

export class RssSubscriptionHomeView extends ItemView {
  private data: RssSubscriptionData | null = null;
  private expandedKinds = new Set<SubscriptionKind>();
  private categoryId = "__all";
  private feedId = "__all";
  private limit = PAGE_SIZE;
  private categoryScrollLeft = 0;
  private tagFiltersOpen = false;
  private sourceSettingsOpen = false;
  private busy = false;
  private opened = false;
  constructor(leaf: WorkspaceLeaf, private readonly controller: RssSubscriptionController) { super(leaf); }
  getViewType(): string { return RSS_SUBSCRIPTION_HOME_VIEW_TYPE; }
  getDisplayText(): string { return "Lingua Study 订阅"; }
  getIcon(): string { return "rss"; }
  async onOpen(): Promise<void> { this.opened = true; await this.reload(); }
  async onClose(): Promise<void> { this.opened = false; this.contentEl.empty(); }
  async refreshData(): Promise<void> { await this.reload(); }
  private async reload(): Promise<void> {
    try {
      this.data = await this.controller.read();
      if (this.categoryId !== "__all" && this.categoryId !== "" && !this.data.categories.some((category) => category.id === this.categoryId)) this.categoryId = "__all";
      if (this.categoryId === "" && !this.data.feeds.some((feed) => feed.categoryId === null)) {
        this.categoryId = "__all";
        this.feedId = "__all";
      }
      if (this.feedId !== "__all" && !this.data.feeds.some((feed) => feed.id === this.feedId)) this.feedId = "__all";
      if (this.opened) this.render();
    } catch (error) { this.contentEl.setText(errorText(error)); }
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.render();
    try { await action(); await this.reload(); }
    catch (error) { new Notice(errorText(error), 8_000); }
    finally { this.busy = false; if (this.opened) this.render(); }
  }
  private render(): void {
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-home");
    const page = root.createDiv({ cls: "lingua-rss-page" });
    const data = this.data;
    const header = page.createDiv({ cls: "lingua-rss-home-header" });
    const title = header.createDiv(); title.createEl("h2", { text: "订阅" });
    title.createEl("p", { text: "从喜欢的频道和播客中挑选内容；历史条目从订阅起随刷新逐步累计。" });
    const add = header.createEl("button", { cls: "mod-cta", text: "＋ 添加订阅" });
    add.disabled = this.busy;
    add.addEventListener("click", () => new AddSubscriptionModal(this.app, this.controller, async (feed) => {
      this.expandedKinds.add(feed.kind);
      this.categoryId = "__all"; this.feedId = feed.id; this.limit = PAGE_SIZE; await this.reload();
    }).open());
    if (!data) return;
    const sources = page.createEl("details", { cls: "lingua-rss-sources" });
    sources.open = this.sourceSettingsOpen;
    sources.addEventListener("toggle", () => { if (sources.isConnected) this.sourceSettingsOpen = sources.open; });
    sources.createEl("summary", { text: `订阅源设置 · ${data.feeds.length}` });
    for (const feed of data.feeds) this.renderSource(sources, data, feed);
    const tagFilters = page.createEl("details", { cls: "lingua-rss-tag-filters" });
    tagFilters.open = this.tagFiltersOpen;
    tagFilters.addEventListener("toggle", () => { if (tagFilters.isConnected) this.tagFiltersOpen = tagFilters.open; });
    tagFilters.createEl("summary", { text: "按标签筛选" });
    const categories = tagFilters.createDiv({ cls: "lingua-rss-categories" });
    const filters = categories.createDiv({ cls: "lingua-rss-filter-list", attr: { "aria-label": "订阅标签筛选" } });
    this.categoryButton(filters, "__all", "全部标签", null, data.feeds.length);
    const uncategorizedCount = data.feeds.filter((feed) => feed.categoryId === null).length;
    if (uncategorizedCount > 0) this.categoryButton(filters, "", "无标签", null, uncategorizedCount);
    for (const category of data.categories) {
      const count = data.feeds.filter((feed) => feed.categoryId === category.id).length;
      if (count > 0) this.categoryButton(filters, category.id, category.name, category.color, count);
    }
    filters.scrollLeft = this.categoryScrollLeft;
    filters.addEventListener("scroll", () => { this.categoryScrollLeft = filters.scrollLeft; }, { passive: true });
    if (this.feedId !== "__all" && !selectSubscriptionSources(data.feeds, "__all", this.categoryId).some((feed) => feed.id === this.feedId)) {
      this.feedId = "__all";
    }
    this.renderSourceTree(page, data);
  }
  private renderSourceTree(root: HTMLElement, data: RssSubscriptionData): void {
    const tree = root.createDiv({ cls: "lingua-rss-source-tree", attr: { role: "navigation", "aria-label": "视频与播客订阅目录" } });
    const top = tree.createDiv({ cls: "lingua-rss-tree-top" });
    const allExpanded = this.expandedKinds.size === 2;
    const all = top.createEl("button", { cls: "lingua-rss-tree-all",
      attr: { "aria-label": `${allExpanded ? "收起" : "展开"}全部订阅源`, "aria-expanded": String(allExpanded) } });
    all.createSpan({ text: "全部订阅" });
    const visibleFeeds = selectSubscriptionSources(data.feeds, "__all", this.categoryId);
    all.createSpan({ cls: "lingua-rss-tree-count", text: String(visibleFeeds.length) });
    all.addEventListener("click", () => {
      if (allExpanded) this.expandedKinds.clear();
      else { this.expandedKinds.add("youtube"); this.expandedKinds.add("podcast"); }
      this.feedId = "__all"; this.limit = PAGE_SIZE; this.render();
    });
    const actions = top.createDiv({ cls: "lingua-rss-filter-actions" });
    const refresh = actions.createEl("button", { cls: "lingua-rss-category-refresh lingua-rss-category-refresh-global",
      attr: { "aria-label": "刷新当前标签下的订阅源", title: "刷新当前标签下的订阅源" } });
    setIcon(refresh, "refresh-cw");
    refresh.disabled = this.busy || visibleFeeds.length === 0;
    refresh.addEventListener("click", () => void this.refreshFeeds(this.categoryId));
    actions.createEl("button", { cls: "lingua-rss-manage-button", text: "管理标签" })
      .addEventListener("click", () => new CategoryManagerModal(this.app, this.controller, () => this.reload()).open());
    for (const kind of ["youtube", "podcast"] as const) {
      const feeds = visibleFeeds.filter((feed) => feed.kind === kind);
      const group = tree.createDiv({ cls: "lingua-rss-kind-group" });
      const heading = group.createDiv({ cls: "lingua-rss-kind-row" });
      const expanded = this.expandedKinds.has(kind);
      const label = kind === "youtube" ? "视频" : "播客";
      const toggleKind = (): void => {
        if (expanded) { this.expandedKinds.delete(kind); this.feedId = "__all"; }
        else this.expandedKinds.add(kind);
        this.limit = PAGE_SIZE; this.render();
      };
      const toggle = heading.createEl("button", { cls: "lingua-rss-kind-toggle",
        attr: { "aria-label": `${expanded ? "收起" : "展开"}${label}订阅源列表`, "aria-expanded": String(expanded) } });
      setIcon(toggle, expanded ? "chevron-down" : "chevron-right");
      toggle.addEventListener("click", toggleKind);
      const button = heading.createEl("button", { cls: "lingua-rss-kind-button", attr: { "aria-expanded": String(expanded) } });
      button.createSpan({ text: label });
      button.createSpan({ cls: "lingua-rss-tree-count", text: String(feeds.length) });
      button.addEventListener("click", toggleKind);
      if (!expanded) continue;
      const children = group.createDiv({ cls: "lingua-rss-kind-children" });
      if (!feeds.length) children.createSpan({ cls: "lingua-rss-tree-empty", text: "此处暂无符合条件的订阅源" });
      for (const feed of feeds) {
        const row = children.createDiv({ cls: "lingua-rss-tree-feed-row" });
        const feedExpanded = this.feedId === feed.id;
        const child = row.createEl("button", { cls: "lingua-rss-tree-feed", attr: { "aria-expanded": String(feedExpanded) } });
        setIcon(child, feedExpanded ? "chevron-down" : "chevron-right");
        child.createSpan({ cls: "lingua-rss-tree-feed-name", text: feed.title });
        const tag = data.categories.find((entry) => entry.id === feed.categoryId);
        if (tag) child.createSpan({ cls: `lingua-rss-card-tag ${colorClass(tag.color)}`, text: tag.name });
        child.createSpan({ cls: "lingua-rss-tree-count", text: String(feed.items.length) });
        if (feedExpanded) child.addClass("is-active");
        child.addEventListener("click", () => {
          this.feedId = feedExpanded ? "__all" : feed.id; this.limit = PAGE_SIZE; this.render();
        });
        if (!feedExpanded) continue;
        const content = children.createDiv({ cls: "lingua-rss-tree-feed-content" });
        const items = [...feed.items].sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
        if (!items.length) content.createEl("p", { cls: "lingua-rss-empty", text: "暂无剧集内容，可用上方刷新按钮重试。" });
        const grid = content.createDiv({ cls: "lingua-rss-card-grid" });
        for (const item of items.slice(0, this.limit)) this.renderCard(grid, data, feed, item, false);
        if (items.length > this.limit) content.createEl("button", { cls: "lingua-rss-load-more",
          text: `加载更多（还剩 ${items.length - this.limit} 条）` }).addEventListener("click", () => {
          const scrollTop = this.contentEl.scrollTop;
          this.limit += PAGE_SIZE; this.render(); this.contentEl.scrollTop = scrollTop;
        });
      }
    }
  }
  private categoryButton(parent: HTMLElement, id: string, name: string, color: SubscriptionColor | null, count: number): void {
    const group = parent.createDiv({ cls: "lingua-rss-category-group" });
    const button = group.createEl("button", { cls: `lingua-rss-category-chip ${color ? `${colorClass(color)} has-color-dot` : ""}` });
    button.createSpan({ text: name });
    button.createSpan({ cls: "lingua-rss-category-count", text: String(count) });
    if (this.categoryId === id) button.addClass("is-active");
    button.addEventListener("click", () => { this.categoryId = id; this.feedId = "__all"; this.limit = PAGE_SIZE; this.render(); });
    const refresh = group.createEl("button", { cls: "lingua-rss-category-refresh lingua-rss-category-refresh-local", attr: { "aria-label": `刷新${name}的订阅源`, title: `刷新${name}的订阅源` } });
    setIcon(refresh, "refresh-cw");
    refresh.disabled = this.busy || count === 0;
    refresh.addEventListener("click", () => void this.refreshFeeds(id));
  }
  private async refreshFeeds(id: string, selectedFeedId = "__all", kind: SubscriptionSourceKind = "__all"): Promise<void> {
    await this.run(async () => {
      const feedIds = selectSubscriptionSources(this.data?.feeds ?? [], kind, id, selectedFeedId).map((feed) => feed.id);
      const result = await this.controller.refreshFeeds(feedIds);
      if (result.state === "busy") new Notice("订阅正在刷新，请稍后再试。", 5_000);
      else if (result.state === "done") {
        const firstFailure = result.failed[0];
        new Notice(firstFailure
          ? `已刷新 ${result.refreshed} 个，新增 ${result.newItems} 条；${result.failed.length} 个失败（${firstFailure.title}：${firstFailure.message}），旧内容已保留。`
          : `已刷新 ${result.refreshed} 个订阅源，本次新增 ${result.newItems} 条；旧内容会继续保留。`, 8_000);
      }
    });
  }
  private renderSource(parent: HTMLElement, data: RssSubscriptionData, feed: RssSubscription): void {
    const row = parent.createDiv({ cls: "lingua-rss-source-row" });
    const info = row.createDiv({ cls: "lingua-rss-source-info" });
    info.createEl("strong", { text: feed.title });
    info.createEl("small", { text: `${feed.kind === "youtube" ? "YouTube" : "播客"} · ${feed.status === "pending" ? "待刷新" : `已累计 ${feed.items.length} 条内容`}` });
    this.createTagSelector(row, data, feed);
    const remove = row.createEl("button", { text: "退订" }); remove.disabled = this.busy;
    remove.addEventListener("click", () => new ConfirmModal(this.app, "取消订阅？",
      `将移除“${feed.title}”。已有学习笔记、字幕和缓存不会删除。`, "取消订阅",
      async () => { await this.controller.remove(feed.id); await this.reload(); }).open());
  }
  private createTagSelector(parent: HTMLElement, data: RssSubscriptionData, feed: RssSubscription, cls = ""): HTMLSelectElement {
    const selector = parent.createEl("select", { cls, attr: { "aria-label": `调整 ${feed.title} 的标签`, title: `调整 ${feed.title} 的标签` } });
    selector.createEl("option", { value: "", text: "无标签" });
    for (const category of data.categories) selector.createEl("option", { value: category.id, text: category.name });
    selector.value = feed.categoryId ?? "";
    selector.disabled = this.busy;
    selector.addEventListener("change", () => void this.run(async () => { await this.controller.setFeedCategory(feed.id, selector.value || null); }));
    return selector;
  }
  private renderCard(parent: HTMLElement, data: RssSubscriptionData, feed: RssSubscription, item: SubscriptionItem,
    showSource = true): void {
    const card = parent.createDiv({ cls: "lingua-rss-card" });
    const state = itemStatus(this.app, data, item);
    const learn = (): void => { void this.run(async () => {
      const success = await this.controller.openItem(item);
      if (!success) new Notice("学习内容尚未导入完成，可稍后从这里重试。", 6_000);
    }); };
    const showDetails = (): void => new SubscriptionItemDetailsModal(this.app, feed, item, state.action, learn).open();
    if (item.kind === "youtube") {
      const cover = card.createDiv({ cls: "lingua-rss-cover" });
      cover.setAttribute("role", "button"); cover.setAttribute("aria-label", `查看${item.title}的简介`); cover.tabIndex = 0;
      cover.addEventListener("click", showDetails);
      cover.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDetails(); }
      });
      const url = youtubeThumbnailUrl(item.id);
      if (url) {
        const img = cover.createEl("img", { attr: { src: url, alt: `${item.title} 的视频封面`, loading: "lazy" } });
        img.addEventListener("error", () => { img.remove(); cover.addClass("is-placeholder"); cover.setText("封面暂不可用"); }, { once: true });
      }
    }
    const body = card.createDiv({ cls: "lingua-rss-card-body" });
    const title = body.createEl("button", { cls: "lingua-rss-card-title lingua-rss-detail-trigger", text: item.title,
      attr: { "aria-label": `查看${item.title}的简介` } });
    title.type = "button"; title.addEventListener("click", showDetails);
    const category = data.categories.find((entry) => entry.id === feed.categoryId);
    if (showSource || category) {
      const meta = body.createDiv({ cls: "lingua-rss-card-meta" });
      if (showSource) meta.createSpan({ cls: "lingua-rss-card-source", text: feed.title });
      if (category) meta.createSpan({ cls: `lingua-rss-card-tag ${showSource ? "" : "lingua-rss-card-tag-overview"} ${colorClass(category.color)}`, text: category.name });
    }
    const details = body.createDiv({ cls: "lingua-rss-card-details" });
    if (item.publishedAt) {
      details.createEl("small", { cls: "lingua-rss-card-date lingua-rss-classic-only", text: item.publishedAt });
      details.createEl("small", { cls: "lingua-rss-card-date lingua-rss-paper-only", text: displayDate(item.publishedAt) });
    }
    if (state.label) details.createEl("small", { cls: `lingua-rss-item-status ${state.label === "已导入" ? "is-imported" : "is-incomplete"}`, text: state.label });
    const actions = body.createDiv({ cls: "lingua-rss-card-actions" });
    actions.createEl("button", { text: "查看简介" }).addEventListener("click", showDetails);
    const cardAction = state.action === "打开学习笔记" ? "打开笔记" : state.action;
    const button = actions.createEl("button", { cls: "lingua-rss-primary-action", text: cardAction }); button.disabled = this.busy;
    button.addEventListener("click", learn);
  }
}

/** Keep old right-side workspace leaves usable so they can open the full view. */
export class RssSubscriptionView extends ItemView {
  private data: RssSubscriptionData | null = null;
  constructor(leaf: WorkspaceLeaf, private readonly controller: RssSubscriptionController,
    private readonly openHome: () => Promise<void>) { super(leaf); }
  getViewType(): string { return RSS_SUBSCRIPTION_VIEW_TYPE; }
  getDisplayText(): string { return "Lingua Study 订阅"; }
  getIcon(): string { return "rss"; }
  async onOpen(): Promise<void> {
    try { this.data = await this.controller.read(); this.render(); }
    catch (error) { this.contentEl.setText(errorText(error)); }
  }
  async onClose(): Promise<void> { this.contentEl.empty(); }
  private render(): void {
    const root = this.contentEl; root.empty(); root.addClass("lingua-rss-sidebar");
    root.createEl("h2", { text: "订阅" });
    root.createEl("p", { text: "频道、播客与学习内容集中在订阅主页。" });
    root.createEl("button", { cls: "mod-cta", text: "打开订阅主页" }).addEventListener("click", () => void this.openHome());
    for (const category of this.data?.categories ?? []) {
      const count = this.data?.feeds.filter((feed) => feed.categoryId === category.id).length ?? 0;
      root.createDiv({ cls: `lingua-rss-sidebar-category ${colorClass(category.color)}`, text: `${category.name} · ${count}` });
    }
    if (!this.data?.feeds.length) root.createEl("p", { cls: "lingua-rss-empty", text: "还没有订阅源。" });
  }
}
