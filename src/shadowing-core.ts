export const SHADOWING_MAX_RECORDING_MS = 60_000;
export const SHADOWING_SEEK_STEP_SECONDS = 2;

export type ShadowingPhase =
  | "listening"
  | "ready"
  | "requesting"
  | "recording"
  | "paused"
  | "processing"
  | "recorded";

export const SHADOWING_WAVEFORM_VISIBLE_SAMPLES = 200;
export const SHADOWING_WAVEFORM_SAMPLE_INTERVAL_MS = 50;

const PREFERRED_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm"
] as const;

/** 选择当前 Chromium 运行时支持的录音格式；空字符串表示交给浏览器决定。 */
export function selectShadowingMimeType(
  isTypeSupported: ((mimeType: string) => boolean) | null
): string {
  if (!isTypeSupported) {
    return "";
  }
  return PREFERRED_RECORDING_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType)) ?? "";
}

export function formatShadowingElapsed(elapsedMs: number): string {
  const safeElapsedMs = Math.max(
    0,
    Math.floor(Number.isFinite(elapsedMs) ? elapsedMs : 0)
  );
  const safeSeconds = Math.floor(safeElapsedMs / 1_000);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** 录音计时显示到毫秒；句内播放器仍使用简洁的分秒格式。 */
export function formatShadowingRecordingElapsed(elapsedMs: number): string {
  const safeElapsedMs = Math.max(
    0,
    Math.floor(Number.isFinite(elapsedMs) ? elapsedMs : 0)
  );
  const minutes = Math.floor(safeElapsedMs / 60_000);
  const seconds = Math.floor((safeElapsedMs % 60_000) / 1_000);
  const milliseconds = safeElapsedMs % 1_000;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

/** 将句内快进/后退限制在当前字幕的时间范围内。 */
export function clampShadowingPosition(
  currentSeconds: number,
  deltaSeconds: number,
  startSeconds: number,
  endSeconds: number
): number {
  const safeStart = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
  const safeEnd = Math.max(safeStart, Number.isFinite(endSeconds) ? endSeconds : safeStart);
  const safeCurrent = Number.isFinite(currentSeconds) ? currentSeconds : safeStart;
  const safeDelta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  return Math.min(safeEnd, Math.max(safeStart, safeCurrent + safeDelta));
}

/** 计算实际录音时长；暂停阶段不累加时间。 */
export function getShadowingActiveElapsedMs(
  accumulatedMs: number,
  activeStartedAtMs: number,
  nowMs: number,
  isRecording: boolean
): number {
  const safeAccumulated = Math.max(0, Number.isFinite(accumulatedMs) ? accumulatedMs : 0);
  if (!isRecording) {
    return safeAccumulated;
  }
  const activeSlice = Math.max(0, nowMs - activeStartedAtMs);
  return safeAccumulated + activeSlice;
}

/**
 * 计算录音回放进度。
 * MediaRecorder 生成的 WebM 在 Chromium 首次播放时可能暂时返回 Infinity 时长，
 * 因此优先使用录音阶段已经累计的实际时长，避免进度线先停住再跳动。
 */
export function getShadowingPlaybackProgress(
  currentSeconds: number,
  nativeDurationSeconds: number,
  recordedDurationMs: number,
  ended = false
): number {
  if (ended) {
    return 1;
  }
  const safeCurrent = Math.max(0, Number.isFinite(currentSeconds) ? currentSeconds : 0);
  const recordedDurationSeconds = Number.isFinite(recordedDurationMs)
    ? Math.max(0, recordedDurationMs / 1_000)
    : 0;
  const nativeDuration = Number.isFinite(nativeDurationSeconds)
    ? Math.max(0, nativeDurationSeconds)
    : 0;
  const duration = recordedDurationSeconds > 0 ? recordedDurationSeconds : nativeDuration;
  if (duration <= 0) {
    return 0;
  }
  return Math.min(1, safeCurrent / duration);
}

/**
 * 用单调时钟平滑录音回放位置。
 * 部分 Chromium / WebKit 环境的 audio.currentTime 会低频、分段更新，
 * 直接拿它逐帧绘制会让指针跳动。
 */
export function getShadowingSmoothedPlaybackTime(
  anchorSeconds: number,
  elapsedMs: number,
  playbackRate: number,
  nativeDurationSeconds: number,
  recordedDurationMs: number
): number {
  const safeAnchor = Math.max(0, Number.isFinite(anchorSeconds) ? anchorSeconds : 0);
  const safeElapsedMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0
    ? playbackRate
    : 1;
  const recordedDurationSeconds = Number.isFinite(recordedDurationMs)
    ? Math.max(0, recordedDurationMs / 1_000)
    : 0;
  const nativeDuration = Number.isFinite(nativeDurationSeconds)
    ? Math.max(0, nativeDurationSeconds)
    : 0;
  const duration = recordedDurationSeconds > 0 ? recordedDurationSeconds : nativeDuration;
  const estimated = safeAnchor + safeElapsedMs / 1_000 * safePlaybackRate;
  return duration > 0 ? Math.min(duration, estimated) : estimated;
}

/** 录音和暂停阶段允许调整原句；申请权限和生成录音时暂时锁定。 */
export function canAdjustShadowingSource(phase: ShadowingPhase): boolean {
  return phase !== "requesting" && phase !== "processing";
}

/**
 * 实时录音按照确定的 60 秒录音上限分配固定采样槽。
 * 波形和录音头共用同一个真实录音时钟，不再依赖原句时长。
 */
export function getShadowingLiveWaveformLayout(
  sampleCount: number,
  visibleSampleCount = SHADOWING_WAVEFORM_VISIBLE_SAMPLES
): {
  startIndex: number;
  visibleCount: number;
  startSlot: number;
  slotCount: number;
  playheadRatio: number;
} {
  const safeSampleCount = Math.max(0, Math.floor(Number.isFinite(sampleCount) ? sampleCount : 0));
  const safeVisibleCount = Math.max(
    1,
    Math.floor(Number.isFinite(visibleSampleCount) ? visibleSampleCount : 1)
  );
  const visibleCount = Math.min(safeSampleCount, safeVisibleCount);
  return {
    startIndex: Math.max(0, safeSampleCount - safeVisibleCount),
    visibleCount,
    startSlot: 0,
    slotCount: safeVisibleCount,
    playheadRatio: Math.min(1, safeSampleCount / safeVisibleCount)
  };
}

/**
 * 根据已经发生的实际录音时间计算此刻应当存在的波形采样数。
 * requestAnimationFrame 可能掉帧，因此不能直接用“成功绘制的帧数”充当录音时间。
 */
export function getShadowingWaveformTargetSampleCount(
  elapsedMs: number,
  sampleIntervalMs = SHADOWING_WAVEFORM_SAMPLE_INTERVAL_MS
): number {
  const safeElapsedMs = Math.min(
    SHADOWING_MAX_RECORDING_MS,
    Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  );
  const safeSampleIntervalMs = Math.max(
    1,
    Number.isFinite(sampleIntervalMs) ? sampleIntervalMs : 1
  );
  return Math.floor(safeElapsedMs / safeSampleIntervalMs);
}

/** 实时录音头按照 60 秒录音上限匀速前进。 */
export function getShadowingRecordingProgress(
  elapsedMs: number,
  maxRecordingMs = SHADOWING_MAX_RECORDING_MS
): number {
  const safeElapsedMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const safeMaxRecordingMs = Math.max(
    1,
    Number.isFinite(maxRecordingMs) ? maxRecordingMs : SHADOWING_MAX_RECORDING_MS
  );
  return Math.min(1, safeElapsedMs / safeMaxRecordingMs);
}

/** 根据画布缩放比例合并过密采样，保证实时波形柱不会挤成一整块。 */
export function getShadowingWaveformBinSize(
  slotWidth: number,
  minimumBarSpacing = 2.5
): number {
  const safeSlotWidth = Math.max(0.01, Number.isFinite(slotWidth) ? slotWidth : 0.01);
  const safeMinimumSpacing = Math.max(
    0.5,
    Number.isFinite(minimumBarSpacing) ? minimumBarSpacing : 2.5
  );
  return Math.max(1, Math.ceil(safeMinimumSpacing / safeSlotWidth));
}


/** 把 Web Audio 的无符号时域数据转为 0–1 的麦克风音量峰值。 */
export function calculateShadowingWaveformPeak(samples: Uint8Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample - 128) / 128);
  }
  return Math.min(1, Math.max(0, peak));
}

export function getShadowingRecordingErrorMessage(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "无法使用麦克风，请在 macOS 系统设置中允许 Obsidian 使用麦克风后重试。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到可用的麦克风，请连接麦克风后重试。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风正被其他应用占用，请关闭占用麦克风的应用后重试。";
  }
  return "录音启动失败，请检查麦克风权限和设备后重试。";
}
