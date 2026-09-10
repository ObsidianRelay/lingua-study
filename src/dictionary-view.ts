import { ItemView, Modal, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import {
  normalizeLookupWord,
  type DictionaryEntry,
  type DictionaryLookupResult
} from "./dictionary-core";
import {
  isStudyProfile,
  STUDY_PROFILES,
  STUDY_PROFILE_LABELS,
  type StudyProfile
} from "./study-core";
import {
  buildDailyReviewQueue,
  getDailyReviewSummary,
  type ReviewRating,
  type VocabularyBookFile,
  type VocabularyContext,
  type VocabularyEntry
} from "./vocabulary-core";
import type LinguaStudyPlugin from "./main";

export const DICTIONARY_VIEW_TYPE = "lingua-study-dictionary";

export interface DictionaryLookupContext {
  word: string;
  sentence: string | null;
  sourcePath: string | null;
  transcriptPath: string | null;
  videoId: string | null;
  segmentIndex: number | null;
  start: number | null;
  end: number | null;
}

type DictionaryTab = "lookup" | "book" | "review";
type VocabularyFilter = "all" | StudyProfile | "due" | "new";

class VocabularyTextModal extends Modal {
  constructor(
    app: LinguaStudyPlugin["app"],
    private readonly title: string,
    private readonly description: string,
    private readonly initialValue: string,
    private readonly required: boolean,
    private readonly onSave: (value: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.description });
    const textarea = this.contentEl.createEl("textarea", {
      cls: "lingua-vocabulary-note-editor",
      attr: { "aria-label": this.title }
    });
    textarea.value = this.initialValue;
    const error = this.contentEl.createDiv({ cls: "lingua-vocabulary-modal-error" });
    const actions = this.contentEl.createDiv({ cls: "lingua-vocabulary-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "保存" });
    save.type = "button";
    save.addClass("mod-cta");
    save.addEventListener("click", () => {
      const value = textarea.value.trim();
      if (this.required && value === "") {
        error.setText("请先填写中文释义或备注。");
        return;
      }
      save.disabled = true;
      void this.onSave(value).then(() => this.close()).catch((caught) => {
        save.disabled = false;
        error.setText(caught instanceof Error ? caught.message : "保存失败，请重试。");
      });
    });
    window.setTimeout(() => textarea.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class VocabularyDeleteModal extends Modal {
  constructor(
    app: LinguaStudyPlugin["app"],
    private readonly word: string,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("删除生词");
    this.contentEl.createEl("p", {
      text: `确定删除“${this.word}”吗？相关语境和复习进度也会一并删除。`
    });
    const error = this.contentEl.createDiv({ cls: "lingua-vocabulary-modal-error" });
    const actions = this.contentEl.createDiv({ cls: "lingua-vocabulary-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
    const remove = actions.createEl("button", { text: "确认删除" });
    remove.type = "button";
    remove.addClass("mod-warning");
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void this.onConfirm().then(() => this.close()).catch((caught) => {
        remove.disabled = false;
        error.setText(caught instanceof Error ? caught.message : "删除失败，请重试。");
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class LinguaDictionaryView extends ItemView {
  private lookupContext: DictionaryLookupContext | null = null;
  private lookupResult: DictionaryLookupResult | null = null;
  private activeTab: DictionaryTab = "lookup";
  private vocabularyBook: VocabularyBookFile | null = null;
  private vocabularyWarning: string | null = null;
  private vocabularySearch = "";
  private vocabularyFilter: VocabularyFilter = "all";
  private selectedVocabularyId: string | null = null;
  private reviewEntryId: string | null = null;
  private reviewRevealed = false;
  private reviewRefreshTimer: number | null = null;
  private vocabularyExporting = false;
  private vocabularyImageExporting = false;
  private unsubscribeVocabulary: (() => void) | null = null;
  private opened = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LinguaStudyPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DICTIONARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${this.plugin.manifest.name} 词典`;
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.unsubscribeVocabulary = this.plugin.subscribeVocabulary(() => {
      void this.reloadVocabulary();
    });
    await this.reloadVocabulary();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.unsubscribeVocabulary?.();
    this.unsubscribeVocabulary = null;
    if (this.reviewRefreshTimer !== null) {
      window.clearTimeout(this.reviewRefreshTimer);
      this.reviewRefreshTimer = null;
    }
    this.contentEl.empty();
  }

  showLookup(context: DictionaryLookupContext): void {
    this.lookupContext = context;
    this.lookupResult = this.plugin.lookupDictionary(context.word);
    this.activeTab = "lookup";
    this.selectedVocabularyId = null;
    this.renderShell();
  }

  openVocabularyBook(): void {
    this.activeTab = "book";
    this.selectedVocabularyId = null;
    this.renderShell();
  }

  openReview(): void {
    this.activeTab = "review";
    this.reviewEntryId = null;
    this.reviewRevealed = false;
    void this.prepareReviewCard();
  }

  refreshStudyProfile(): void {
    this.renderShell();
  }

  refreshDictionarySource(): void {
    if (this.lookupContext) {
      this.lookupResult = this.plugin.lookupDictionary(this.lookupContext.word);
    }
    this.renderShell();
  }

  private async reloadVocabulary(): Promise<void> {
    const loaded = await this.plugin.loadVocabularyBook();
    if (!this.opened) {
      return;
    }
    this.vocabularyBook = loaded.book;
    this.vocabularyWarning = loaded.warning;
    if (
      this.selectedVocabularyId &&
      !this.vocabularyBook.entries[this.selectedVocabularyId]
    ) {
      this.selectedVocabularyId = null;
    }
    if (this.reviewEntryId && !this.vocabularyBook.entries[this.reviewEntryId]) {
      this.reviewEntryId = null;
    }
    this.renderShell();
  }

  private renderShell(): void {
    if (!this.opened) {
      return;
    }
    this.contentEl.empty();
    this.contentEl.addClass("lingua-dictionary-view");
    if (this.activeTab !== "review" && this.reviewRefreshTimer !== null) {
      window.clearTimeout(this.reviewRefreshTimer);
      this.reviewRefreshTimer = null;
    }

    const header = this.contentEl.createDiv({ cls: "lingua-dictionary-header" });
    header.createEl("h3", { text: this.plugin.manifest.name });
    header.createDiv({
      cls: "lingua-dictionary-source",
      text: this.plugin.getDictionarySourceLabel()
    });

    const summary = this.vocabularyBook
      ? getDailyReviewSummary(
        this.vocabularyBook,
        this.plugin.settings.dailyNewWordLimit,
        new Date()
      )
      : { total: 0 };
    const tabs = this.contentEl.createDiv({ cls: "lingua-dictionary-tabs", attr: { role: "tablist" } });
    this.createTabButton(tabs, "lookup", "查词");
    this.createTabButton(tabs, "book", "生词本");
    this.createTabButton(tabs, "review", "今日复习", summary.total);

    const body = this.contentEl.createDiv({ cls: "lingua-dictionary-body" });
    if (this.vocabularyWarning) {
      body.createDiv({
        cls: "lingua-vocabulary-warning",
        text: this.vocabularyWarning,
        attr: { role: "alert" }
      });
    }
    if (this.activeTab === "lookup") {
      this.renderLookup(body);
    } else if (this.activeTab === "book") {
      this.renderVocabularyBook(body);
    } else {
      this.renderReview(body);
    }
  }

  private createTabButton(
    parent: HTMLElement,
    tab: DictionaryTab,
    label: string,
    badgeCount: number | null = null
  ): void {
    const button = parent.createEl("button", {
      cls: tab === this.activeTab ? "is-active" : "",
      attr: {
        role: "tab",
        "aria-selected": (tab === this.activeTab).toString()
      }
    });
    button.type = "button";
    button.createSpan({ cls: "lingua-dictionary-tab-label", text: label });
    if (badgeCount !== null) {
      button.createSpan({
        cls: "lingua-dictionary-tab-badge",
        text: badgeCount.toLocaleString(),
        attr: { "aria-label": `${badgeCount.toLocaleString()} 项待复习` }
      });
    }
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.selectedVocabularyId = null;
      if (tab === "review") {
        this.reviewEntryId = null;
        this.reviewRevealed = false;
        void this.prepareReviewCard();
      } else {
        this.renderShell();
      }
    });
  }

  private renderLookup(parent: HTMLElement): void {
    const search = parent.createEl("form", { cls: "lingua-dictionary-search" });
    const input = search.createEl("input", {
      type: "search",
      value: this.lookupContext?.word ?? "",
      attr: {
        placeholder: "输入英文单词",
        "aria-label": "查询英文单词",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    const button = search.createEl("button", { text: "查询", type: "submit" });
    button.addClass("mod-cta");
    search.addEventListener("submit", (event) => {
      event.preventDefault();
      const word = input.value.trim();
      if (word === "") {
        return;
      }
      this.plugin.clearDictionaryHighlight();
      this.lookupContext = this.emptyLookupContext(word);
      this.lookupResult = this.plugin.lookupDictionary(word);
      this.renderShell();
    });

    const profileRow = parent.createDiv({ cls: "lingua-dictionary-profile" });
    profileRow.createEl("label", { text: "学习目标" });
    const profileSelect = profileRow.createDiv({ cls: "lingua-centered-select" });
    const select = profileSelect.createEl("select", { attr: { "aria-label": "学习目标" } });
    for (const profile of STUDY_PROFILES) {
      select.createEl("option", { value: profile, text: STUDY_PROFILE_LABELS[profile] });
    }
    const selectText = profileSelect.createSpan({
      cls: "lingua-centered-select-text",
      attr: { "aria-hidden": "true" }
    });
    const syncSelectText = (): void => {
      selectText.setText(select.selectedOptions[0]?.textContent ?? "");
    };
    select.value = this.plugin.settings.studyProfile;
    syncSelectText();
    select.addEventListener("change", () => {
      syncSelectText();
      const profile = select.value;
      if (isStudyProfile(profile)) {
        void this.plugin.setStudyProfile(profile).catch(() => {
          new Notice("学习目标保存失败，请重新加载插件后再试。", 5_000);
        });
      }
    });

    const resultEl = parent.createDiv({ cls: "lingua-dictionary-result" });
    if (!this.lookupResult || !this.lookupContext || this.lookupContext.word === "") {
      resultEl.createDiv({
        cls: "lingua-dictionary-empty",
        text: "双击英文字幕中的单词，释义会显示在这里。"
      });
      return;
    }
    this.renderLookupResult(resultEl, this.lookupResult);
  }

  private renderLookupResult(container: HTMLElement, result: DictionaryLookupResult): void {
    if (!result.entry) {
      const missing = container.createDiv({ cls: "lingua-dictionary-missing" });
      const title = missing.createDiv({ cls: "lingua-dictionary-word-row" });
      title.createEl("strong", { text: result.query || "该单词" });
      this.renderBookmarkButton(title, result);
      missing.createDiv({ text: "离线词库未收录。查词不会自动调用 AI。" });
      if (result.suggestions.length > 0) {
        missing.createDiv({ cls: "lingua-dictionary-section-title", text: "可能想查" });
        const suggestions = missing.createDiv({ cls: "lingua-dictionary-suggestions" });
        for (const suggestion of result.suggestions) {
          const button = suggestions.createEl("button", { text: suggestion });
          button.type = "button";
          button.addEventListener("click", () => {
            this.lookupContext = { ...this.emptyLookupContext(suggestion), ...this.contextLocation() };
            this.lookupResult = this.plugin.lookupDictionary(suggestion);
            this.renderShell();
          });
        }
      }
      this.renderLookupContext(missing);
      return;
    }
    this.renderDictionaryEntry(container, result.entry, result);
    this.renderLookupContext(container);
  }

  private renderDictionaryEntry(
    container: HTMLElement,
    entry: DictionaryEntry,
    result: DictionaryLookupResult
  ): void {
    const title = container.createDiv({ cls: "lingua-dictionary-word-row" });
    const heading = title.createDiv();
    heading.createEl("h2", { text: entry.word });
    if (entry.phonetic) {
      heading.createDiv({ cls: "lingua-dictionary-phonetic", text: `/ ${entry.phonetic} /` });
    }
    const actions = title.createDiv({ cls: "lingua-dictionary-word-actions" });
    const speak = this.createIconButton(actions, "volume-2", `朗读 ${entry.word}`);
    speak.addEventListener("click", () => this.plugin.speakDictionaryWord(entry.word));
    this.renderBookmarkButton(actions, result);

    const tags = container.createDiv({ cls: "lingua-dictionary-tags" });
    for (const profile of entry.examTags) {
      const badge = tags.createSpan({ text: STUDY_PROFILE_LABELS[profile] });
      badge.classList.toggle("is-current", profile === this.plugin.settings.studyProfile);
    }
    if (entry.examTags.length === 0) {
      tags.createSpan({ text: "高频词" });
    }
    const definitionCard = container.createDiv({ cls: "lingua-dictionary-definition-card" });
    if (entry.partOfSpeech) {
      this.renderSection(definitionCard, "词性", [entry.partOfSpeech]);
    }
    this.renderSection(
      definitionCard,
      "中文释义",
      entry.chineseTranslation.split("\n").filter((line) => line.trim() !== "")
    );
    if (entry.englishDefinition) {
      this.renderSection(
        definitionCard,
        "English definition",
        entry.englishDefinition.split("\n").filter((line) => line.trim() !== "")
      );
    }
    const referenceGrid = container.createDiv({ cls: "lingua-dictionary-reference-grid" });
    if (entry.inflections.length > 0) {
      const section = referenceGrid.createDiv({ cls: "lingua-dictionary-section" });
      section.createDiv({ cls: "lingua-dictionary-section-title", text: "词形变化" });
      const list = section.createDiv({ cls: "lingua-dictionary-inflections" });
      for (const inflection of entry.inflections) {
        const item = list.createDiv();
        item.createSpan({ text: `${inflection.label}：`, cls: "lingua-dictionary-muted" });
        item.createSpan({ text: inflection.value });
      }
    }
    const frequencies: string[] = [];
    if (entry.frequencyRank) {
      frequencies.push(`当代语料词频 #${entry.frequencyRank.toLocaleString()}`);
    }
    if (entry.bncRank) {
      frequencies.push(`BNC 词频 #${entry.bncRank.toLocaleString()}`);
    }
    if (frequencies.length > 0) {
      this.renderSection(referenceGrid, "词频参考", frequencies);
    }
    if (referenceGrid.childElementCount === 0) {
      referenceGrid.remove();
    }
  }

  private renderBookmarkButton(parent: HTMLElement, result: DictionaryLookupResult): void {
    const id = normalizeLookupWord(result.entry?.word ?? result.normalizedQuery);
    const saved = id !== "" && Boolean(this.vocabularyBook?.entries[id]);
    const button = this.createIconButton(
      parent,
      saved ? "bookmark-check" : "bookmark-plus",
      saved ? "更新到生词本" : "加入生词本"
    );
    button.classList.toggle("is-saved", saved);
    button.setAttribute("aria-pressed", saved.toString());
    button.addEventListener("click", () => {
      const lookupContext = this.lookupContext;
      if (!lookupContext) {
        return;
      }
      if (!result.entry) {
        new VocabularyTextModal(
          this.plugin.app,
          `收藏 ${result.query}`,
          "离线词典未收录这个词，请填写中文释义或自己的学习备注。",
          saved ? this.vocabularyBook?.entries[id]?.chineseTranslation ?? "" : "",
          true,
          async (meaning) => {
            await this.plugin.addVocabularyFromLookup(lookupContext, result, meaning);
            new Notice(saved ? "生词语境已更新。" : "已加入生词本。", 3_000);
          }
        ).open();
        return;
      }
      void this.plugin.addVocabularyFromLookup(lookupContext, result, "").then(() => {
        new Notice(saved ? "生词语境已更新。" : "已加入生词本。", 3_000);
      }).catch((caught) => {
        new Notice(caught instanceof Error ? caught.message : "生词保存失败。", 5_000);
      });
    });
  }

  private renderLookupContext(container: HTMLElement): void {
    const sentence = this.lookupContext?.sentence;
    if (!sentence) {
      return;
    }
    const context = container.createDiv({ cls: "lingua-dictionary-context" });
    const header = context.createDiv({ cls: "lingua-dictionary-context-header" });
    header.createDiv({ cls: "lingua-dictionary-section-title", text: "所在原句" });
    if (this.lookupContext?.start !== null && this.lookupContext?.start !== undefined) {
      header.createSpan({
        cls: "lingua-dictionary-context-timestamp",
        text: this.formatTimestamp(this.lookupContext.start)
      });
    }
    context.createDiv({ text: sentence, attr: { lang: "en" } });
    const sourcePath = this.lookupContext?.sourcePath;
    if (sourcePath) {
      context.createDiv({
        cls: "lingua-dictionary-context-source",
        text: sourcePath
      });
    }
  }

  private renderVocabularyBook(parent: HTMLElement): void {
    const book = this.vocabularyBook;
    if (!book) {
      parent.createDiv({ cls: "lingua-dictionary-empty", text: "正在读取生词本…" });
      return;
    }
    if (this.selectedVocabularyId) {
      const entry = book.entries[this.selectedVocabularyId];
      if (entry) {
        this.renderVocabularyDetail(parent, entry);
        return;
      }
    }

    const controls = parent.createDiv({ cls: "lingua-vocabulary-controls" });
    const results = parent.createDiv({ cls: "lingua-vocabulary-results" });
    const search = controls.createEl("input", {
      type: "search",
      value: this.vocabularySearch,
      attr: { placeholder: "搜索生词或释义", "aria-label": "搜索生词本" }
    });
    search.addEventListener("input", () => {
      this.vocabularySearch = search.value;
      this.renderVocabularyResults(results, book);
    });
    const filterSelect = controls.createDiv({ cls: "lingua-centered-select" });
    const filter = filterSelect.createEl("select", { attr: { "aria-label": "筛选生词" } });
    const filters: Array<[VocabularyFilter, string]> = [
      ["all", "全部"],
      ...STUDY_PROFILES.map(
        (profile): [StudyProfile, string] => [profile, STUDY_PROFILE_LABELS[profile]]
      ),
      ["due", "今日到期"],
      ["new", "未学习"]
    ];
    for (const [value, label] of filters) {
      filter.createEl("option", { value, text: label });
    }
    const filterText = filterSelect.createSpan({
      cls: "lingua-centered-select-text",
      attr: { "aria-hidden": "true" }
    });
    const syncFilterText = (): void => {
      filterText.setText(filter.selectedOptions[0]?.textContent ?? "");
    };
    filter.value = this.vocabularyFilter;
    syncFilterText();
    filter.addEventListener("change", () => {
      syncFilterText();
      this.vocabularyFilter = filter.value as VocabularyFilter;
      this.renderVocabularyResults(results, book);
    });

    this.renderVocabularyResults(results, book);
  }

  private renderVocabularyResults(parent: HTMLElement, book: VocabularyBookFile): void {
    parent.empty();
    const entries = this.filteredVocabularyEntries(book);
    const totalCount = Object.keys(book.entries).length;
    const stats = parent.createDiv({ cls: "lingua-vocabulary-stats" });
    const counts = stats.createDiv({ cls: "lingua-vocabulary-stats-counts" });
    counts.createSpan({ text: `共 ${totalCount} 个生词` });
    counts.createSpan({ text: `当前显示 ${entries.length} 个` });
    const exportActions = stats.createDiv({ cls: "lingua-vocabulary-export-actions" });
    const anyExporting = this.vocabularyExporting || this.vocabularyImageExporting;
    const exportButton = exportActions.createEl("button", {
      cls: "lingua-vocabulary-export-button",
      attr: {
        "aria-label": "导出生词本到笔记",
        title: "导出生词本到笔记"
      }
    });
    exportButton.type = "button";
    const exportIcon = exportButton.createSpan({ cls: "lingua-vocabulary-export-icon" });
    setIcon(exportIcon, "download");
    if (this.vocabularyExporting) {
      setIcon(exportIcon, "loader-circle");
      exportButton.addClass("is-loading");
      exportButton.setAttribute("aria-label", "正在导出生词本笔记");
      exportButton.title = "正在导出生词本笔记";
    }
    exportButton.disabled = totalCount === 0
      || this.vocabularyWarning !== null
      || anyExporting;
    exportButton.addEventListener("click", () => {
      if (
        this.vocabularyExporting ||
        this.vocabularyImageExporting ||
        totalCount === 0 ||
        this.vocabularyWarning !== null
      ) {
        return;
      }
      this.vocabularyExporting = true;
      exportButton.disabled = true;
      imageExportButton.disabled = true;
      setIcon(exportIcon, "loader-circle");
      exportButton.addClass("is-loading");
      exportButton.setAttribute("aria-label", "正在导出生词本笔记");
      exportButton.title = "正在导出生词本笔记";
      void this.plugin.exportVocabularyBookToNote().then((result) => {
        new Notice(`已导出 ${result.count} 个生词，并打开生词本笔记。`, 4_000);
      }).catch((caught) => {
        new Notice(caught instanceof Error ? caught.message : "生词本导出失败，请重试。", 6_000);
      }).finally(() => {
        this.vocabularyExporting = false;
        if (exportButton.isConnected) {
          exportButton.disabled = totalCount === 0 || this.vocabularyWarning !== null;
          imageExportButton.disabled = totalCount === 0
            || this.vocabularyWarning !== null
            || !this.plugin.capabilities.desktop;
          setIcon(exportIcon, "download");
          exportButton.removeClass("is-loading");
          exportButton.setAttribute("aria-label", "导出生词本到笔记");
          exportButton.title = "导出生词本到笔记";
        }
      });
    });
    const imageUnsupportedReason = "移动端暂不支持生词本长图导出，请在电脑端使用";
    const imageExportButton = exportActions.createEl("button", {
      cls: "lingua-vocabulary-export-button lingua-vocabulary-image-export-button",
      attr: {
        "aria-label": "将全部生词导出为长图",
        title: this.plugin.capabilities.desktop
          ? "将全部生词导出为长图"
          : imageUnsupportedReason
      }
    });
    imageExportButton.type = "button";
    const imageExportIcon = imageExportButton.createSpan({ cls: "lingua-vocabulary-export-icon" });
    setIcon(imageExportIcon, "image");
    if (this.vocabularyImageExporting) {
      setIcon(imageExportIcon, "loader-circle");
      imageExportButton.addClass("is-loading");
      imageExportButton.setAttribute("aria-label", "正在生成生词本长图");
      imageExportButton.title = "正在生成生词本长图";
    }
    imageExportButton.disabled = totalCount === 0
      || this.vocabularyWarning !== null
      || anyExporting
      || !this.plugin.capabilities.desktop;
    imageExportButton.addEventListener("click", () => {
      if (
        this.vocabularyExporting ||
        this.vocabularyImageExporting ||
        totalCount === 0 ||
        this.vocabularyWarning !== null ||
        !this.plugin.capabilities.desktop
      ) {
        return;
      }
      this.vocabularyImageExporting = true;
      exportButton.disabled = true;
      imageExportButton.disabled = true;
      setIcon(imageExportIcon, "loader-circle");
      imageExportButton.addClass("is-loading");
      imageExportButton.setAttribute("aria-label", "正在生成生词本长图");
      imageExportButton.title = "正在生成生词本长图";
      void this.plugin.exportVocabularyBookToImages().then((result) => {
        const warning = result.cleanupWarnings.length > 0
          ? ` ${result.cleanupWarnings.join("；")}`
          : "";
        new Notice(
          `已导出 ${result.wordCount} 个生词，共 ${result.pageCount} 张图片，并打开第一张长图。${warning}`,
          warning === "" ? 5_000 : 8_000
        );
      }).catch((caught) => {
        new Notice(caught instanceof Error ? caught.message : "生词本长图生成失败，请重试。", 7_000);
      }).finally(() => {
        this.vocabularyImageExporting = false;
        if (imageExportButton.isConnected) {
          exportButton.disabled = totalCount === 0 || this.vocabularyWarning !== null;
          imageExportButton.disabled = totalCount === 0
            || this.vocabularyWarning !== null
            || !this.plugin.capabilities.desktop;
          setIcon(imageExportIcon, "image");
          imageExportButton.removeClass("is-loading");
          imageExportButton.setAttribute("aria-label", "将全部生词导出为长图");
          imageExportButton.title = this.plugin.capabilities.desktop
            ? "将全部生词导出为长图"
            : imageUnsupportedReason;
        }
      });
    });
    if (entries.length === 0) {
      parent.createDiv({
        cls: "lingua-dictionary-empty",
        text: totalCount === 0
          ? "还没有生词。双击字幕单词查词后，点击书签即可收藏。"
          : "没有符合当前条件的生词。"
      });
      return;
    }
    const list = parent.createDiv({ cls: "lingua-vocabulary-list" });
    for (const entry of entries) {
      const item = list.createEl("button", { cls: "lingua-vocabulary-list-item" });
      item.type = "button";
      const heading = item.createDiv({ cls: "lingua-vocabulary-list-heading" });
      heading.createEl("strong", { text: entry.word });
      heading.createSpan({ text: this.reviewStatusLabel(entry) });
      item.createDiv({
        cls: "lingua-vocabulary-list-meaning",
        text: entry.chineseTranslation || entry.personalNote || "暂无释义"
      });
      const meta = item.createDiv({ cls: "lingua-vocabulary-list-meta" });
      meta.createSpan({ text: `${entry.contexts.length} 个语境` });
      if (entry.examTags.length > 0) {
        meta.createSpan({ text: entry.examTags.map((tag) => STUDY_PROFILE_LABELS[tag]).join(" · ") });
      }
      item.addEventListener("click", () => {
        this.selectedVocabularyId = entry.id;
        this.renderShell();
      });
    }
  }

  private filteredVocabularyEntries(book: VocabularyBookFile): VocabularyEntry[] {
    const query = this.vocabularySearch.trim().toLocaleLowerCase("zh-CN");
    const now = Date.now();
    return Object.values(book.entries).filter((entry) => {
      if (
        query !== "" &&
        !entry.word.toLocaleLowerCase("en-US").includes(query) &&
        !entry.chineseTranslation.toLocaleLowerCase("zh-CN").includes(query) &&
        !entry.personalNote.toLocaleLowerCase("zh-CN").includes(query)
      ) {
        return false;
      }
      if (this.vocabularyFilter === "due") {
        return entry.review.phase !== "new" && Date.parse(entry.review.dueAt) <= now;
      }
      if (this.vocabularyFilter === "new") {
        return entry.review.phase === "new";
      }
      if (this.vocabularyFilter !== "all") {
        return entry.examTags.includes(this.vocabularyFilter) ||
          entry.studyProfiles.includes(this.vocabularyFilter);
      }
      return true;
    }).sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  }

  private renderVocabularyDetail(parent: HTMLElement, entry: VocabularyEntry): void {
    const header = parent.createDiv({ cls: "lingua-vocabulary-detail-header" });
    const back = this.createIconButton(header, "arrow-left", "返回生词本");
    back.addEventListener("click", () => {
      this.selectedVocabularyId = null;
      this.renderShell();
    });
    const word = header.createDiv();
    word.createEl("h2", { text: entry.word });
    if (entry.phonetic) {
      word.createDiv({ cls: "lingua-dictionary-phonetic", text: `/ ${entry.phonetic} /` });
    }
    const speak = this.createIconButton(header, "volume-2", `朗读 ${entry.word}`);
    speak.addEventListener("click", () => this.plugin.speakDictionaryWord(entry.word));

    const status = parent.createDiv({ cls: "lingua-vocabulary-detail-status" });
    status.createSpan({ text: this.reviewStatusLabel(entry) });
    status.createSpan({ text: `已复习 ${entry.review.reviewCount} 次` });
    status.createSpan({ text: `遗忘 ${entry.review.lapses} 次` });
    this.renderSavedVocabularyTags(parent, entry);
    if (entry.partOfSpeech) {
      this.renderSection(parent, "词性", [entry.partOfSpeech]);
    }
    this.renderSection(parent, "中文释义", [entry.chineseTranslation || "暂无释义"]);
    if (entry.englishDefinition) {
      this.renderSection(parent, "English definition", [entry.englishDefinition]);
    }

    const note = parent.createDiv({ cls: "lingua-vocabulary-note" });
    const noteHeading = note.createDiv({ cls: "lingua-dictionary-section-title" });
    noteHeading.createSpan({ text: "个人备注" });
    const editNote = this.createIconButton(noteHeading, "pencil", "编辑个人备注");
    editNote.addEventListener("click", () => {
      new VocabularyTextModal(
        this.plugin.app,
        `编辑 ${entry.word} 的备注`,
        "可以记录记忆方法、易错点或自己的例句。留空会清除备注。",
        entry.personalNote,
        false,
        async (value) => {
          await this.plugin.updateVocabularyNote(entry.id, value);
          new Notice("生词备注已保存。", 3_000);
        }
      ).open();
    });
    note.createDiv({ text: entry.personalNote || "暂无个人备注。" });

    if (entry.contexts.length > 0) {
      const contexts = parent.createDiv({ cls: "lingua-vocabulary-contexts" });
      contexts.createDiv({ cls: "lingua-dictionary-section-title", text: "视频语境" });
      for (const context of [...entry.contexts].reverse()) {
        this.renderVocabularyContext(contexts, context);
      }
    }
    const actions = parent.createDiv({ cls: "lingua-vocabulary-detail-actions" });
    const review = actions.createEl("button", { text: "复习这个词" });
    review.type = "button";
    review.addClass("mod-cta");
    review.addEventListener("click", () => {
      this.activeTab = "review";
      this.reviewEntryId = entry.id;
      this.reviewRevealed = false;
      void this.ensureIntroducedAndRender(entry.id);
    });
    const remove = actions.createEl("button", { text: "删除生词" });
    remove.type = "button";
    remove.addClass("mod-warning");
    remove.addEventListener("click", () => {
      new VocabularyDeleteModal(this.plugin.app, entry.word, async () => {
        await this.plugin.removeVocabularyEntry(entry.id);
        this.selectedVocabularyId = null;
        new Notice("生词已删除。", 3_000);
      }).open();
    });
  }

  private renderVocabularyContext(parent: HTMLElement, context: VocabularyContext): void {
    const item = parent.createDiv({ cls: "lingua-vocabulary-context-item" });
    item.createDiv({ text: context.sentence, attr: { lang: "en" } });
    const meta = item.createDiv({ cls: "lingua-vocabulary-context-meta" });
    meta.createSpan({ text: `${this.formatTimestamp(context.start)} · ${context.sourcePath}` });
    const actions = meta.createDiv({ cls: "lingua-vocabulary-context-actions" });
    const open = this.createIconButton(actions, "locate-fixed", "回到视频原句（不播放）");
    open.addEventListener("click", () => {
      void this.plugin.openVocabularyContext(context).catch((caught) => {
        new Notice(caught instanceof Error ? caught.message : "无法打开视频原句。", 6_000);
      });
    });
  }

  private renderReview(parent: HTMLElement): void {
    const book = this.vocabularyBook;
    if (!book) {
      parent.createDiv({ cls: "lingua-dictionary-empty", text: "正在读取复习计划…" });
      return;
    }
    const summary = getDailyReviewSummary(book, this.plugin.settings.dailyNewWordLimit, new Date());
    const header = parent.createDiv({ cls: "lingua-review-summary" });
    header.createEl("strong", { text: `今日待复习 ${summary.total}` });
    header.createDiv({
      text: `学习中 ${summary.dueLearning} · 到期 ${summary.dueReview} · 新词 ${summary.availableNew}`
    });

    const entry = this.reviewEntryId ? book.entries[this.reviewEntryId] : null;
    if (!entry) {
      this.scheduleReviewRefresh(book);
      if (summary.total === 0) {
        const complete = parent.createDiv({ cls: "lingua-review-complete" });
        setIcon(complete.createDiv(), "circle-check");
        complete.createEl("strong", { text: "今天的复习已完成" });
        complete.createDiv({ text: "之后到期的单词会自动出现在这里。" });
      } else {
        const start = parent.createEl("button", { text: "开始今日复习" });
        start.type = "button";
        start.addClass("mod-cta");
        start.addEventListener("click", () => void this.prepareReviewCard());
      }
      return;
    }

    const card = parent.createDiv({ cls: "lingua-review-card" });
    card.createDiv({ cls: "lingua-review-card-label", text: "先回忆这个单词的含义" });
    card.createEl("h2", { text: entry.word, attr: { lang: "en" } });
    const speak = this.createIconButton(card, "volume-2", `朗读 ${entry.word}`);
    speak.addEventListener("click", () => this.plugin.speakDictionaryWord(entry.word));
    if (!this.reviewRevealed) {
      const reveal = card.createEl("button", { text: "显示答案" });
      reveal.type = "button";
      reveal.addClass("mod-cta");
      reveal.addEventListener("click", () => {
        this.reviewRevealed = true;
        this.renderShell();
      });
      return;
    }

    const answer = card.createDiv({ cls: "lingua-review-answer" });
    if (entry.phonetic) {
      answer.createDiv({ cls: "lingua-dictionary-phonetic", text: `/ ${entry.phonetic} /` });
    }
    if (entry.partOfSpeech) {
      answer.createDiv({ cls: "lingua-review-part-of-speech", text: entry.partOfSpeech });
    }
    this.renderSavedVocabularyTags(answer, entry);
    answer.createDiv({ cls: "lingua-review-meaning", text: entry.chineseTranslation || "暂无释义" });
    if (entry.personalNote) {
      answer.createDiv({ cls: "lingua-review-note", text: entry.personalNote });
    }
    const latestContext = entry.contexts.at(-1);
    if (latestContext) {
      const context = answer.createDiv({ cls: "lingua-review-context" });
      context.createDiv({ text: latestContext.sentence, attr: { lang: "en" } });
      const actions = context.createDiv({ cls: "lingua-review-context-actions" });
      const open = actions.createEl("button", { text: "回到视频原句" });
      open.type = "button";
      open.setAttribute("title", "只定位原句，不播放视频");
      open.addEventListener("click", () => {
        void this.plugin.openVocabularyContext(latestContext).catch((caught) => {
          new Notice(caught instanceof Error ? caught.message : "无法打开视频原句。", 6_000);
        });
      });
    }
    const ratings = card.createDiv({ cls: "lingua-review-ratings" });
    const options: Array<[ReviewRating, string, string]> = [
      ["again", "忘记", "10 分钟"],
      ["hard", "困难", this.nextIntervalLabel(entry, "hard")],
      ["good", "记得", this.nextIntervalLabel(entry, "good")],
      ["easy", "熟练", this.nextIntervalLabel(entry, "easy")]
    ];
    for (const [rating, label, interval] of options) {
      const button = ratings.createEl("button", { cls: `is-${rating}` });
      button.type = "button";
      button.createSpan({ text: label });
      button.createEl("small", { text: interval });
      button.addEventListener("click", () => void this.rateCurrentEntry(rating));
    }
  }

  private async prepareReviewCard(): Promise<void> {
    const loaded = await this.plugin.loadVocabularyBook();
    if (!this.opened) {
      return;
    }
    this.vocabularyBook = loaded.book;
    const queue = buildDailyReviewQueue(
      loaded.book,
      this.plugin.settings.dailyNewWordLimit,
      new Date()
    );
    this.reviewEntryId = queue[0] ?? null;
    this.reviewRevealed = false;
    if (this.reviewEntryId) {
      await this.ensureIntroducedAndRender(this.reviewEntryId);
    } else {
      this.renderShell();
    }
  }

  private async ensureIntroducedAndRender(id: string): Promise<void> {
    const entry = this.vocabularyBook?.entries[id];
    if (entry?.review.phase === "new" && entry.review.introducedAt === null) {
      this.vocabularyBook = await this.plugin.introduceVocabularyEntry(id, new Date());
    }
    if (this.opened) {
      this.renderShell();
    }
  }

  private async rateCurrentEntry(rating: ReviewRating): Promise<void> {
    const id = this.reviewEntryId;
    if (!id) {
      return;
    }
    try {
      this.vocabularyBook = await this.plugin.rateVocabularyEntry(id, rating, new Date());
      this.reviewEntryId = null;
      this.reviewRevealed = false;
      await this.prepareReviewCard();
    } catch (caught) {
      new Notice(caught instanceof Error ? caught.message : "复习进度保存失败。", 6_000);
    }
  }

  private scheduleReviewRefresh(book: VocabularyBookFile): void {
    if (this.reviewRefreshTimer !== null) {
      window.clearTimeout(this.reviewRefreshTimer);
      this.reviewRefreshTimer = null;
    }
    const now = Date.now();
    const nextDue = Object.values(book.entries)
      .filter((entry) => entry.review.phase !== "new" && Date.parse(entry.review.dueAt) > now)
      .reduce<number | null>((earliest, entry) => {
        const due = Date.parse(entry.review.dueAt);
        return earliest === null || due < earliest ? due : earliest;
      }, null);
    if (nextDue === null) {
      return;
    }
    const delay = Math.min(60_000, Math.max(250, nextDue - now + 50));
    this.reviewRefreshTimer = window.setTimeout(() => {
      this.reviewRefreshTimer = null;
      if (this.opened && this.activeTab === "review" && this.reviewEntryId === null) {
        void this.prepareReviewCard();
      }
    }, delay);
  }

  private nextIntervalLabel(entry: VocabularyEntry, rating: Exclude<ReviewRating, "again">): string {
    if (entry.review.intervalDays <= 0) {
      return rating === "hard" ? "1 天" : rating === "good" ? "3 天" : "7 天";
    }
    const multiplier = rating === "hard" ? 1.2 : rating === "good" ? 2.5 : 3.5;
    return `${Math.min(3_650, Math.max(1, Math.ceil(entry.review.intervalDays * multiplier)))} 天`;
  }

  private reviewStatusLabel(entry: VocabularyEntry): string {
    if (entry.review.phase === "new") {
      return "未学习";
    }
    if (Date.parse(entry.review.dueAt) <= Date.now()) {
      return "已到期";
    }
    return `下次 ${new Date(entry.review.dueAt).toLocaleDateString("zh-CN")}`;
  }

  private renderSavedVocabularyTags(parent: HTMLElement, entry: VocabularyEntry): void {
    const profiles = [...new Set([...entry.examTags, ...entry.studyProfiles])];
    if (profiles.length === 0) {
      return;
    }
    const tags = parent.createDiv({ cls: "lingua-dictionary-tags" });
    for (const profile of profiles) {
      const tag = tags.createSpan({ text: STUDY_PROFILE_LABELS[profile] });
      tag.classList.toggle("is-current", profile === this.plugin.settings.studyProfile);
    }
  }

  private contextLocation(): Partial<DictionaryLookupContext> {
    const current = this.lookupContext;
    return current ? {
      sentence: current.sentence,
      sourcePath: current.sourcePath,
      transcriptPath: current.transcriptPath,
      videoId: current.videoId,
      segmentIndex: current.segmentIndex,
      start: current.start,
      end: current.end
    } : {};
  }

  private emptyLookupContext(word: string): DictionaryLookupContext {
    return {
      word,
      sentence: null,
      sourcePath: null,
      transcriptPath: null,
      videoId: null,
      segmentIndex: null,
      start: null,
      end: null
    };
  }

  private createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "lingua-dictionary-icon-button",
      attr: { "aria-label": label, title: label }
    });
    button.type = "button";
    setIcon(button, icon);
    return button;
  }

  private renderSection(container: HTMLElement, title: string, lines: string[]): void {
    const section = container.createDiv({ cls: "lingua-dictionary-section" });
    section.createDiv({ cls: "lingua-dictionary-section-title", text: title });
    for (const line of lines) {
      section.createDiv({ text: line });
    }
  }

  private formatTimestamp(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  }
}
