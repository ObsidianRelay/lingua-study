import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type LinguaStudyPlugin from "./main";
import type { StudyChatContext, StudyChatSession } from "./study-chat-core";
import { StudyChatTextAnimator } from "./study-chat-text-animator";
import type { DeepSeekModel } from "./translation-core";
import type { StudyChatReasoningEffort } from "./study-chat-core";
import type { StudyProfile } from "./study-core";

export const STUDY_CHAT_VIEW_TYPE = "lingua-study-chat";

export class StudyChatView extends ItemView {
  private unsubscribeProfile: (() => void) | null = null;
  private opened = false;
  private streamingSession: StudyChatSession | null = null;
  private streamingAnimator: StudyChatTextAnimator | null = null;
  private streamingLogEl: HTMLElement | null = null;
  private historyOpen = false;
  private historyQuery = "";
  private contextExpanded = false;
  private readonly activeRequests = new Set<AbortController>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LinguaStudyPlugin) {
    super(leaf);
  }

  getViewType(): string { return STUDY_CHAT_VIEW_TYPE; }
  getDisplayText(): string { return "Lingua Study 学习聊天"; }
  getIcon(): string { return "message-circle"; }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.unsubscribeProfile = this.plugin.subscribeStudyProfile(() => {
      this.historyQuery = "";
      this.contextExpanded = false;
      this.render();
    });
    this.render();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    for (const request of this.activeRequests) request.abort();
    this.unsubscribeProfile?.();
    this.unsubscribeProfile = null;
    this.streamingAnimator?.dispose();
    this.streamingAnimator = null;
    this.streamingSession = null;
    this.streamingLogEl = null;
    this.contentEl.empty();
  }

  refresh(): void { this.render(); }

  openWithContext(context: StudyChatContext): void {
    const profile = this.plugin.settings.studyProfile;
    const current = this.plugin.chatSessions.get(profile);
    if (current.pending) {
      new Notice("当前回答尚未完成，请稍后再选择其他句子。", 5_000);
      return;
    }
    this.plugin.chatSessions.attachContext(profile, context);
    this.historyOpen = false;
    this.historyQuery = "";
    this.contextExpanded = false;
    this.render();
  }

  private render(): void {
    if (!this.opened) return;
    const profile = this.plugin.settings.studyProfile;
    const session = this.plugin.chatSessions.get(profile);
    const root = this.contentEl;
    const previousSession = this.streamingSession;
    const previousAnimator = this.streamingAnimator;
    const previousLog = this.streamingLogEl;
    const sameDisplayedSession = previousSession === session;
    const sameStreamingSession = sameDisplayedSession && session.pending;
    const followBottom = !sameDisplayedSession || !previousLog ||
      previousLog.scrollHeight - previousLog.scrollTop - previousLog.clientHeight < 80;
    const previousScrollTop = previousLog?.scrollTop ?? 0;
    if (!sameStreamingSession) previousAnimator?.dispose();
    this.streamingSession = null;
    this.streamingAnimator = null;
    this.streamingLogEl = null;
    root.empty();
    root.addClass("lingua-study-chat-view");
    root.classList.toggle("is-history-open", this.historyOpen);

    if (this.historyOpen) {
      const drawer = root.createEl("aside", {
        cls: "lingua-study-chat-history-drawer",
        attr: { "aria-label": "历史对话" }
      });
      const drawerHeader = drawer.createDiv({ cls: "lingua-study-chat-history-header" });
      drawerHeader.createEl("strong", { text: "历史对话" });
      const close = this.createIconButton(drawerHeader, "panel-left-close", "收起历史对话");
      close.addEventListener("click", () => {
        this.historyOpen = false;
        this.historyQuery = "";
        this.render();
      });
      const newConversation = drawer.createEl("button", {
        cls: "lingua-study-chat-history-new",
        text: "新对话"
      });
      newConversation.type = "button";
      newConversation.disabled = session.pending;
      newConversation.addEventListener("click", () => this.startNewConversation(profile));
      const search = drawer.createEl("input", {
        cls: "lingua-study-chat-history-search",
        attr: { type: "search", "aria-label": "搜索历史对话", placeholder: "搜索对话" }
      });
      search.value = this.historyQuery;
      const list = drawer.createEl("nav", {
        cls: "lingua-study-chat-history-list",
        attr: { "aria-label": "对话列表" }
      });
      const updateList = (): void => {
        list.empty();
        const query = this.historyQuery.trim().toLocaleLowerCase();
        const matches = this.plugin.chatSessions.list(profile).filter((saved) => {
          const question = saved.messages.find((message) => message.role === "user")?.content ?? "";
          return !query || `${question} ${saved.context?.sentence ?? ""} ${saved.context?.focus ?? ""}`
            .toLocaleLowerCase().includes(query);
        });
        if (matches.length === 0) {
          list.createDiv({ cls: "lingua-study-chat-history-empty", text: "没有匹配的对话" });
        }
        for (const saved of matches) {
          const entry = list.createEl("button", { cls: "lingua-study-chat-history-item" });
          entry.type = "button";
          entry.disabled = session.pending;
          if (saved === session) {
            entry.addClass("is-current");
            entry.setAttribute("aria-current", "true");
          }
          const question = saved.messages.find((message) => message.role === "user")?.content;
          entry.createSpan({
            cls: "lingua-study-chat-history-title",
            text: question || saved.context?.focus || saved.context?.sentence || "新对话"
          });
          entry.createSpan({
            cls: "lingua-study-chat-history-detail",
            text: `${saved === session ? "当前 · " : ""}${saved.context ? "学习材料 · " : ""}${saved.messages.length} 条消息`
          });
          entry.addEventListener("click", () => {
            if (this.plugin.chatSessions.select(profile, saved)) {
              this.historyOpen = false;
              this.historyQuery = "";
              this.contextExpanded = false;
              this.render();
            }
          });
        }
      };
      search.addEventListener("input", () => {
        this.historyQuery = search.value;
        updateList();
      });
      updateList();
    }
    const main = root.createDiv({ cls: "lingua-study-chat-main" });
    const header = main.createDiv({ cls: "lingua-study-chat-header" });
    const historyToggle = this.createIconButton(header, "panel-left", this.historyOpen ? "收起历史对话" : "展开历史对话");
    historyToggle.setAttribute("aria-expanded", String(this.historyOpen));
    historyToggle.addEventListener("click", () => {
      this.historyOpen = !this.historyOpen;
      if (!this.historyOpen) this.historyQuery = "";
      this.render();
    });
    header.createEl("h2", { text: "学习聊天" });
    const newButton = this.createIconButton(header, "square-pen", "新对话");
    newButton.disabled = session.pending;
    newButton.addEventListener("click", () => this.startNewConversation(profile));
    header.createDiv({
      cls: "lingua-study-chat-goal",
      text: `当前目标：${this.plugin.getStudyProfileLabel(profile)}`
    });

    const conversation = main.createDiv({ cls: "lingua-study-chat-messages" });
    conversation.setAttribute("role", "log");
    conversation.setAttribute("aria-label", "学习聊天记录");
    if (session.messages.length === 0) {
      const empty = conversation.createDiv({ cls: "lingua-study-chat-empty" });
      empty.createEl("h3", { text: "学习聊天" });
      empty.createDiv({
        text: session.context ? "围绕当前句子，提问词汇、语法或用法。" : "从一个英语知识点开始提问。"
      });
    }
    for (const message of session.messages) {
      const entry = conversation.createDiv({ cls: `lingua-study-chat-message is-${message.role}` });
      entry.createDiv({ cls: "lingua-study-chat-speaker", text: message.role === "user" ? "你" : "AI 老师" });
      const text = entry.createDiv({ cls: "lingua-study-chat-text" });
      if (message.role === "assistant") {
        text.addClass("markdown-rendered");
        void MarkdownRenderer.render(this.app, message.content, text, "", this).catch(() => {
          text.setText(message.content);
        });
      } else {
        text.setText(message.content);
      }
    }
    if (session.pending) {
      const entry = conversation.createDiv({ cls: "lingua-study-chat-message is-assistant is-pending" });
      entry.createDiv({ cls: "lingua-study-chat-speaker", text: "AI 老师 · 正在回答" });
      const viewWindow = root.ownerDocument.defaultView ?? window;
      const animator = sameStreamingSession && previousAnimator
        ? previousAnimator
        : new StudyChatTextAnimator(
          (callback) => viewWindow.requestAnimationFrame(callback),
          (frame) => viewWindow.cancelAnimationFrame(frame),
          session.pendingAnswer
        );
      const textEl = entry.createDiv({ cls: "lingua-study-chat-text" });
      const visibleText = animator.visibleText;
      const textNode = textEl.ownerDocument.createTextNode(visibleText || "正在思考……");
      textEl.appendChild(textNode);
      let hasContent = visibleText.length > 0;
      this.streamingSession = session;
      this.streamingAnimator = animator;
      this.streamingLogEl = conversation;
      animator.setRenderer((next) => {
        if (!this.opened || this.streamingSession !== session) return;
        const shouldFollow = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 80;
        if (!hasContent) {
          textNode.data = "";
          hasContent = true;
        }
        textNode.appendData(next);
        if (shouldFollow) conversation.scrollTop = conversation.scrollHeight;
      });
    }
    const bottom = main.createDiv({ cls: "lingua-study-chat-bottom" });
    if (session.error) bottom.createDiv({ cls: "lingua-study-chat-error", text: session.error });
    if (this.plugin.settings.chatProvider === "disabled") {
      bottom.createDiv({
        cls: "lingua-study-chat-setup",
        text: "请先在 Lingua Study 设置 → 学习聊天中选择聊天服务。"
      });
    }
    const form = bottom.createEl("form", { cls: "lingua-study-chat-form" });
    if (session.context) {
      const attachment = form.createDiv({ cls: "lingua-study-chat-attachment" });
      const chip = attachment.createEl("button", {
        cls: "lingua-study-chat-context-chip",
        text: session.context.focus
          ? `知识点：${session.context.focus} · ${session.context.sentence}`
          : `句子：${session.context.sentence}`
      });
      chip.type = "button";
      chip.setAttribute("aria-label", this.contextExpanded ? "收起学习材料" : "展开学习材料");
      chip.setAttribute("aria-expanded", String(this.contextExpanded));
      chip.addEventListener("click", () => {
        this.contextExpanded = !this.contextExpanded;
        this.render();
      });
      const remove = this.createIconButton(attachment, "x", "移除学习材料");
      remove.disabled = session.pending;
      remove.addEventListener("click", () => {
        this.plugin.chatSessions.removeContext(profile);
        this.contextExpanded = false;
        this.render();
      });
      if (this.contextExpanded) {
        const preview = form.createDiv({ cls: "lingua-study-chat-context-preview" });
        preview.createDiv({ text: session.context.sentence });
        if (session.context.focus) preview.createDiv({ text: `追问知识点：${session.context.focus}` });
      }
    }
    const composer = form.createDiv({ cls: "lingua-study-chat-composer" });
    const textarea = composer.createEl("textarea", { attr: { "aria-label": "输入英语学习问题", placeholder: "输入要问的英语知识点……" } });
    textarea.value = session.draft;
    textarea.maxLength = 2_000;
    textarea.disabled = session.pending;
    textarea.addEventListener("input", () => { session.draft = textarea.value; });
    let composing = false;
    textarea.addEventListener("compositionstart", () => { composing = true; });
    textarea.addEventListener("compositionend", () => { composing = false; });
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || composing) return;
      event.preventDefault();
      if (!session.pending && this.plugin.settings.chatProvider !== "disabled") form.requestSubmit();
    });
    const formFooter = composer.createDiv({ cls: "lingua-study-chat-form-footer" });
    const providerLabels = { disabled: "未配置聊天服务", deepseek: "DeepSeek", kimi: "Kimi", "openai-compatible": "兼容接口" };
    formFooter.createSpan({
      cls: "lingua-study-chat-provider",
      text: `${providerLabels[this.plugin.settings.chatProvider]} · ${this.plugin.getStudyProfileLabel(profile)}`
    });
    if (this.plugin.settings.chatProvider === "deepseek") {
      const controls = formFooter.createDiv({ cls: "lingua-study-chat-model-controls" });
      const modelLabel = controls.createEl("label", { cls: "lingua-study-chat-model-select" });
      modelLabel.createSpan({ text: "模型" });
      const modelSelect = modelLabel.createEl("select", { attr: { "aria-label": "聊天模型档位" } });
      modelSelect.createEl("option", { text: "Flash", value: "deepseek-v4-flash" });
      modelSelect.createEl("option", { text: "Pro", value: "deepseek-v4-pro" });
      modelSelect.value = this.plugin.settings.chatDeepSeekModel;
      modelSelect.disabled = session.pending;
      modelSelect.addEventListener("change", () => {
        void this.plugin.updateSettings({ chatDeepSeekModel: modelSelect.value as DeepSeekModel });
      });
      const effortLabel = controls.createEl("label", { cls: "lingua-study-chat-model-select" });
      effortLabel.createSpan({ text: "思考" });
      const effortSelect = effortLabel.createEl("select", { attr: { "aria-label": "聊天思考深度" } });
      effortSelect.createEl("option", { text: "直接回答", value: "none" });
      effortSelect.createEl("option", { text: "快速", value: "low" });
      effortSelect.createEl("option", { text: "标准", value: "high" });
      effortSelect.createEl("option", { text: "深入", value: "max" });
      effortSelect.value = this.plugin.settings.chatDeepSeekEffort;
      effortSelect.disabled = session.pending;
      effortSelect.addEventListener("change", () => {
        void this.plugin.updateSettings({ chatDeepSeekEffort: effortSelect.value as StudyChatReasoningEffort });
      });
    } else if (this.plugin.settings.chatProvider === "kimi") {
      const controls = formFooter.createDiv({ cls: "lingua-study-chat-model-controls" });
      const effortLabel = controls.createEl("label", { cls: "lingua-study-chat-model-select" });
      effortLabel.createSpan({ text: "思考" });
      const effortSelect = effortLabel.createEl("select", { attr: { "aria-label": "Kimi 思考模式" } });
      effortSelect.createEl("option", { text: "直接回答", value: "off" });
      effortSelect.createEl("option", { text: "深入", value: "on" });
      effortSelect.value = this.plugin.settings.chatKimiThinking ? "on" : "off";
      effortSelect.disabled = session.pending;
      effortSelect.addEventListener("change", () => {
        void this.plugin.updateSettings({ chatKimiThinking: effortSelect.value === "on" });
      });
    }
    const send = this.createIconButton(formFooter, "arrow-up", "发送");
    send.type = "submit";
    send.disabled = session.pending || this.plugin.settings.chatProvider === "disabled";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send(profile, session);
    });
    bottom.createDiv({ cls: "lingua-study-chat-hint", text: "回车发送 · Shift + 回车换行 · 只发送当前问题和显示的学习材料" });
    conversation.scrollTop = followBottom ? conversation.scrollHeight : previousScrollTop;
    if (this.historyOpen) {
      const scrim = root.createDiv({ cls: "lingua-study-chat-history-scrim" });
      scrim.addEventListener("click", () => {
        this.historyOpen = false;
        this.historyQuery = "";
        this.render();
      });
    }
  }

  private createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "lingua-study-chat-icon-button" });
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    setIcon(button, icon);
    return button;
  }

  private startNewConversation(profile: StudyProfile): void {
    this.plugin.chatSessions.clear(profile);
    this.historyOpen = false;
    this.historyQuery = "";
    this.contextExpanded = false;
    this.render();
  }

  private async send(profile: StudyProfile, session: StudyChatSession): Promise<void> {
    if (session.pending) return;
    const question = session.draft.trim();
    if (!question) {
      session.error = "请先输入问题。";
      this.render();
      return;
    }
    const history = [...session.messages];
    const request = new AbortController();
    this.activeRequests.add(request);
    session.messages.push({ role: "user", content: question });
    session.draft = "";
    session.pending = true;
    session.pendingAnswer = "";
    session.error = null;
    this.render();
    try {
      const answer = await this.plugin.chat(profile, session.context, history, question, (delta) => {
        if (this.plugin.chatSessions.get(profile) !== session) return;
        session.pendingAnswer += delta;
        if (this.streamingSession === session) this.streamingAnimator?.append(delta);
      }, request.signal);
      if (this.plugin.chatSessions.get(profile) !== session) return;
      if (answer.startsWith(session.pendingAnswer)) {
        const tail = answer.slice(session.pendingAnswer.length);
        session.pendingAnswer += tail;
        if (this.streamingSession === session) this.streamingAnimator?.append(tail);
      }
      if (this.streamingSession === session) await this.streamingAnimator?.finish();
      session.messages.push({ role: "assistant", content: answer });
    } catch (error) {
      if (this.plugin.chatSessions.get(profile) !== session) return;
      session.messages.pop();
      session.draft = question;
      session.error = error instanceof Error ? error.message : "聊天请求失败，请稍后重试。";
    } finally {
      this.activeRequests.delete(request);
      session.pending = false;
      session.pendingAnswer = "";
      if (this.plugin.settings.studyProfile === profile) this.render();
    }
  }
}
