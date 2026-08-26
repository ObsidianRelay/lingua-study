import { App, Modal, Notice, setIcon } from "obsidian";
import type { CachedBilibiliVideo } from "./bilibili-cache";
import {
  alignImportedRows,
  alignmentRowsToSegments,
  findAlignmentTimingIssues,
  formatAlignmentTime,
  parseAlignmentTime,
  parseImportedBilingualText,
  roundAlignmentTime,
  validateAlignmentBoundary,
  type AlignmentTimeBoundary,
  type ImportedTranscriptRow,
  type TranscriptAlignmentResult
} from "./document-transcript-core";
import type {
  DocumentImportDraft,
  DocumentImportPhase,
  DocumentImportTimeInput
} from "./document-import-draft";
import { extractImportedDocument } from "./document-parser";
import {
  groupTranscriptSegmentsIntoSentences,
  parseSubtitleFile
} from "./import-core";
import type { TranscriptSegment } from "./transcript-core";

const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;

interface ImportWizardOptions {
  initialDraft: DocumentImportDraft | null;
  getCachedVideo: (onProgress: (message: string) => void) => Promise<CachedBilibiliVideo>;
  localModelCached: () => Promise<boolean>;
  transcribeLocal: (
    cached: CachedBilibiliVideo,
    onProgress: (message: string) => void
  ) => Promise<import("./document-transcript-core").TimedRecognitionToken[]>;
  apply: (
    segments: TranscriptSegment[],
    chinese: string[],
    sourceLabel: string
  ) => Promise<void>;
  saveDraft: (draft: DocumentImportDraft) => Promise<void>;
  clearDraft: () => Promise<void>;
  onFinished: () => void;
}

class ConfirmActionModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly resolveValue: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.message });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    actions.createEl("button", { cls: "mod-cta", text: this.confirmLabel })
      .addEventListener("click", () => this.finish(true));
    actions.createEl("button", { text: "取消" })
      .addEventListener("click", () => this.finish(false));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveValue(false);
    }
  }

  private finish(value: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveValue(value);
    this.close();
  }
}

function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmLabel: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmActionModal(app, title, message, confirmLabel, resolve).open();
  });
}

export class DocumentTranscriptImportModal extends Modal {
  private rows: ImportedTranscriptRow[] = [];
  private result: TranscriptAlignmentResult | null = null;
  private sourceText = "";
  private phase: DocumentImportPhase = "input";
  private statusMessage = "";
  private statusError = false;
  private textareaEl: HTMLTextAreaElement | null = null;
  private previewEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private cachedVideo: CachedBilibiliVideo | null = null;
  private cachedVideoLoading: Promise<CachedBilibiliVideo> | null = null;
  private previewAudioEl: HTMLAudioElement | null = null;
  private previewSource = "";
  private previewSegmentIndex = 0;
  private previewTargetEnd: number | null = null;
  private previewCurrentTime = 0;
  private previewTotalDuration = 0;
  private previewResumeAfterSeek = false;
  private previewPlayButton: HTMLButtonElement | null = null;
  private previewSeekEl: HTMLInputElement | null = null;
  private previewTimeEl: HTMLElement | null = null;
  private activeCalibrationEl: HTMLElement | null = null;
  private calibrationFeedbackEl: HTMLElement | null = null;
  private recordStartButton: HTMLButtonElement | null = null;
  private recordEndButton: HTMLButtonElement | null = null;
  private issueSummaryEl: HTMLElement | null = null;
  private jumpIssueButton: HTMLButtonElement | null = null;
  private applyAlignmentButton: HTMLButtonElement | null = null;
  private activeCalibrationIndex: number | null = null;
  private readonly manuallyCalibratedRows = new Set<number>();
  private timeInputs: DocumentImportTimeInput[] = [];
  private alignmentRowEls: HTMLElement[] = [];
  private alignmentTimeInputs: Array<{
    start: HTMLInputElement;
    end: HTMLInputElement;
  }> = [];
  private alignmentStatusEls: HTMLElement[] = [];
  private alignmentPreviewButtons: HTMLButtonElement[] = [];
  private resultListEl: HTMLElement | null = null;
  private modalScrollTop = 0;
  private previewListScrollTop = 0;
  private resultListScrollTop = 0;
  private lastJumpedIssueIndex = -1;
  private draftSaveTimer: number | null = null;
  private opened = false;
  private restoredDraft = false;
  private finished = false;
  private busy = false;

  constructor(app: App, private readonly options: ImportWizardOptions) {
    super(app);
    this.modalEl.addClass("lingua-study-document-import-modal");
    const draft = options.initialDraft;
    if (draft) {
      this.restoredDraft = true;
      this.sourceText = draft.sourceText;
      this.rows = draft.rows.map((row) => ({ ...row }));
      this.result = draft.result
        ? { ...draft.result, rows: draft.result.rows.map((row) => ({ ...row })) }
        : null;
      this.timeInputs = draft.timeInputs.map((input) => ({ ...input }));
      draft.manuallyCalibratedRows.forEach((index) => this.manuallyCalibratedRows.add(index));
      this.activeCalibrationIndex = draft.activeCalibrationIndex;
      this.previewCurrentTime = draft.previewCurrentTime;
      this.modalScrollTop = draft.modalScrollTop;
      this.previewListScrollTop = draft.previewListScrollTop;
      this.resultListScrollTop = draft.resultListScrollTop;
      this.phase = draft.phase;
      this.statusMessage = draft.statusMessage;
      this.statusError = draft.statusError;
    }
  }

  openOrFocus(): void {
    if (!this.opened) {
      this.open();
    }
  }

  onOpen(): void {
    this.opened = true;
    this.contentEl.empty();
    this.titleEl.setText("为播放器添加字幕");
    this.contentEl.createEl("p", {
      text: "可直接选择带时间轴的 srt/vtt，或导入博主提供的中英文文稿后自动对齐视频。"
    });

    const source = this.contentEl.createDiv({ cls: "lingua-study-document-source" });
    const fileInput = source.createEl("input", { type: "file" });
    fileInput.accept = ".srt,.vtt,.pdf,.docx,.txt,.md,text/vtt,application/pdf";
    fileInput.addClass("lingua-study-file-input");
    const choose = source.createEl("button", { text: "选择字幕或文稿" });
    choose.addEventListener("click", () => fileInput.click());
    const discard = source.createEl("button", { text: "放弃本次导入" });
    discard.addClass("lingua-study-discard-draft");
    discard.addEventListener("click", () => void this.discardDraft());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) {
        void this.loadFile(file);
      }
      fileInput.value = "";
    });

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "lingua-study-document-paste",
      placeholder: "也可以把博主提供的英文或中英对照文本粘贴到这里…"
    });
    this.textareaEl.rows = 7;
    this.textareaEl.value = this.sourceText;
    this.textareaEl.addEventListener("input", () => {
      this.sourceText = this.textareaEl?.value ?? "";
      this.scheduleDraftSave();
    });
    const parse = this.contentEl.createEl("button", { cls: "mod-cta", text: "解析粘贴文本" });
    parse.addEventListener("click", () => this.parseText(this.textareaEl?.value ?? ""));

    this.statusEl = this.contentEl.createDiv({ cls: "lingua-study-import-status" });
    this.statusEl.setAttribute("role", "status");
    if (this.restoredDraft) {
      this.contentEl.createDiv({
        cls: "lingua-study-draft-restored",
        text: "已恢复此前未完成的字幕导入进度。"
      });
      this.restoredDraft = false;
    }
    this.previewEl = this.contentEl.createDiv({ cls: "lingua-study-document-preview" });
    this.resultEl = this.contentEl.createDiv({ cls: "lingua-study-alignment-result" });
    this.setStatus(this.statusMessage, this.statusError, false);
    if (this.rows.length > 0) {
      this.renderPreview();
    }
    if (this.result) {
      if (this.cachedVideo) {
        this.renderResult(true);
      } else {
        const previousStatus = this.statusMessage;
        const previousError = this.statusError;
        this.setStatus("正在恢复本地试听音轨…", false, false);
        void this.ensureCachedVideo((message) => this.setStatus(message))
          .then((cached) => {
            this.cachedVideo = cached;
            this.renderResult(true);
            this.setStatus(previousStatus || "已恢复本地对齐结果。", previousError);
          })
          .catch((error: unknown) => {
            this.setStatus(
              error instanceof Error ? error.message : "恢复本地试听音轨失败。",
              true
            );
          });
      }
    }
    window.requestAnimationFrame(() => {
      this.contentEl.scrollTop = Math.min(
        this.modalScrollTop,
        Math.max(0, this.contentEl.scrollHeight - this.contentEl.clientHeight)
      );
    });
  }

  onClose(): void {
    this.captureScrollPositions();
    this.flushDraftSave();
    this.stopPreview();
    this.contentEl.empty();
    this.opened = false;
  }

  private setStatus(message: string, error = false, save = true): void {
    this.statusMessage = message;
    this.statusError = error;
    this.statusEl?.setText(message);
    this.statusEl?.classList.toggle("is-error", error);
    if (save) {
      this.scheduleDraftSave();
    }
  }

  private async loadFile(file: File): Promise<void> {
    if (this.busy) {
      return;
    }
    const extension = file.name.toLocaleLowerCase("en-US").split(".").at(-1) ?? "";
    try {
      if (extension === "srt" || extension === "vtt") {
        if (file.size > MAX_SUBTITLE_BYTES) {
          throw new Error("SRT/VTT 文件不能超过 10 MB。");
        }
        const segments = groupTranscriptSegmentsIntoSentences(parseSubtitleFile(await file.text()));
        await this.applyDirect(segments, `本地字幕文件 ${file.name}`);
        return;
      }
      this.setStatus(`正在读取 ${file.name}…`);
      const text = await extractImportedDocument(file);
      if (this.textareaEl) {
        this.textareaEl.value = text;
      }
      this.parseText(text);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "文件读取失败。", true);
    }
  }

  private async applyDirect(segments: TranscriptSegment[], sourceLabel: string): Promise<void> {
    this.busy = true;
    this.setStatus("正在保存字幕并更新播放器…");
    try {
      await this.options.apply(segments, [], sourceLabel);
      new Notice(`已导入 ${segments.length} 条完整英文字幕。`, 6_000);
      this.finished = true;
      this.cancelScheduledDraftSave();
      await this.options.clearDraft();
      this.options.onFinished();
      this.close();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "字幕保存失败。", true);
    } finally {
      this.busy = false;
    }
  }

  private parseText(text: string): void {
    const rows = parseImportedBilingualText(text);
    if (rows.length === 0 || rows.every((row) => row.english.trim() === "")) {
      this.setStatus("没有识别到英文文稿，请检查复制内容或文档排版。", true);
      return;
    }
    this.sourceText = text;
    if (this.textareaEl) {
      this.textareaEl.value = text;
    }
    this.rows = rows;
    this.phase = "preview";
    this.invalidateResults();
    this.setStatus(`已整理 ${rows.length} 行，请先检查中英文配对，再选择对齐方式。`);
    this.renderPreview();
  }

  private invalidateResults(): void {
    this.result = null;
    this.timeInputs = [];
    this.manuallyCalibratedRows.clear();
    this.activeCalibrationIndex = null;
    this.phase = this.rows.length > 0 ? "preview" : "input";
    this.resultEl?.empty();
    this.scheduleDraftSave();
  }

  private renderPreview(): void {
    if (!this.previewEl) {
      return;
    }
    const previousList = this.previewEl.querySelector<HTMLElement>(
      ".lingua-study-document-row-list"
    );
    const listScrollTop = previousList?.scrollTop ?? this.previewListScrollTop;
    const modalScrollTop = this.contentEl.scrollTop || this.modalScrollTop;
    this.previewEl.empty();
    const heading = this.previewEl.createDiv({ cls: "lingua-study-document-preview-heading" });
    heading.createEl("strong", { text: `文稿预览 · ${this.rows.length} 行` });
    heading.createEl("button", { text: "新增一行" }).addEventListener("click", () => {
      this.rows.push({ english: "", chinese: "" });
      this.invalidateResults();
      this.renderPreview();
    });
    const list = this.previewEl.createDiv({ cls: "lingua-study-document-row-list" });
    this.rows.forEach((row, index) => {
      const item = list.createDiv({ cls: "lingua-study-document-row" });
      item.classList.toggle("has-unpaired-content", row.english.trim() === "" || row.chinese.trim() === "");
      item.createSpan({ cls: "lingua-study-document-row-number", text: `${index + 1}` });
      const english = item.createEl("textarea", { cls: "lingua-study-document-english" });
      english.value = row.english;
      english.setAttribute("aria-label", `第 ${index + 1} 行英文`);
      const chinese = item.createEl("textarea", { cls: "lingua-study-document-chinese" });
      chinese.value = row.chinese;
      chinese.setAttribute("aria-label", `第 ${index + 1} 行中文`);
      const update = (): void => {
        row.english = english.value.trim();
        row.chinese = chinese.value.trim();
        this.invalidateResults();
        this.scheduleDraftSave();
      };
      english.addEventListener("change", update);
      chinese.addEventListener("change", update);
      const actions = item.createDiv({ cls: "lingua-study-document-row-actions" });
      const iconButton = (icon: string, label: string, action: () => void): void => {
        const button = actions.createEl("button", { attr: { "aria-label": label } });
        setIcon(button, icon);
        button.setAttribute("data-tooltip-position", "top");
        button.setAttribute("aria-label", label);
        button.addEventListener("click", action);
      };
      iconButton("arrow-up", "上移", () => this.moveRow(index, -1));
      iconButton("arrow-down", "下移", () => this.moveRow(index, 1));
      iconButton("split", "按完整句拆分", () => this.splitRow(index));
      iconButton("combine", "与下一行合并", () => this.mergeNext(index));
      iconButton("trash-2", "删除此行", () => {
        this.rows.splice(index, 1);
        this.invalidateResults();
        this.renderPreview();
      });
    });
    const controls = this.previewEl.createDiv({ cls: "lingua-study-alignment-controls" });
    controls.createEl("button", { cls: "mod-cta", text: "本地自动对齐" })
      .addEventListener("click", () => void this.runAlignment());

    // 行操作会重建预览列表；恢复内外两层滚动，避免用户被带回第一行。
    list.scrollTop = Math.min(listScrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
    this.previewListScrollTop = list.scrollTop;
    this.contentEl.scrollTop = Math.min(
      modalScrollTop,
      Math.max(0, this.contentEl.scrollHeight - this.contentEl.clientHeight)
    );
  }

  private moveRow(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.rows.length) {
      return;
    }
    const [row] = this.rows.splice(index, 1);
    if (row) {
      this.rows.splice(target, 0, row);
      this.invalidateResults();
      this.renderPreview();
      this.scheduleDraftSave();
    }
  }

  private splitRow(index: number): void {
    const row = this.rows[index];
    if (!row) {
      return;
    }
    const split = parseImportedBilingualText(`${row.english}\n${row.chinese}`);
    if (split.length <= 1) {
      this.setStatus("这一行没有识别到多个完整句子；可以新增一行后手动调整。", true);
      return;
    }
    this.rows.splice(index, 1, ...split);
    this.invalidateResults();
    this.renderPreview();
    this.scheduleDraftSave();
  }

  private mergeNext(index: number): void {
    const current = this.rows[index];
    const next = this.rows[index + 1];
    if (!current || !next) {
      return;
    }
    current.english = `${current.english} ${next.english}`.replace(/\s+/gu, " ").trim();
    current.chinese = `${current.chinese}${next.chinese}`.trim();
    this.rows.splice(index + 1, 1);
    this.invalidateResults();
    this.renderPreview();
    this.scheduleDraftSave();
  }

  private async runAlignment(): Promise<void> {
    if (this.busy) {
      return;
    }
    const rows = this.rows.map((row) => ({
      english: row.english.trim(),
      chinese: row.chinese.trim()
    }));
    if (rows.some((row) => row.english === "")) {
      this.setStatus("仍有缺少英文的行，请先补全或删除。", true);
      return;
    }
    if (!await this.options.localModelCached()) {
      const confirmed = await confirmAction(
        this.app,
        "首次使用本地自动对齐",
        "插件将下载固定版本的 Whisper Base English 模型和 WASM 运行文件到系统缓存。处理时会占用较多内存和时间，但音视频不会上传。",
        "下载并开始"
      );
      if (!confirmed) {
        return;
      }
    }
    this.busy = true;
    this.phase = "aligning";
    this.setStatus("正在准备本地缓存视频…");
    try {
      const cached = await this.ensureCachedVideo((message) => this.setStatus(message));
      this.cachedVideo = cached;
      const tokens = await this.options.transcribeLocal(
        cached,
        (message) => this.setStatus(message)
      );
      const result = alignImportedRows(rows, tokens);
      this.result = result;
      this.phase = "result";
      this.previewCurrentTime = 0;
      this.activeCalibrationIndex = null;
      this.manuallyCalibratedRows.clear();
      this.timeInputs = result.rows.map((row) => ({
        start: formatAlignmentTime(row.start),
        end: formatAlignmentTime(row.end),
        startInvalid: false,
        endInvalid: false
      }));
      this.setStatus(
        `本地对齐完成：${result.matchedCount}/${result.rows.length} 行匹配，` +
        `${result.lowConfidenceCount} 行需要重点检查。`
      );
      this.renderResult(false);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "自动对齐失败。", true);
    } finally {
      this.busy = false;
      if (this.phase === "aligning") {
        this.phase = "preview";
      }
      this.flushDraftSave();
    }
  }

  private renderResult(restoring: boolean): void {
    if (!this.resultEl || !this.result) {
      return;
    }
    this.stopPreview();
    this.resultEl.empty();
    this.resultEl.createDiv({
      cls: "lingua-study-alignment-result-summary",
      text: `本地识别匹配度 · ${Math.round(this.result.averageConfidence * 100)}%`
    });
    const result = this.result;
    this.previewTotalDuration = this.getTotalPreviewDuration();
    if (!restoring) {
      this.previewCurrentTime = 0;
    }
    this.previewTargetEnd = null;
    this.alignmentRowEls = [];
    this.alignmentTimeInputs = [];
    this.alignmentStatusEls = [];
    this.alignmentPreviewButtons = [];
    this.previewAudioEl = this.resultEl.createEl("audio", {
      cls: "lingua-study-alignment-audio",
      attr: { preload: "metadata" }
    });
    this.previewAudioEl.setAttribute("aria-label", "对齐结果试听播放器");
    this.previewAudioEl.addEventListener("timeupdate", () => this.handlePreviewProgress());
    this.previewAudioEl.addEventListener("ended", () => this.handlePreviewEnded());
    this.previewAudioEl.addEventListener("play", () => this.updatePreviewPlaybackButton());
    this.previewAudioEl.addEventListener("pause", () => this.updatePreviewPlaybackButton());

    const player = this.resultEl.createDiv({ cls: "lingua-study-alignment-player" });
    const transport = player.createDiv({ cls: "lingua-study-alignment-transport" });
    this.previewPlayButton = transport.createEl("button", {
      attr: { "aria-label": "播放对齐音频" }
    });
    setIcon(this.previewPlayButton, "play");
    this.previewPlayButton.addEventListener("click", () => {
      void this.togglePreviewPlayback().catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : "无法播放本地试听音轨。", true);
      });
    });
    const backward = transport.createEl("button", { text: "−0.5 秒" });
    backward.setAttribute("aria-label", "后退 0.5 秒");
    backward.addEventListener("click", () => {
      void this.nudgePreview(-0.5).catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : "无法后退 0.5 秒。", true);
      });
    });
    this.previewTimeEl = transport.createSpan({
      cls: "lingua-study-alignment-clock",
      text: `${formatAlignmentTime(0)} / ${formatAlignmentTime(this.previewTotalDuration)}`
    });
    const forward = transport.createEl("button", { text: "+0.5 秒" });
    forward.setAttribute("aria-label", "前进 0.5 秒");
    forward.addEventListener("click", () => {
      void this.nudgePreview(0.5).catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : "无法前进 0.5 秒。", true);
      });
    });

    this.previewSeekEl = player.createEl("input", {
      cls: "lingua-study-alignment-seek",
      type: "range",
      attr: {
        min: "0",
        max: String(Math.max(0, this.previewTotalDuration)),
        step: "0.01",
        value: "0",
        "aria-label": "对齐音频总时间轴"
      }
    });
    this.previewSeekEl.addEventListener("input", () => {
      const audio = this.previewAudioEl;
      if (!this.previewResumeAfterSeek && audio && !audio.paused) {
        this.previewResumeAfterSeek = true;
        audio.pause();
      }
      this.previewCurrentTime = Number(this.previewSeekEl?.value ?? 0);
      this.updatePreviewUi();
      this.scheduleDraftSave();
    });
    this.previewSeekEl.addEventListener("change", () => {
      const target = Number(this.previewSeekEl?.value ?? 0);
      const resume = this.previewResumeAfterSeek;
      this.previewResumeAfterSeek = false;
      void this.seekPreviewTo(target, resume).catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : "无法跳转到所选时间。", true);
      });
    });

    const calibration = player.createDiv({ cls: "lingua-study-alignment-calibration" });
    this.activeCalibrationEl = calibration.createDiv({
      cls: "lingua-study-alignment-active-label",
      text: "请先在下方选择“校准此句”"
    });
    const markActions = calibration.createDiv({ cls: "lingua-study-alignment-mark-actions" });
    this.recordStartButton = markActions.createEl("button", { text: "设当前时间为开始" });
    this.recordStartButton.addEventListener("click", () => this.recordCalibrationStart());
    this.recordEndButton = markActions.createEl("button", { text: "设当前时间为结束" });
    this.recordEndButton.addEventListener("click", () => this.recordCalibrationEnd());
    this.calibrationFeedbackEl = calibration.createDiv({
      cls: "lingua-study-calibration-feedback"
    });
    this.calibrationFeedbackEl.setAttribute("role", "status");

    const list = this.resultEl.createDiv({ cls: "lingua-study-alignment-row-list" });
    this.resultListEl = list;
    result.rows.forEach((row, index) => {
      const item = list.createDiv({ cls: "lingua-study-alignment-row" });
      item.classList.toggle("is-low-confidence", row.confidence < 0.6);
      this.alignmentRowEls.push(item);
      const content = item.createDiv({ cls: "lingua-study-alignment-content" });
      content.createDiv({ cls: "lingua-study-alignment-text", text: row.english });
      const readout = content.createDiv({ cls: "lingua-study-alignment-readout" });
      const inputState = this.ensureTimeInput(index, row);
      const startLabel = readout.createEl("label");
      startLabel.createSpan({ text: "开始" });
      const start = startLabel.createEl("input", {
        type: "text",
        cls: "lingua-study-alignment-time-input",
        attr: {
          value: inputState.start,
          inputmode: "decimal",
          spellcheck: "false",
          "aria-label": `第 ${index + 1} 句开始时间`
        }
      });
      start.value = inputState.start;
      const endLabel = readout.createEl("label");
      endLabel.createSpan({ text: "结束" });
      const end = endLabel.createEl("input", {
        type: "text",
        cls: "lingua-study-alignment-time-input",
        attr: {
          value: inputState.end,
          inputmode: "decimal",
          spellcheck: "false",
          "aria-label": `第 ${index + 1} 句结束时间`
        }
      });
      end.value = inputState.end;
      this.bindTimeInput(start, index, "start");
      this.bindTimeInput(end, index, "end");
      this.alignmentTimeInputs.push({ start, end });
      const timing = item.createDiv({ cls: "lingua-study-alignment-timing" });
      const status = timing.createSpan({ cls: "lingua-study-alignment-row-status" });
      this.alignmentStatusEls.push(status);
      const calibrate = timing.createEl("button", { text: "校准此句" });
      calibrate.addEventListener("click", () => this.selectCalibrationRow(index));
      const preview = timing.createEl("button", {
        attr: { "aria-label": `试听第 ${index + 1} 句` }
      });
      setIcon(preview, "play");
      this.alignmentPreviewButtons.push(preview);
      preview.addEventListener("click", () => {
        void this.playPreview(row.start, row.end).catch((error: unknown) => {
          this.setStatus(error instanceof Error ? error.message : "无法试听当前句。", true);
        });
      });
    });
    const footer = this.resultEl.createDiv({ cls: "lingua-study-alignment-footer" });
    this.issueSummaryEl = footer.createDiv({ cls: "lingua-study-alignment-issues" });
    this.jumpIssueButton = footer.createEl("button", { text: "跳到下一条无效句" });
    this.jumpIssueButton.addEventListener("click", () => void this.jumpToNextIssue());
    this.applyAlignmentButton = footer.createEl("button", {
      cls: "mod-cta lingua-study-apply-alignment",
      text: "应用本地对齐结果"
    });
    this.applyAlignmentButton.addEventListener("click", () => void this.applyAlignment(result));
    this.refreshAlignmentUi();
    window.requestAnimationFrame(() => {
      list.scrollTop = Math.min(
        this.resultListScrollTop,
        Math.max(0, list.scrollHeight - list.clientHeight)
      );
    });
    void this.seekPreviewTo(this.previewCurrentTime, false).catch((error: unknown) => {
      this.setStatus(error instanceof Error ? error.message : "本地试听音轨加载失败。", true);
    });
  }

  private async applyAlignment(result: TranscriptAlignmentResult): Promise<void> {
    if (this.busy) {
      return;
    }
    if (this.hasInvalidTimeInputs()) {
      this.setCalibrationFeedback("仍有时间格式或范围错误，请先修正红色输入框。", true);
      return;
    }
    try {
      const segments = alignmentRowsToSegments(result.rows);
      this.busy = true;
      this.setStatus("正在保存字幕、中文译文并更新播放器…");
      await this.options.apply(
        segments,
        result.rows.map((row) => row.chinese.trim()),
        "本地 Whisper 文稿对齐"
      );
      new Notice(`已应用 ${segments.length} 条中英文字幕。`, 7_000);
      this.finished = true;
      this.cancelScheduledDraftSave();
      await this.options.clearDraft();
      this.options.onFinished();
      this.close();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "对齐结果保存失败。", true);
    } finally {
      this.busy = false;
    }
  }

  private ensureTimeInput(
    index: number,
    row: TranscriptAlignmentResult["rows"][number]
  ): DocumentImportTimeInput {
    const existing = this.timeInputs[index];
    if (existing) {
      return existing;
    }
    const created = {
      start: formatAlignmentTime(row.start),
      end: formatAlignmentTime(row.end),
      startInvalid: false,
      endInvalid: false
    };
    this.timeInputs[index] = created;
    return created;
  }

  private bindTimeInput(
    input: HTMLInputElement,
    index: number,
    boundary: AlignmentTimeBoundary
  ): void {
    input.addEventListener("input", () => {
      const state = this.timeInputs[index];
      if (!state) {
        return;
      }
      state[boundary] = input.value;
      state[`${boundary}Invalid`] = false;
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      this.scheduleDraftSave();
    });
    input.addEventListener("change", () => this.commitManualTime(index, boundary, input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commitManualTime(index, boundary, input);
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.restoreTimeInput(index, boundary, input);
        input.blur();
      }
    });
  }

  private restoreTimeInput(
    index: number,
    boundary: AlignmentTimeBoundary,
    input: HTMLInputElement
  ): void {
    const row = this.result?.rows[index];
    const state = this.timeInputs[index];
    if (!row || !state) {
      return;
    }
    const formatted = formatAlignmentTime(row[boundary]);
    state[boundary] = formatted;
    state[`${boundary}Invalid`] = false;
    input.value = formatted;
    this.setCalibrationFeedback(`已取消第 ${index + 1} 句的时间修改。`);
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
  }

  private commitManualTime(
    index: number,
    boundary: AlignmentTimeBoundary,
    input: HTMLInputElement
  ): void {
    const value = parseAlignmentTime(input.value);
    if (value === null) {
      this.markTimeInputInvalid(
        index,
        boundary,
        input,
        "时间格式应为 04:15.62；也支持 04:15 或 01:04:15.62。"
      );
      return;
    }
    const error = this.applyBoundaryValue(index, boundary, value);
    if (error) {
      this.markTimeInputInvalid(index, boundary, input, error);
      return;
    }
    const state = this.timeInputs[index];
    if (state) {
      state[boundary] = formatAlignmentTime(value);
      state[`${boundary}Invalid`] = false;
      input.value = state[boundary];
    }
    this.setCalibrationFeedback(
      `已修改第 ${index + 1} 句${boundary === "start" ? "开始" : "结束"}时间。`
    );
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
  }

  private markTimeInputInvalid(
    index: number,
    boundary: AlignmentTimeBoundary,
    input: HTMLInputElement,
    message: string
  ): void {
    const state = this.timeInputs[index];
    if (state) {
      state[boundary] = input.value;
      state[`${boundary}Invalid`] = true;
    }
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    this.activeCalibrationIndex = index;
    this.setCalibrationFeedback(message, true);
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
  }

  private applyBoundaryValue(
    index: number,
    boundary: AlignmentTimeBoundary,
    value: number
  ): string | null {
    const result = this.result;
    if (!result) {
      return "本地对齐结果尚未准备好。";
    }
    const error = validateAlignmentBoundary(
      result.rows,
      index,
      boundary,
      value,
      this.previewTotalDuration
    );
    if (error) {
      return error;
    }
    const row = result.rows[index];
    if (!row) {
      return "要修改的句子已经不存在，请重新选择。";
    }
    row[boundary] = value;
    if (boundary === "start" && row.end !== null && row.end <= value) {
      row.end = null;
      const state = this.timeInputs[index];
      if (state) {
        state.end = formatAlignmentTime(null);
        state.endInvalid = false;
        const inputs = this.alignmentTimeInputs[index];
        if (inputs) {
          inputs.end.value = state.end;
        }
      }
    }
    this.manuallyCalibratedRows.add(index);
    return null;
  }

  private setCalibrationFeedback(message: string, error = false): void {
    this.calibrationFeedbackEl?.setText(message);
    this.calibrationFeedbackEl?.classList.toggle("is-error", error);
  }

  private hasInvalidTimeInputs(): boolean {
    return this.timeInputs.some((input) => input.startInvalid || input.endInvalid);
  }

  private getIssueIndexes(): number[] {
    const result = this.result;
    if (!result) {
      return [];
    }
    const indexes = new Set(
      findAlignmentTimingIssues(result.rows, this.previewTotalDuration).map((issue) => issue.index)
    );
    this.timeInputs.forEach((input, index) => {
      if (input.startInvalid || input.endInvalid) {
        indexes.add(index);
      }
    });
    return [...indexes].sort((left, right) => left - right);
  }

  private async jumpToNextIssue(): Promise<void> {
    const indexes = this.getIssueIndexes();
    const result = this.result;
    if (!result || indexes.length === 0) {
      this.setCalibrationFeedback("当前没有需要修正的句子。");
      return;
    }
    const next = indexes.find((index) => index > this.lastJumpedIssueIndex) ?? indexes[0];
    this.lastJumpedIssueIndex = next ?? -1;
    this.selectCalibrationRow(this.lastJumpedIssueIndex);
    const row = result.rows[this.lastJumpedIssueIndex];
    const timingIssue = findAlignmentTimingIssues(
      result.rows,
      this.previewTotalDuration
    ).find((issue) => issue.index === this.lastJumpedIssueIndex);
    const previousEnd = result.rows[this.lastJumpedIssueIndex - 1]?.end ?? 0;
    const target = row?.start ?? previousEnd;
    this.alignmentRowEls[this.lastJumpedIssueIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
    if (Number.isFinite(target)) {
      try {
        await this.seekPreviewTo(target, false);
      } catch (error) {
        this.setCalibrationFeedback(
          error instanceof Error ? error.message : "无法定位到问题句。",
          true
        );
      }
    }
    window.setTimeout(() => {
      const state = this.timeInputs[this.lastJumpedIssueIndex];
      const inputs = this.alignmentTimeInputs[this.lastJumpedIssueIndex];
      if (!state || !inputs) {
        return;
      }
      if (state.startInvalid || row?.start === null || timingIssue?.kind === "overlap") {
        inputs.start.focus();
        inputs.start.select();
      } else {
        inputs.end.focus();
        inputs.end.select();
      }
    }, 180);
    this.setCalibrationFeedback(`已定位到第 ${this.lastJumpedIssueIndex + 1} 句。`);
  }

  private ensureCachedVideo(
    onProgress: (message: string) => void
  ): Promise<CachedBilibiliVideo> {
    if (this.cachedVideo) {
      return Promise.resolve(this.cachedVideo);
    }
    if (this.cachedVideoLoading) {
      return this.cachedVideoLoading;
    }
    const loading = this.options.getCachedVideo(onProgress).then((cached) => {
      this.cachedVideo = cached;
      return cached;
    });
    this.cachedVideoLoading = loading;
    void loading.finally(() => {
      if (this.cachedVideoLoading === loading) {
        this.cachedVideoLoading = null;
      }
    }).catch(() => undefined);
    return loading;
  }

  private getSegmentOffset(index: number): number {
    const durations = this.cachedVideo?.manifest.segments ?? [];
    let offset = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
      offset += durations[cursor]?.duration ?? 0;
    }
    return offset;
  }

  private getTotalPreviewDuration(): number {
    return roundAlignmentTime((this.cachedVideo?.manifest.segments ?? [])
      .reduce((total, segment) => total + Math.max(0, segment.duration), 0));
  }

  private findPreviewSegment(time: number): { index: number; offset: number } | null {
    const cached = this.cachedVideo;
    if (!cached || cached.fileUrls.length === 0) {
      return null;
    }
    let offset = 0;
    for (const [index, segment] of cached.manifest.segments.entries()) {
      const next = offset + segment.duration;
      if (time < next || index === cached.fileUrls.length - 1) {
        return { index, offset };
      }
      offset = next;
    }
    return null;
  }

  private async playPreview(start: number | null, end: number | null): Promise<void> {
    if (
      start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || end <= start
    ) {
      throw new Error("这一句尚未完成有效时间标记，暂时不能试听。");
    }
    this.previewTargetEnd = end;
    await this.seekPreviewTo(start, true);
  }

  private handlePreviewProgress(): void {
    const audio = this.previewAudioEl;
    if (!audio) {
      return;
    }
    const globalTime = this.getSegmentOffset(this.previewSegmentIndex) + audio.currentTime;
    this.previewCurrentTime = Math.min(this.previewTotalDuration, globalTime);
    this.updatePreviewUi();
    if (this.previewTargetEnd !== null && globalTime >= this.previewTargetEnd) {
      audio.pause();
      this.previewCurrentTime = this.previewTargetEnd;
      this.updatePreviewUi();
    }
  }

  private handlePreviewEnded(): void {
    const cached = this.cachedVideo;
    const audio = this.previewAudioEl;
    if (!cached || !audio) {
      return;
    }
    const nextIndex = this.previewSegmentIndex + 1;
    if (
      nextIndex >= cached.fileUrls.length ||
      (this.previewTargetEnd !== null && this.getSegmentOffset(nextIndex) >= this.previewTargetEnd)
    ) {
      this.previewCurrentTime = this.previewTargetEnd ?? this.previewTotalDuration;
      this.updatePreviewUi();
      return;
    }
    void this.seekPreviewTo(this.getSegmentOffset(nextIndex), true).catch(() => {
      this.setStatus("试听跨越缓存分段时被播放器阻止，请点击播放继续。", true);
    });
  }

  private async togglePreviewPlayback(): Promise<void> {
    const audio = this.previewAudioEl;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    this.previewTargetEnd = null;
    const start = this.previewCurrentTime >= this.previewTotalDuration
      ? 0
      : this.previewCurrentTime;
    await this.seekPreviewTo(start, true);
  }

  private async nudgePreview(delta: number): Promise<void> {
    const audio = this.previewAudioEl;
    const resume = Boolean(audio && !audio.paused);
    await this.seekPreviewTo(this.previewCurrentTime + delta, resume);
  }

  private async seekPreviewTo(globalTime: number, resume: boolean): Promise<void> {
    const audio = this.previewAudioEl;
    const cached = this.cachedVideo;
    const clamped = Math.max(0, Math.min(this.previewTotalDuration, globalTime));
    const target = this.findPreviewSegment(clamped);
    if (!audio || !cached || !target) {
      throw new Error("本地缓存试听播放器尚未准备好。");
    }
    audio.pause();
    const source = cached.fileUrls[target.index];
    if (!source) {
      throw new Error("当前时间对应的缓存分段不存在。");
    }
    this.previewSegmentIndex = target.index;
    if (this.previewSource !== source) {
      this.previewSource = source;
      audio.src = source;
      audio.load();
      await this.waitForPreviewMetadata(audio);
    }
    const localTime = Math.max(0, clamped - target.offset);
    audio.currentTime = Number.isFinite(audio.duration)
      ? Math.min(localTime, audio.duration)
      : localTime;
    this.previewCurrentTime = clamped;
    this.updatePreviewUi();
    if (resume && clamped < this.previewTotalDuration) {
      await audio.play();
    }
  }

  private updatePreviewPlaybackButton(): void {
    if (!this.previewPlayButton) {
      return;
    }
    const playing = Boolean(this.previewAudioEl && !this.previewAudioEl.paused);
    setIcon(this.previewPlayButton, playing ? "pause" : "play");
    this.previewPlayButton.setAttribute("aria-label", playing ? "暂停对齐音频" : "播放对齐音频");
  }

  private updatePreviewUi(): void {
    if (this.previewSeekEl) {
      this.previewSeekEl.value = String(this.previewCurrentTime);
    }
    this.previewTimeEl?.setText(
      `${formatAlignmentTime(this.previewCurrentTime)} / ${formatAlignmentTime(this.previewTotalDuration)}`
    );
    this.updatePreviewPlaybackButton();
  }

  private selectCalibrationRow(index: number): void {
    this.activeCalibrationIndex = index;
    this.setCalibrationFeedback(`已选择第 ${index + 1} 句，可以播放定位或直接修改时间。`);
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
  }

  private recordCalibrationStart(): void {
    const result = this.result;
    const index = this.activeCalibrationIndex;
    if (!result) {
      this.setCalibrationFeedback("本地对齐结果尚未准备好。", true);
      return;
    }
    if (index === null) {
      this.setCalibrationFeedback("请先在下方选择要校准的句子。", true);
      return;
    }
    const value = roundAlignmentTime(this.previewCurrentTime);
    const error = this.applyBoundaryValue(index, "start", value);
    if (error) {
      this.setCalibrationFeedback(error, true);
      return;
    }
    const state = this.timeInputs[index];
    const inputs = this.alignmentTimeInputs[index];
    if (state) {
      state.start = formatAlignmentTime(value);
      state.startInvalid = false;
      if (inputs) {
        inputs.start.value = state.start;
      }
    }
    this.setCalibrationFeedback(
      `已将第 ${index + 1} 句开始时间设为 ${formatAlignmentTime(value)}。`
    );
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
  }

  private recordCalibrationEnd(): void {
    const result = this.result;
    const index = this.activeCalibrationIndex;
    if (!result) {
      this.setCalibrationFeedback("本地对齐结果尚未准备好。", true);
      return;
    }
    if (index === null) {
      this.setCalibrationFeedback("请先在下方选择要校准的句子。", true);
      return;
    }
    if (result.rows[index]?.start === null) {
      this.setCalibrationFeedback("请先设置这一句的开始时间。", true);
      return;
    }
    const value = roundAlignmentTime(this.previewCurrentTime);
    const error = this.applyBoundaryValue(index, "end", value);
    if (error) {
      this.setCalibrationFeedback(error, true);
      return;
    }
    const state = this.timeInputs[index];
    const inputs = this.alignmentTimeInputs[index];
    if (state) {
      state.end = formatAlignmentTime(value);
      state.endInvalid = false;
      if (inputs) {
        inputs.end.value = state.end;
      }
    }
    this.previewAudioEl?.pause();
    this.previewTargetEnd = null;
    const nextIndex = index + 1;
    this.activeCalibrationIndex = nextIndex < result.rows.length ? nextIndex : index;
    this.setCalibrationFeedback(
      `已将第 ${index + 1} 句结束时间设为 ${formatAlignmentTime(value)}。`
    );
    this.refreshAlignmentUi();
    this.scheduleDraftSave();
    if (nextIndex < this.alignmentRowEls.length) {
      this.alignmentRowEls[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  private refreshAlignmentUi(): void {
    const result = this.result;
    if (!result) {
      return;
    }
    const issues = findAlignmentTimingIssues(result.rows, this.previewTotalDuration);
    const issuesByIndex = new Map(issues.map((issue) => [issue.index, issue]));
    result.rows.forEach((row, index) => {
      const item = this.alignmentRowEls[index];
      const inputs = this.alignmentTimeInputs[index];
      const inputState = this.ensureTimeInput(index, row);
      const status = this.alignmentStatusEls[index];
      const preview = this.alignmentPreviewButtons[index];
      const issue = issuesByIndex.get(index);
      const hasInputError = inputState.startInvalid || inputState.endInvalid;
      item?.classList.toggle("is-active-calibration", index === this.activeCalibrationIndex);
      item?.classList.toggle("has-invalid-time", Boolean(issue) || hasInputError);
      inputs?.start.classList.toggle("is-invalid", inputState.startInvalid);
      inputs?.end.classList.toggle("is-invalid", inputState.endInvalid);
      inputs?.start.setAttribute("aria-invalid", String(inputState.startInvalid));
      inputs?.end.setAttribute("aria-invalid", String(inputState.endInvalid));
      if (status) {
        status.setText(
          hasInputError
            ? "输入需修正"
            : issue?.kind === "missing"
            ? "待标记"
            : issue
              ? "时间需修正"
              : this.manuallyCalibratedRows.has(index)
                ? "人工校准"
                : `匹配 ${Math.round(row.confidence * 100)}%`
        );
      }
      if (preview) {
        const validForPreview = row.start !== null && row.end !== null &&
          Number.isFinite(row.start) && Number.isFinite(row.end) &&
          row.start >= 0 && row.end > row.start && row.end <= this.previewTotalDuration;
        preview.disabled = !validForPreview;
        preview.title = validForPreview
          ? `试听第 ${index + 1} 句`
          : "缺少有效时间，完成标记后才能试听";
      }
    });
    if (this.activeCalibrationIndex === null) {
      this.activeCalibrationEl?.setText("请先在下方选择“校准此句”");
    } else {
      this.activeCalibrationEl?.setText(`当前校准：第 ${this.activeCalibrationIndex + 1} 句`);
    }
    const issueIndexes = this.getIssueIndexes();
    this.issueSummaryEl?.setText(
      issueIndexes.length === 0
        ? "全部句子时间有效，可以应用结果。"
        : `还有 ${issueIndexes.length} 句待标记或时间无效，处理完成后才能应用。`
    );
    this.issueSummaryEl?.classList.toggle("is-error", issueIndexes.length > 0);
    if (this.jumpIssueButton) {
      this.jumpIssueButton.disabled = issueIndexes.length === 0;
    }
    if (this.applyAlignmentButton) {
      this.applyAlignmentButton.disabled = issueIndexes.length > 0 || this.busy;
    }
  }

  private scheduleDraftSave(): void {
    if (this.finished) {
      return;
    }
    if (this.draftSaveTimer !== null) {
      window.clearTimeout(this.draftSaveTimer);
    }
    this.draftSaveTimer = window.setTimeout(() => {
      this.draftSaveTimer = null;
      void this.persistDraft();
    }, 350);
  }

  private flushDraftSave(): void {
    if (this.finished) {
      return;
    }
    this.cancelScheduledDraftSave();
    void this.persistDraft();
  }

  private cancelScheduledDraftSave(): void {
    if (this.draftSaveTimer !== null) {
      window.clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = null;
    }
  }

  private captureScrollPositions(): void {
    if (!this.opened) {
      return;
    }
    this.modalScrollTop = this.contentEl.scrollTop;
    this.previewListScrollTop = this.previewEl?.querySelector<HTMLElement>(
      ".lingua-study-document-row-list"
    )?.scrollTop ?? this.previewListScrollTop;
    this.resultListScrollTop = this.resultListEl?.scrollTop ?? this.resultListScrollTop;
  }

  private hasDraftProgress(): boolean {
    return this.sourceText.trim() !== "" || this.rows.length > 0 || this.result !== null;
  }

  private createDraft(): DocumentImportDraft {
    this.captureScrollPositions();
    return {
      version: 1,
      sourceText: this.sourceText,
      rows: this.rows.map((row) => ({ ...row })),
      result: this.result
        ? { ...this.result, rows: this.result.rows.map((row) => ({ ...row })) }
        : null,
      timeInputs: this.timeInputs.map((input) => ({ ...input })),
      manuallyCalibratedRows: [...this.manuallyCalibratedRows].sort((a, b) => a - b),
      activeCalibrationIndex: this.activeCalibrationIndex,
      previewCurrentTime: this.previewCurrentTime,
      modalScrollTop: this.modalScrollTop,
      previewListScrollTop: this.previewListScrollTop,
      resultListScrollTop: this.resultListScrollTop,
      phase: this.phase,
      statusMessage: this.statusMessage,
      statusError: this.statusError,
      updatedAt: new Date().toISOString()
    };
  }

  private async persistDraft(): Promise<void> {
    if (this.finished || !this.hasDraftProgress()) {
      return;
    }
    try {
      await this.options.saveDraft(this.createDraft());
    } catch {
      if (this.opened) {
        this.statusEl?.setText("字幕进度暂时无法保存，请检查 Obsidian 配置目录权限。");
        this.statusEl?.addClass("is-error");
      }
    }
  }

  private async discardDraft(): Promise<void> {
    const confirmed = await confirmAction(
      this.app,
      "放弃本次字幕导入？",
      "这会删除当前粘贴内容、整理结果和所有人工校准时间，且无法恢复。",
      "确认放弃"
    );
    if (!confirmed) {
      return;
    }
    this.finished = true;
    this.cancelScheduledDraftSave();
    await this.options.clearDraft();
    this.options.onFinished();
    new Notice("已放弃本次字幕导入并清除草稿。", 5_000);
    this.close();
  }

  private stopPreview(): void {
    if (!this.previewAudioEl) {
      return;
    }
    this.previewAudioEl.pause();
    this.previewAudioEl.removeAttribute("src");
    this.previewAudioEl.load();
    this.previewAudioEl = null;
    this.previewSource = "";
    this.previewTargetEnd = null;
    this.previewPlayButton = null;
    this.previewSeekEl = null;
    this.previewTimeEl = null;
  }

  private waitForPreviewMetadata(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(
        new Error("试听音轨加载超时，请检查本地缓存后重试。")
      ), 8_000);
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        audio.removeEventListener("abort", onAbort);
      };
      const finish = (error?: Error): void => {
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onLoaded = (): void => finish();
      const onError = (): void => finish(new Error("试听音轨加载失败。"));
      const onAbort = (): void => finish(new Error("试听音轨加载被中止。"));
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.addEventListener("abort", onAbort, { once: true });
    });
  }
}
