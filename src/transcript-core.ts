export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** 首次手工编辑前的原始字幕，用于随时恢复。 */
  originalText?: string;
}

export interface TranscriptFile {
  version: 1;
  videoId: string;
  sourceUrl: string;
  language: string;
  segments: TranscriptSegment[];
}

/**
 * 校验播放器使用的本地字幕文件。导入功能和播放器共用同一份校验，
 * 避免“导入成功但播放器打不开”的两套标准。
 */
export function validateTranscript(value: unknown): TranscriptFile {
  if (!value || typeof value !== "object") {
    throw new Error("字幕文件的最外层必须是 JSON 对象。");
  }

  const data = value as Record<string, unknown>;
  if (data.version !== 1) {
    throw new Error("暂不支持该字幕版本，version 必须是 1。");
  }
  if (
    typeof data.videoId !== "string" ||
    !/^(?:[A-Za-z0-9_-]{11}|BV[0-9A-Za-z]{10})$/u.test(data.videoId)
  ) {
    throw new Error("videoId 格式不正确，应为 11 位 YouTube ID 或有效的 B站 BV 号。");
  }
  if (typeof data.sourceUrl !== "string" || !data.sourceUrl.startsWith("https://")) {
    throw new Error("sourceUrl 缺失或不是 HTTPS 链接。");
  }
  if (typeof data.language !== "string" || data.language.trim() === "") {
    throw new Error("language 不能为空。");
  }
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    throw new Error("segments 必须包含至少一条字幕。");
  }

  const segments: TranscriptSegment[] = [];
  let previousEnd = -1;

  data.segments.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`第 ${index + 1} 条字幕不是有效对象。`);
    }

    const segment = entry as Record<string, unknown>;
    const start = segment.start;
    const end = segment.end;
    const text = segment.text;
    const originalText = segment.originalText;

    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      throw new Error(`第 ${index + 1} 条字幕的 start 必须是大于或等于 0 的数字。`);
    }
    if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
      throw new Error(`第 ${index + 1} 条字幕的 end 必须大于 start。`);
    }
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`第 ${index + 1} 条字幕的 text 不能为空。`);
    }
    if (start < previousEnd) {
      throw new Error(`第 ${index + 1} 条字幕与前一条重叠或顺序不正确。`);
    }

    const normalizedText = text.trim();
    if (
      originalText !== undefined &&
      (typeof originalText !== "string" || originalText.trim() === "")
    ) {
      throw new Error(`第 ${index + 1} 条字幕的 originalText 必须是非空文本。`);
    }
    const normalizedOriginal = typeof originalText === "string" ? originalText.trim() : "";
    segments.push({
      start,
      end,
      text: normalizedText,
      ...(normalizedOriginal !== "" && normalizedOriginal !== normalizedText
        ? { originalText: normalizedOriginal }
        : {})
    });
    previousEnd = end;
  });

  return {
    version: 1,
    videoId: data.videoId,
    sourceUrl: data.sourceUrl,
    language: data.language.trim(),
    segments
  };
}

/** 修改正文时首次保存原文；恢复到原文时自动移除 originalText。 */
export function updateTranscriptSegmentText(
  transcript: TranscriptFile,
  index: number,
  nextText: string
): TranscriptFile {
  if (!Number.isSafeInteger(index) || index < 0 || index >= transcript.segments.length) {
    throw new Error("要修改的字幕编号不存在。");
  }
  const normalized = nextText.trim();
  if (normalized === "") {
    throw new Error("字幕正文不能为空。");
  }
  const segments = transcript.segments.map((segment, segmentIndex) => {
    if (segmentIndex !== index || segment.text === normalized) {
      return { ...segment };
    }
    const originalText = segment.originalText ?? segment.text;
    return normalized === originalText
      ? { start: segment.start, end: segment.end, text: normalized }
      : { ...segment, text: normalized, originalText };
  });
  return validateTranscript({ ...transcript, segments });
}
