import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";

import {
  CATEGORY_ORDER,
  buildHeatmap,
  buildReviewQueue,
  computeReviewStats,
  emptyState,
  mmss,
  setSentence,
  toggleStar,
  applyGrade,
  appendReviewLog,
  type CardCategory,
  type DayLog,
  type ReviewCard,
  type ReviewGrade,
  type ReviewLog,
  type ReviewState,
  type ReviewStore,
} from "./highlight-review-core";

export const HIGHLIGHT_REVIEW_VIEW_TYPE = "lingua-study-highlight-review";

const CAT_LABEL: Record<string, string> = {
  expression: "重点表达",
  grammar: "句型语法",
  difficulty: "易错难点",
  other: "其他",
};

export interface HighlightReviewSettings {
  /** 每天最多引入多少张新卡 */
  newPerDay: number;
  /** 背面是否显示中文字幕译文 */
  showTranslation: boolean;
}

/**
 * 视图需要宿主（插件）提供的最小能力。
 * 这样视图本身不碰 Lingua Study 的 HighlightStore / 设置 / 数据落盘，
 * 集成时只需要在 main.ts 里实现这几个方法。
 */
export interface HighlightReviewHost {
  settings: HighlightReviewSettings;
  /** annotation id → 复习状态（插件内存里的同一份对象，视图直接改字段） */
  getStore(): ReviewStore;
  getLog(): ReviewLog;
  /** 防抖落盘 */
  persist(): void;
  /** 重新读高亮（内部用 HighlightStore.load() + buildCards）；失败返回 null */
  loadCards(): Promise<ReviewCard[] | null>;
  openSource(card: ReviewCard): void;
  openVideo(card: ReviewCard): void;
}

interface ViewState {
  category: CardCategory | "";
  source: string;
  search: string;
  starredOnly: boolean;
  dueOnly: boolean;
  index: number;
  back: boolean;
  queue: ReviewCard[];
  counts: { due: number; fresh: number };
  view: "cards" | "stats";
}

interface Shell {
  sub: HTMLElement;
  strip: HTMLElement;
  chips: HTMLElement;
  source: HTMLSelectElement;
  search: HTMLInputElement;
  starToggle: HTMLElement;
  dueToggle: HTMLElement;
  fill: HTMLElement;
  progressText: HTMLElement;
  stage: HTMLElement;
  footer: HTMLElement;
  statsPanel: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function iconButton(icon: string, label: string, cls?: string): HTMLButtonElement {
  const btn = el("button", `lc-btn ${cls || ""}`);
  if (icon) {
    const span = el("span", "lc-icon");
    try {
      setIcon(span, icon);
    } catch {
      span.textContent = "";
    }
    btn.appendChild(span);
  }
  if (label) btn.appendChild(el("span", "lc-btn-label", label));
  return btn;
}

function isTypingTarget(target: Element | null): boolean {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (target as HTMLElement).isContentEditable;
}

/**
 * 高亮卡片复习面板：正面只给词条 / 句子，翻面看释义、讲解、出处原句、机翻、造句。
 */
export class HighlightReviewView extends ItemView {
  private readonly host: HighlightReviewHost;

  private cards: ReviewCard[] = [];

  private ready = false;

  private loadError = "";

  private shell: Shell | null = null;

  private state: ViewState = {
    category: "",
    source: "",
    search: "",
    starredOnly: false,
    dueOnly: true,
    index: 0,
    back: false,
    queue: [],
    counts: { due: 0, fresh: 0 },
    view: "cards",
  };

  constructor(leaf: WorkspaceLeaf, host: HighlightReviewHost) {
    super(leaf);
    this.host = host;
  }

  getViewType(): string {
    return HIGHLIGHT_REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "高亮卡片复习";
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("lc-root");
    this.registerDomEvent(document, "keydown", (evt: KeyboardEvent) => this.onKeyDown(evt));
    this.buildShell();
    await this.reload();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /* ------------------------------------------------------------------ 数据 */

  async reload(): Promise<void> {
    this.ready = false;
    this.loadError = "";
    this.cards = [];
    this.renderStatus();
    const cards = await this.host.loadCards();
    if (!cards || !cards.length) {
      this.loadError = "没有读到高亮数据。确认 Lingua Study 的高亮库文件存在，或先用 Ctrl+P → 重新载入高亮复习数据。";
      this.renderStatus();
      return;
    }
    this.cards = cards;
    this.ready = true;
    this.rebuild();
  }

  private getStore(): ReviewStore {
    return this.host.getStore();
  }

  private getLog(): ReviewLog {
    return this.host.getLog();
  }

  private today(): string {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* ------------------------------------------------------------------ 外壳 */

  private buildShell(): void {
    const root = this.contentEl;
    root.empty();

    const top = el("div", "lc-top");
    const titleRow = el("div", "lc-title-row");
    const title = el("div", "lc-title");
    title.appendChild(el("span", "lc-logo", "LC"));
    title.appendChild(el("h2", "", "高亮卡片"));
    const sub = el("span", "lc-sub", "");
    titleRow.appendChild(title);
    titleRow.appendChild(sub);
    titleRow.appendChild(el("div", "lc-spacer"));

    const btnStats = iconButton("bar-chart-2", "统计", "lc-btn-ghost");
    btnStats.addEventListener("click", () => this.toggleStats());
    const btnReload = iconButton("refresh-cw", "刷新", "lc-btn-ghost");
    btnReload.addEventListener("click", () => {
      void this.reload();
    });
    titleRow.appendChild(btnStats);
    titleRow.appendChild(btnReload);
    top.appendChild(titleRow);

    const strip = el("div", "lc-strip");
    top.appendChild(strip);

    const filters = el("div", "lc-filters");
    const chips = el("div", "lc-chips");
    filters.appendChild(chips);

    const right = el("div", "lc-filters-right");
    const source = document.createElement("select");
    source.className = "dropdown lc-source";
    source.addEventListener("change", () => {
      this.state.source = source.value;
      this.rebuild();
    });
    const search = document.createElement("input");
    search.type = "search";
    search.className = "lc-search";
    search.placeholder = "搜索词条 / 释义 / 来源";
    let timer: number | null = null;
    search.addEventListener("input", () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.state.search = search.value.trim();
        this.rebuild();
      }, 180);
    });
    const starToggle = el("button", "lc-toggle", "★ 收藏");
    starToggle.addEventListener("click", () => {
      this.state.starredOnly = !this.state.starredOnly;
      this.rebuild();
    });
    const dueToggle = el("button", "lc-toggle", "只看到期");
    dueToggle.addEventListener("click", () => {
      this.state.dueOnly = !this.state.dueOnly;
      this.rebuild();
    });
    right.appendChild(source);
    right.appendChild(search);
    right.appendChild(starToggle);
    right.appendChild(dueToggle);
    filters.appendChild(right);
    top.appendChild(filters);

    const progress = el("div", "lc-progress");
    const bar = el("div", "lc-bar");
    const fill = el("div", "lc-bar-fill");
    bar.appendChild(fill);
    const progressText = el("span", "lc-progress-text", "");
    progress.appendChild(bar);
    progress.appendChild(progressText);
    top.appendChild(progress);
    root.appendChild(top);

    const stage = el("div", "lc-stage");
    root.appendChild(stage);

    const footer = el("div", "lc-footer");
    root.appendChild(footer);

    const statsPanel = el("div", "lc-stats-panel lc-hidden");
    root.appendChild(statsPanel);

    this.shell = { sub, strip, chips, source, search, starToggle, dueToggle, fill, progressText, stage, footer, statsPanel };
  }

  /* ------------------------------------------------------------------ 队列 */

  private currentCard(): ReviewCard | null {
    return this.state.queue[this.state.index] || null;
  }

  private sources(): Array<{ path: string; alias: string; count: number }> {
    const map = new Map<string, { path: string; alias: string; count: number }>();
    for (const card of this.cards) {
      const key = card.sourcePath || "";
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { path: key, alias: card.sourceAlias || key, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias));
  }

  private introducedToday(): string[] {
    const day = this.getLog()[this.today()];
    return day && Array.isArray(day.newIds) ? day.newIds : [];
  }

  private rebuild(): void {
    if (!this.ready) {
      this.renderStatus();
      return;
    }
    const result = buildReviewQueue(this.cards, this.getStore(), {
      today: this.today(),
      newPerDay: this.host.settings.newPerDay,
      introducedToday: this.introducedToday(),
      category: this.state.category,
      sourcePath: this.state.source,
      starredOnly: this.state.starredOnly,
      onlyDue: this.state.dueOnly,
      search: this.state.search,
    });
    this.state.queue = result.queue;
    this.state.counts = { due: result.counts.due, fresh: result.counts.fresh };
    this.state.index = 0;
    this.state.back = false;
    this.render();
  }

  private renderStatus(): void {
    if (!this.shell) return;
    const { stage, footer, strip, progressText, fill } = this.shell;
    stage.empty();
    footer.empty();
    const box = el("div", "lc-status");
    if (this.loadError) {
      box.appendChild(el("div", "lc-status-title", "读不到高亮数据"));
      box.appendChild(el("div", "lc-status-text", this.loadError));
    } else {
      box.appendChild(el("div", "lc-status-title", "正在载入卡片…"));
      box.appendChild(el("div", "lc-status-text", "第一次打开需要读取字幕与机翻文件，稍等一两秒。"));
    }
    stage.appendChild(box);
    strip.textContent = "";
    progressText.textContent = "";
    fill.style.width = "0%";
  }

  /* ------------------------------------------------------------------ 渲染 */

  private render(): void {
    if (!this.shell || !this.ready) return;
    this.renderTop();
    this.renderFooter();
    if (this.state.view === "stats") {
      this.shell.stage.addClass("lc-hidden");
      this.shell.footer.addClass("lc-hidden");
      this.shell.statsPanel.removeClass("lc-hidden");
      this.renderStats();
    } else {
      this.shell.stage.removeClass("lc-hidden");
      this.shell.footer.removeClass("lc-hidden");
      this.shell.statsPanel.addClass("lc-hidden");
      this.renderCard();
    }
  }

  private stats(): ReturnType<typeof computeReviewStats> {
    return computeReviewStats(this.getStore(), this.getLog(), this.cards, { today: this.today() });
  }

  private renderTop(): void {
    if (!this.shell) return;
    const { sub, strip, chips, source, starToggle, dueToggle, fill, progressText } = this.shell;
    const stats = this.stats();
    sub.textContent = `${this.cards.length} 张卡 · ${this.sources().length} 个来源`;

    strip.textContent = "";
    const items: Array<[string, string, string]> = [
      ["今日", `${stats.todayTotal}`, stats.todayTotal >= stats.dueToday ? "ok" : ""],
      ["到期", `${stats.dueToday}`, stats.dueToday > 0 ? "warn" : ""],
      ["连续", `${stats.streak} 天`, stats.streak > 0 ? "ok" : ""],
      ["已掌握", `${stats.mastered}/${stats.total}`, ""],
      ["造句", `${stats.sentences}`, ""],
      ["收藏", `${stats.starred}`, ""],
    ];
    for (const [label, value, tone] of items) {
      const pill = el("div", `lc-pill ${tone}`);
      pill.appendChild(el("span", "lc-pill-label", label));
      pill.appendChild(el("span", "lc-pill-value", value));
      strip.appendChild(pill);
    }

    chips.textContent = "";
    const all = el("button", `lc-chip${this.state.category === "" ? " is-active" : ""}`, "全部");
    all.dataset.cat = "all";
    all.appendChild(el("span", "lc-chip-count", String(this.cards.length)));
    all.addEventListener("click", () => {
      this.state.category = "";
      this.rebuild();
    });
    chips.appendChild(all);

    for (const key of CATEGORY_ORDER) {
      const count = this.cards.filter((c) => c.category === key).length;
      if (!count) continue;
      const chip = el("button", `lc-chip${this.state.category === key ? " is-active" : ""}`, CAT_LABEL[key] || key);
      chip.dataset.cat = key;
      chip.appendChild(el("span", "lc-chip-count", String(count)));
      chip.addEventListener("click", () => {
        this.state.category = this.state.category === key ? "" : key;
        this.rebuild();
      });
      chips.appendChild(chip);
    }

    const sources = this.sources();
    const currentSource = this.state.source;
    source.textContent = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = `全部来源（${sources.length}）`;
    source.appendChild(optAll);
    for (const s of sources) {
      const opt = document.createElement("option");
      opt.value = s.path;
      opt.textContent = `${s.alias} · ${s.count}`;
      source.appendChild(opt);
    }
    source.value = sources.some((s) => s.path === currentSource) ? currentSource : "";
    this.state.source = source.value;

    starToggle.classList.toggle("is-active", this.state.starredOnly);
    dueToggle.classList.toggle("is-active", this.state.dueOnly);

    const total = this.state.queue.length;
    const done = total ? Math.min(total, this.state.index + (this.state.view === "cards" ? 1 : 0)) : 0;
    fill.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
    progressText.textContent = total
      ? `${done} / ${total} · 到期 ${this.state.counts.due} · 新卡 ${this.state.counts.fresh}`
      : "队列为空";
  }

  private renderFooter(): void {
    if (!this.shell) return;
    const footer = this.shell.footer;
    footer.empty();
    const card = this.currentCard();

    const nav = el("div", "lc-footer-group");
    const prev = iconButton("chevron-left", "上一张", "lc-btn-ghost");
    prev.addEventListener("click", () => this.prev());
    const flip = iconButton("rotate-cw", "翻面", "lc-btn-ghost lc-flip-btn");
    flip.addEventListener("click", () => this.flip());
    const next = iconButton("chevron-right", "下一张", "lc-btn-ghost");
    next.addEventListener("click", () => this.next());
    nav.appendChild(prev);
    nav.appendChild(flip);
    nav.appendChild(next);
    footer.appendChild(nav);

    const grades = el("div", "lc-footer-group lc-grades");
    const g1 = el("button", "lc-grade lc-grade-forgot");
    g1.appendChild(el("span", "lc-grade-name", "忘记"));
    g1.appendChild(el("span", "lc-grade-hint", "1"));
    g1.addEventListener("click", () => this.gradeCurrent("forgot"));
    const g2 = el("button", "lc-grade lc-grade-fuzzy");
    g2.appendChild(el("span", "lc-grade-name", "模糊"));
    g2.appendChild(el("span", "lc-grade-hint", "2"));
    g2.addEventListener("click", () => this.gradeCurrent("fuzzy"));
    const g3 = el("button", "lc-grade lc-grade-know");
    g3.appendChild(el("span", "lc-grade-name", "记住"));
    g3.appendChild(el("span", "lc-grade-hint", "3"));
    g3.addEventListener("click", () => this.gradeCurrent("know"));
    grades.appendChild(g1);
    grades.appendChild(g2);
    grades.appendChild(g3);
    footer.appendChild(grades);

    const extras = el("div", "lc-footer-group lc-extras");
    const src = iconButton("external-link", "来源", "lc-btn-ghost");
    src.addEventListener("click", () => this.openSource());
    const star = iconButton("star", "收藏", "lc-btn-ghost");
    const st = card ? this.getStore()[card.id] : null;
    if (st && st.starred) star.classList.add("is-active");
    star.addEventListener("click", () => this.toggleStar());
    const rnd = iconButton("shuffle", "随机", "lc-btn-ghost");
    rnd.addEventListener("click", () => this.shuffle());
    extras.appendChild(src);
    extras.appendChild(star);
    extras.appendChild(rnd);
    footer.appendChild(extras);

    const disabled = !card;
    for (const btn of [g1, g2, g3, src, star, rnd, prev, next]) btn.disabled = disabled;
  }

  private renderCard(): void {
    if (!this.shell) return;
    const stage = this.shell.stage;
    stage.empty();
    const card = this.currentCard();
    if (!card) {
      const empty = el("div", "lc-status");
      empty.appendChild(el("div", "lc-status-title", "这个筛选下没有卡片"));
      empty.appendChild(
        el(
          "div",
          "lc-status-text",
          this.state.search || this.state.category || this.state.source
            ? "换个分类、来源或搜索词试试。"
            : "今天的到期卡已经复习完了 🎉 关掉「只看到期」可以自由复习全部卡片。"
        )
      );
      stage.appendChild(empty);
      if (this.shell) {
        this.shell.progressText.textContent = "0 / 0";
        this.shell.fill.style.width = "0%";
      }
      return;
    }

    const wrap = el("div", "lc-card");
    wrap.dataset.cat = card.category;
    wrap.tabIndex = 0;
    const inner = el("div", "lc-card-inner");
    const front = this.buildFront(card);
    const back = this.buildBack(card);
    inner.appendChild(front);
    inner.appendChild(back);
    wrap.appendChild(inner);
    wrap.addEventListener("click", (evt: MouseEvent) => {
      const target = evt.target as HTMLElement | null;
      if (target && target.closest("button, textarea, a, input, select")) return;
      // 背面不响应点击翻面（避免选词 / 滚动时误触），用「翻回」按钮或空格
      if (this.state.back) return;
      const selection = window.getSelection();
      if (selection && String(selection).length > 0) return;
      this.flip();
    });
    stage.appendChild(wrap);

    if (this.state.back) wrap.classList.add("is-flipped");
    else back.setAttribute("aria-hidden", "true");

    const total = this.state.queue.length;
    this.shell.progressText.textContent = `${this.state.index + 1} / ${total} · 到期 ${this.state.counts.due} · 新卡 ${this.state.counts.fresh}`;
    this.shell.fill.style.width = `${Math.round(((this.state.index + 1) / total) * 100)}%`;
  }

  private buildFront(card: ReviewCard): HTMLElement {
    const front = el("div", "lc-face lc-front");
    const head = el("div", "lc-card-head");
    head.appendChild(el("span", `lc-tag lc-tag-${card.category}`, CAT_LABEL[card.category] || "其他"));
    head.appendChild(el("span", "lc-kind", card.kind === "sentence" ? "字幕句" : "知识点"));
    const st = this.getStore()[card.id];
    if (st && st.starred) head.appendChild(el("span", "lc-star-mark", "★"));
    head.appendChild(el("div", "lc-spacer"));
    head.appendChild(el("span", "lc-time", prettyDate(card.createdAt)));
    front.appendChild(head);

    const term = el("div", "lc-term", card.front);
    if (card.front.length > 26) term.classList.add("lc-term-long");
    if (card.front.length > 120) term.classList.add("lc-term-xlong");
    front.appendChild(term);

    if (card.kind === "point" && card.frontSource !== "colon" && card.quote !== card.front) {
      front.appendChild(el("div", "lc-front-quote", card.quote));
    }

    const foot = el("div", "lc-card-foot");
    const state = this.getStore()[card.id];
    const level = state ? state.level : 0;
    const reps = state ? state.reps : 0;
    foot.appendChild(
      el(
        "span",
        "lc-meta",
        reps ? `第 ${reps + 1} 次复习 · 第 ${level} 档 · 下次 ${state && state.due ? state.due : "—"}` : "新卡 · 第一次见"
      )
    );
    foot.appendChild(el("span", "lc-hint", "空格 / 点击翻面 · → 下一张 · 1/2/3 评分"));
    front.appendChild(foot);

    front.appendChild(el("div", "lc-front-source", `来源：${card.sourceAlias || "未知"}`));
    return front;
  }

  private buildBack(card: ReviewCard): HTMLElement {
    const back = el("div", "lc-face lc-back");
    const scroll = el("div", "lc-back-scroll");

    const head = el("div", "lc-card-head");
    head.appendChild(el("span", `lc-tag lc-tag-${card.category}`, CAT_LABEL[card.category] || "其他"));
    head.appendChild(el("div", "lc-spacer"));
    const close = iconButton("rotate-cw", "翻回", "lc-btn-ghost lc-btn-mini");
    close.addEventListener("click", () => this.flip());
    head.appendChild(close);
    scroll.appendChild(head);

    if (card.gloss) scroll.appendChild(el("div", "lc-gloss", card.gloss));
    if (card.explain) scroll.appendChild(el("div", "lc-explain", card.explain));

    if (card.kind === "point" && card.quote && !card.explain) {
      scroll.appendChild(el("div", "lc-explain", card.quote));
    } else if (card.kind === "point" && card.frontSource !== "colon" && card.quote) {
      const q = el("div", "lc-quote-full");
      q.appendChild(el("span", "lc-label", "高亮原文"));
      q.appendChild(el("span", "lc-quote-text", card.quote));
      scroll.appendChild(q);
    }

    const ctx = card.context;
    if (ctx.text) {
      const box = el("div", "lc-context");
      box.appendChild(el("div", "lc-label", card.kind === "sentence" ? "原句" : "出处原句"));
      box.appendChild(el("p", "lc-ctx-en", ctx.text));
      if (this.host.settings.showTranslation && ctx.translation) {
        box.appendChild(el("p", "lc-ctx-zh", ctx.translation));
      }
      const meta = el("div", "lc-ctx-meta");
      const parts = [card.sourceAlias || "", ctx.start ? mmss(ctx.start) : ""].filter(Boolean);
      meta.appendChild(el("span", "lc-meta", parts.join(" · ")));
      box.appendChild(meta);

      const actions = el("div", "lc-ctx-actions");
      const bVideo = el("button", "lc-mini-btn", card.videoId ? `B 站 ${mmss(ctx.start)}` : "无视频");
      bVideo.disabled = !card.videoId;
      bVideo.addEventListener("click", () => this.host.openVideo(card));
      const bNote = el("button", "lc-mini-btn", "素材笔记");
      bNote.addEventListener("click", () => this.host.openSource(card));
      actions.appendChild(bVideo);
      actions.appendChild(bNote);
      box.appendChild(actions);
      scroll.appendChild(box);
    }

    const related = card.relatedIds
      .map((id) => this.cards.find((c) => c.id === id))
      .filter((c): c is ReviewCard => !!c)
      .slice(0, 4);
    if (related.length) {
      const rel = el("div", "lc-related");
      rel.appendChild(el("div", "lc-label", "同一句上的其它高亮"));
      for (const item of related) {
        const btn = el("button", "lc-related-item", item.front);
        btn.addEventListener("click", (evt: MouseEvent) => {
          evt.stopPropagation();
          this.jumpToCard(item.id);
        });
        rel.appendChild(btn);
      }
      scroll.appendChild(rel);
    }

    const writing = el("div", "lc-writing");
    writing.appendChild(el("div", "lc-label", "我的造句（可选）"));
    const ta = document.createElement("textarea");
    ta.className = "lc-writing-input";
    ta.rows = 2;
    ta.placeholder = card.kind === "sentence" ? "用这个句型写一句自己的话…" : `用 «${card.front}» 写一句自己的话…`;
    ta.value = this.getStore()[card.id] ? this.getStore()[card.id].sentence : "";
    const row = el("div", "lc-writing-row");
    const save = el("button", "lc-mini-btn lc-save", "保存造句");
    const status = el("span", "lc-save-status", ta.value ? "已保存" : "");
    save.addEventListener("click", (evt: MouseEvent) => {
      evt.stopPropagation();
      this.writeState(card.id, setSentence(this.getStore()[card.id], ta.value));
      status.textContent = ta.value.trim() ? "已保存 ✓" : "已清空";
      this.host.persist();
    });
    ta.addEventListener("click", (evt: MouseEvent) => evt.stopPropagation());
    row.appendChild(save);
    row.appendChild(status);
    writing.appendChild(ta);
    writing.appendChild(row);
    scroll.appendChild(writing);

    back.appendChild(scroll);
    return back;
  }

  /* ------------------------------------------------------------------ 交互 */

  private writeState(id: string, state: ReviewState): void {
    this.getStore()[id] = state;
  }

  private flip(): void {
    if (!this.currentCard()) return;
    this.state.back = !this.state.back;
    const wrap = this.shell ? this.shell.stage.querySelector(".lc-card") : null;
    if (wrap) wrap.classList.toggle("is-flipped", this.state.back);
    const back = this.shell ? this.shell.stage.querySelector(".lc-back") : null;
    if (back) back.setAttribute("aria-hidden", this.state.back ? "false" : "true");
  }

  private next(): void {
    if (!this.state.queue.length) return;
    if (this.state.index >= this.state.queue.length - 1) {
      new Notice("已经是最后一张了。关掉「只看到期」可以自由复习。");
      return;
    }
    this.state.index += 1;
    this.state.back = false;
    this.render();
  }

  private prev(): void {
    if (this.state.index <= 0) {
      new Notice("已经是第一张。");
      return;
    }
    this.state.index -= 1;
    this.state.back = false;
    this.render();
  }

  private gradeCurrent(grade: ReviewGrade): void {
    const card = this.currentCard();
    if (!card) return;
    const before = this.getStore()[card.id] || null;
    const nextState = applyGrade(before, grade, this.today());
    this.writeState(card.id, nextState);
    const isFirstMeet = !before || !before.reps;
    const day: DayLog = appendReviewLog(this.getLog(), this.today(), grade, isFirstMeet ? card.id : "");
    this.getLog()[this.today()] = day;
    this.host.persist();

    const isLast = this.state.index >= this.state.queue.length - 1;
    if (isLast) {
      this.rebuild();
      new Notice("这一轮复习完成 🎉");
      return;
    }
    this.state.index += 1;
    this.state.back = false;
    this.render();
  }

  private toggleStar(): void {
    const card = this.currentCard();
    if (!card) return;
    this.writeState(card.id, toggleStar(this.getStore()[card.id] || emptyState()));
    this.host.persist();
    this.render();
  }

  private shuffle(): void {
    if (this.state.queue.length < 2) return;
    const rest = this.state.queue.slice(this.state.index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rest[i];
      rest[i] = rest[j];
      rest[j] = tmp;
    }
    this.state.queue = this.state.queue.slice(0, this.state.index).concat(rest);
    this.state.back = false;
    this.render();
  }

  private jumpToCard(id: string): void {
    const inQueue = this.state.queue.findIndex((c) => c.id === id);
    if (inQueue >= 0) {
      this.state.index = inQueue;
    } else {
      const card = this.cards.find((c) => c.id === id);
      if (!card) return;
      this.state.queue.splice(this.state.index + 1, 0, card);
      this.state.index += 1;
    }
    this.state.back = true;
    this.render();
  }

  private openSource(): void {
    const card = this.currentCard();
    if (!card) return;
    this.host.openSource(card);
  }

  private toggleStats(): void {
    this.state.view = this.state.view === "stats" ? "cards" : "stats";
    this.render();
  }

  /* ------------------------------------------------------------------ 键盘 */

  private isActive(): boolean {
    try {
      if (this.containerEl && this.containerEl.offsetParent === null) return false;
    } catch {
      /* ignore */
    }
    try {
      if (this.app.workspace.activeLeaf === this.leaf) return true;
    } catch {
      /* ignore */
    }
    const active = document.activeElement;
    return !!active && this.containerEl.contains(active);
  }

  private onKeyDown(evt: KeyboardEvent): void {
    if (evt.defaultPrevented || evt.isComposing || evt.altKey || evt.ctrlKey || evt.metaKey) return;
    if (isTypingTarget(document.activeElement)) {
      if (evt.key === "Escape") (document.activeElement as HTMLElement).blur();
      return;
    }
    if (!this.isActive()) return;

    const actions: Record<string, () => void> = {
      ArrowRight: () => this.next(),
      ArrowLeft: () => this.prev(),
      j: () => this.next(),
      k: () => this.prev(),
      " ": () => this.flip(),
      Spacebar: () => this.flip(),
      Enter: () => this.flip(),
      "1": () => this.gradeCurrent("forgot"),
      "2": () => this.gradeCurrent("fuzzy"),
      "3": () => this.gradeCurrent("know"),
      s: () => this.openSource(),
      f: () => this.toggleStar(),
      r: () => this.shuffle(),
      Escape: () => {
        this.state.view = "cards";
        this.render();
      },
    };
    const fn = actions[evt.key];
    if (!fn) return;
    evt.preventDefault();
    evt.stopPropagation();
    fn();
  }

  /* ------------------------------------------------------------------ 统计 */

  private renderStats(): void {
    if (!this.shell) return;
    const panel = this.shell.statsPanel;
    panel.empty();
    const stats = this.stats();

    const head = el("div", "lc-stats-head");
    head.appendChild(el("h3", "", "学习统计"));
    const back = el("button", "lc-mini-btn", "← 回到卡片");
    back.addEventListener("click", () => this.toggleStats());
    head.appendChild(back);
    panel.appendChild(head);

    const grid = el("div", "lc-kpi-grid");
    const kpis: Array<[string, string, string]> = [
      ["今日复习", `${stats.todayTotal}`, `正确率 ${stats.todayAccuracy}%`],
      ["连续天数", `${stats.streak}`, "天"],
      ["累计复习", `${stats.totalReviews}`, `总正确率 ${stats.totalAccuracy}%`],
      ["已学 / 掌握", `${stats.learned} / ${stats.mastered}`, `共 ${stats.total} 张`],
      ["已造句", `${stats.sentences}`, "张写了造句"],
      ["收藏", `${stats.starred}`, "张标记星标"],
    ];
    for (const [label, value, hint] of kpis) {
      const cell = el("div", "lc-kpi");
      cell.appendChild(el("div", "lc-kpi-label", label));
      cell.appendChild(el("div", "lc-kpi-value", value));
      cell.appendChild(el("div", "lc-kpi-hint", hint));
      grid.appendChild(cell);
    }
    panel.appendChild(grid);

    const heat = el("div", "lc-heat");
    const head2 = el("div", "lc-stats-head");
    head2.appendChild(el("h4", "", "复习热力图"));
    head2.appendChild(el("span", "lc-meta", "最近 26 周"));
    heat.appendChild(head2);

    const map = el("div", "lc-heat-map");
    const data = buildHeatmap(this.getLog(), { today: this.today(), weeks: 26 });
    const weeksWrap = el("div", "lc-heat-weeks");
    for (let w = 0; w < data.weeks; w++) {
      const col = el("div", "lc-heat-col");
      for (let d = 0; d < 7; d++) {
        const cell = data.cells[w * 7 + d];
        const div = el("div", "lc-heat-cell");
        div.title = `${cell.date} · ${cell.count} 张`;
        if (cell.future) div.classList.add("is-future");
        else {
          const ratio = data.max ? cell.count / data.max : 0;
          div.dataset.level = String(cell.count === 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1);
        }
        col.appendChild(div);
      }
      weeksWrap.appendChild(col);
    }
    map.appendChild(weeksWrap);

    const legend = el("div", "lc-heat-legend");
    legend.appendChild(el("span", "lc-meta", "少"));
    for (let i = 0; i < 5; i++) {
      const cell = el("span", "lc-heat-cell");
      cell.dataset.level = String(i);
      legend.appendChild(cell);
    }
    legend.appendChild(el("span", "lc-meta", "多"));
    map.appendChild(legend);
    heat.appendChild(map);
    panel.appendChild(heat);

    const sentences = this.cards
      .filter((c) => {
        const st = this.getStore()[c.id];
        return !!(st && st.sentence && st.sentence.trim());
      })
      .slice(-8)
      .reverse();
    const box = el("div", "lc-sentence-list");
    box.appendChild(el("h4", "", `我的造句（${stats.sentences}）`));
    if (!sentences.length) {
      box.appendChild(el("div", "lc-meta", "还没有造句。翻开任意一张卡，在背面写一句自己的例句吧。"));
    }
    for (const card of sentences) {
      const st = this.getStore()[card.id];
      const item = el("div", "lc-sentence-item");
      item.appendChild(el("div", "lc-sentence-term", card.front));
      item.appendChild(el("div", "lc-sentence-text", st ? st.sentence : ""));
      box.appendChild(item);
    }
    panel.appendChild(box);
  }
}

function prettyDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
