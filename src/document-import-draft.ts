import type { App } from "obsidian";
import { AsyncKeyedQueue } from "./async-keyed-queue";
import type {
  ImportedTranscriptRow,
  TranscriptAlignmentResult
} from "./document-transcript-core";

export type DocumentImportPhase = "input" | "preview" | "aligning" | "result";

export interface DocumentImportTimeInput {
  start: string;
  end: string;
  startInvalid: boolean;
  endInvalid: boolean;
}

export interface DocumentImportDraft {
  version: 1;
  sourceText: string;
  rows: ImportedTranscriptRow[];
  result: TranscriptAlignmentResult | null;
  timeInputs: DocumentImportTimeInput[];
  manuallyCalibratedRows: number[];
  activeCalibrationIndex: number | null;
  previewCurrentTime: number;
  modalScrollTop: number;
  previewListScrollTop: number;
  resultListScrollTop: number;
  phase: DocumentImportPhase;
  statusMessage: string;
  statusError: boolean;
  updatedAt: string;
}

interface DocumentImportDraftFile {
  version: 1;
  drafts: Record<string, DocumentImportDraft>;
}

export interface DocumentImportDraftLoadResult {
  draft: DocumentImportDraft | null;
  warning: string | null;
}

const MAX_DRAFT_TEXT_LENGTH = 2_000_000;
const MAX_DRAFT_ROWS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function validateRows(value: unknown): ImportedTranscriptRow[] | null {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_ROWS) {
    return null;
  }
  const rows: ImportedTranscriptRow[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.english !== "string" || typeof raw.chinese !== "string") {
      return null;
    }
    rows.push({ english: raw.english, chinese: raw.chinese });
  }
  return rows;
}

function validateResult(value: unknown): TranscriptAlignmentResult | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length > MAX_DRAFT_ROWS) {
    return undefined;
  }
  const rows = [];
  for (const raw of value.rows) {
    if (!isRecord(raw) || typeof raw.english !== "string" || typeof raw.chinese !== "string") {
      return undefined;
    }
    const start = raw.start === null ? null : readFiniteNonNegative(raw.start);
    const end = raw.end === null ? null : readFiniteNonNegative(raw.end);
    if ((raw.start !== null && start === null) || (raw.end !== null && end === null) ||
      typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) {
      return undefined;
    }
    rows.push({
      english: raw.english,
      chinese: raw.chinese,
      start,
      end,
      confidence: raw.confidence
    });
  }
  if (
    typeof value.matchedCount !== "number" || !Number.isSafeInteger(value.matchedCount) ||
    typeof value.lowConfidenceCount !== "number" || !Number.isSafeInteger(value.lowConfidenceCount) ||
    typeof value.averageConfidence !== "number" || !Number.isFinite(value.averageConfidence)
  ) {
    return undefined;
  }
  return {
    rows,
    matchedCount: value.matchedCount,
    lowConfidenceCount: value.lowConfidenceCount,
    averageConfidence: value.averageConfidence
  };
}

export function createDocumentImportDraftKey(
  sourcePath: string,
  idType: "bvid" | "aid",
  videoId: string,
  page: number
): string {
  return [sourcePath, idType, videoId, String(page)].map(encodeURIComponent).join("|");
}

export function validateDocumentImportDraft(value: unknown): DocumentImportDraft | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.sourceText !== "string" ||
    value.sourceText.length > MAX_DRAFT_TEXT_LENGTH) {
    return null;
  }
  const rows = validateRows(value.rows);
  const result = validateResult(value.result);
  if (rows === null || result === undefined || !Array.isArray(value.timeInputs) ||
    value.timeInputs.length > MAX_DRAFT_ROWS || !Array.isArray(value.manuallyCalibratedRows)) {
    return null;
  }
  const timeInputs: DocumentImportTimeInput[] = [];
  for (const raw of value.timeInputs) {
    if (!isRecord(raw) || typeof raw.start !== "string" || typeof raw.end !== "string" ||
      typeof raw.startInvalid !== "boolean" || typeof raw.endInvalid !== "boolean") {
      return null;
    }
    timeInputs.push({
      start: raw.start,
      end: raw.end,
      startInvalid: raw.startInvalid,
      endInvalid: raw.endInvalid
    });
  }
  const manuallyCalibratedRows = value.manuallyCalibratedRows.filter(
    (entry): entry is number => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0
  );
  const activeCalibrationIndex = value.activeCalibrationIndex === null
    ? null
    : typeof value.activeCalibrationIndex === "number" &&
      Number.isSafeInteger(value.activeCalibrationIndex) && value.activeCalibrationIndex >= 0
      ? value.activeCalibrationIndex
      : null;
  const phase = value.phase;
  if (phase !== "input" && phase !== "preview" && phase !== "aligning" && phase !== "result") {
    return null;
  }
  const previewCurrentTime = readFiniteNonNegative(value.previewCurrentTime) ?? 0;
  const modalScrollTop = readFiniteNonNegative(value.modalScrollTop) ?? 0;
  const previewListScrollTop = readFiniteNonNegative(value.previewListScrollTop) ?? 0;
  const resultListScrollTop = readFiniteNonNegative(value.resultListScrollTop) ?? 0;
  return {
    version: 1,
    sourceText: value.sourceText,
    rows,
    result,
    timeInputs,
    manuallyCalibratedRows,
    activeCalibrationIndex,
    previewCurrentTime,
    modalScrollTop,
    previewListScrollTop,
    resultListScrollTop,
    phase: phase === "aligning" ? "preview" : phase,
    statusMessage: phase === "aligning"
      ? "上次本地自动对齐在 Obsidian 退出时中断，请重新开始。"
      : typeof value.statusMessage === "string" ? value.statusMessage : "",
    statusError: phase === "aligning" || value.statusError === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
  };
}

/** 独立保存字幕导入草稿，避免设置保存时覆盖进度。 */
export class DocumentImportDraftStore {
  private readonly path: string;
  private readonly writeQueue = new AsyncKeyedQueue();

  constructor(private readonly app: App, pluginId: string) {
    this.path = `${app.vault.configDir}/plugins/${pluginId}/document-import-drafts.json`;
  }

  async load(key: string): Promise<DocumentImportDraftLoadResult> {
    const loaded = await this.readFile();
    const rawDraft = loaded.file.drafts[key];
    const draft = validateDocumentImportDraft(rawDraft);
    return {
      draft,
      warning: loaded.warning ?? (rawDraft !== undefined && draft === null
        ? "此前的字幕导入草稿格式无效，已忽略该草稿。"
        : null)
    };
  }

  async save(key: string, draft: DocumentImportDraft): Promise<void> {
    await this.writeQueue.run(this.path, async () => {
      const { file } = await this.readFile();
      file.drafts[key] = draft;
      await this.app.vault.adapter.write(this.path, `${JSON.stringify(file, null, 2)}\n`);
    });
  }

  async remove(key: string): Promise<void> {
    await this.writeQueue.run(this.path, async () => {
      const { file } = await this.readFile();
      if (!(key in file.drafts)) {
        return;
      }
      delete file.drafts[key];
      await this.app.vault.adapter.write(this.path, `${JSON.stringify(file, null, 2)}\n`);
    });
  }

  private async readFile(): Promise<{
    file: DocumentImportDraftFile;
    warning: string | null;
  }> {
    if (!await this.app.vault.adapter.exists(this.path)) {
      return { file: { version: 1, drafts: {} }, warning: null };
    }
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(this.path));
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.drafts)) {
        return {
          file: { version: 1, drafts: {} },
          warning: "字幕导入草稿文件版本或格式无效，已安全忽略。"
        };
      }
      return {
        file: {
          version: 1,
          drafts: { ...parsed.drafts } as Record<string, DocumentImportDraft>
        },
        warning: null
      };
    } catch {
      return {
        file: { version: 1, drafts: {} },
        warning: "字幕导入草稿文件无法读取，已安全忽略。"
      };
    }
  }
}
