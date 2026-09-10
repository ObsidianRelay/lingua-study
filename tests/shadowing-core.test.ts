import assert from "node:assert/strict";
import test from "node:test";
import {
  canAdjustShadowingSource,
  calculateShadowingWaveformPeak,
  clampShadowingPosition,
  formatShadowingElapsed,
  formatShadowingRecordingElapsed,
  getShadowingActiveElapsedMs,
  getShadowingLiveWaveformLayout,
  getShadowingPlaybackProgress,
  getShadowingRecordingProgress,
  getShadowingRecordingErrorMessage,
  getShadowingSmoothedPlaybackTime,
  getShadowingWaveformBinSize,
  getShadowingWaveformTargetSampleCount,
  selectShadowingMimeType,
  SHADOWING_MAX_RECORDING_MS,
  SHADOWING_SEEK_STEP_SECONDS,
  SHADOWING_WAVEFORM_SAMPLE_INTERVAL_MS
} from "../src/shadowing-core";

test("跟读录音优先选择 Opus WebM 并安全回退", () => {
  assert.equal(selectShadowingMimeType((type) => type === "audio/webm;codecs=opus"), "audio/webm;codecs=opus");
  assert.equal(selectShadowingMimeType((type) => type === "audio/webm"), "audio/webm");
  assert.equal(selectShadowingMimeType(() => false), "");
  assert.equal(selectShadowingMimeType(null), "");
});

test("跟读录音计时固定为分秒且最长六十秒", () => {
  assert.equal(SHADOWING_MAX_RECORDING_MS, 60_000);
  assert.equal(formatShadowingElapsed(-1), "00:00");
  assert.equal(formatShadowingElapsed(9_999), "00:09");
  assert.equal(formatShadowingElapsed(60_000), "01:00");
});

test("跟读录音状态单独显示到毫秒", () => {
  assert.equal(formatShadowingRecordingElapsed(-1), "00:00.000");
  assert.equal(formatShadowingRecordingElapsed(3_007), "00:03.007");
  assert.equal(formatShadowingRecordingElapsed(9_999), "00:09.999");
  assert.equal(formatShadowingRecordingElapsed(60_000), "01:00.000");
  assert.equal(formatShadowingRecordingElapsed(Number.NaN), "00:00.000");
});

test("句内两秒跳转保持在字幕边界内", () => {
  assert.equal(SHADOWING_SEEK_STEP_SECONDS, 2);
  assert.equal(clampShadowingPosition(11, -2, 10, 20), 10);
  assert.equal(clampShadowingPosition(19, 2, 10, 20), 20);
  assert.equal(clampShadowingPosition(15, -2, 10, 20), 13);
  assert.equal(clampShadowingPosition(Number.NaN, 2, 10, 20), 12);
});

test("暂停阶段不计入实际录音时长", () => {
  assert.equal(getShadowingActiveElapsedMs(5_000, 10_000, 14_000, true), 9_000);
  assert.equal(getShadowingActiveElapsedMs(5_000, 10_000, 40_000, false), 5_000);
  assert.equal(getShadowingActiveElapsedMs(-1, 10_000, 9_000, true), 0);
});

test("首次回放时使用实际录音时长避免 WebM 进度线卡顿", () => {
  assert.equal(getShadowingPlaybackProgress(2, Number.POSITIVE_INFINITY, 8_000), 0.25);
  assert.equal(getShadowingPlaybackProgress(4, Number.NaN, 8_000), 0.5);
  assert.equal(getShadowingPlaybackProgress(4, 10, 8_000), 0.5);
  assert.equal(getShadowingPlaybackProgress(3, 6, 0), 0.5);
  assert.equal(getShadowingPlaybackProgress(6, 6, 6_100, true), 1);
});

test("录音回放指针使用单调时钟平滑前进并限制在实际录音时长内", () => {
  assert.equal(getShadowingSmoothedPlaybackTime(2, 500, 1, 10, 8_000), 2.5);
  assert.equal(getShadowingSmoothedPlaybackTime(2, 500, 1.5, 10, 8_000), 2.75);
  assert.equal(getShadowingSmoothedPlaybackTime(7.8, 500, 1, 10, 8_000), 8);
  assert.equal(getShadowingSmoothedPlaybackTime(2, 500, 1, 6, 0), 2.5);
  assert.equal(getShadowingSmoothedPlaybackTime(Number.NaN, -1, 0, Number.NaN, 0), 0);
});

test("录音期间可以控制原句，权限和处理阶段保持锁定", () => {
  assert.equal(canAdjustShadowingSource("recording"), true);
  assert.equal(canAdjustShadowingSource("paused"), true);
  assert.equal(canAdjustShadowingSource("recorded"), true);
  assert.equal(canAdjustShadowingSource("requesting"), false);
  assert.equal(canAdjustShadowingSource("processing"), false);
});

test("实时波形与录音头使用六十秒固定时间轴", () => {
  assert.equal(SHADOWING_WAVEFORM_SAMPLE_INTERVAL_MS, 50);
  const capacity = getShadowingWaveformTargetSampleCount(60_000);
  assert.equal(capacity, 1_200);
  assert.deepEqual(getShadowingLiveWaveformLayout(50, capacity), {
    startIndex: 0,
    visibleCount: 50,
    startSlot: 0,
    slotCount: 1_200,
    playheadRatio: 50 / 1_200
  });
  assert.deepEqual(getShadowingLiveWaveformLayout(1_200, capacity), {
    startIndex: 0,
    visibleCount: 1_200,
    startSlot: 0,
    slotCount: 1_200,
    playheadRatio: 1
  });
  assert.equal(getShadowingRecordingProgress(0), 0);
  assert.equal(getShadowingRecordingProgress(15_000), 0.25);
  assert.equal(getShadowingRecordingProgress(30_000), 0.5);
  assert.equal(getShadowingRecordingProgress(60_000), 1);
  assert.equal(getShadowingRecordingProgress(90_000), 1);
});

test("波形采样数跟随实际录音时间且不会因界面掉帧累积误差", () => {
  assert.equal(getShadowingWaveformTargetSampleCount(0), 0);
  assert.equal(getShadowingWaveformTargetSampleCount(49), 0);
  assert.equal(getShadowingWaveformTargetSampleCount(50), 1);
  assert.equal(getShadowingWaveformTargetSampleCount(1_255), 25);
  assert.equal(getShadowingWaveformTargetSampleCount(6_995), 139);
  assert.equal(getShadowingWaveformTargetSampleCount(60_000), 1_200);
  assert.equal(getShadowingWaveformTargetSampleCount(90_000), 1_200);
  assert.equal(getShadowingWaveformTargetSampleCount(Number.NaN), 0);
});

test("过密的实时波形采样会合并为间距清晰的柱形", () => {
  assert.equal(getShadowingWaveformBinSize(4), 1);
  assert.equal(getShadowingWaveformBinSize(1.25), 2);
  assert.equal(getShadowingWaveformBinSize(0.5), 5);
  assert.equal(getShadowingWaveformBinSize(Number.NaN), 250);
});

test("麦克风时域数据转为稳定的 0 到 1 波形峰值", () => {
  assert.equal(calculateShadowingWaveformPeak(new Uint8Array()), 0);
  assert.equal(calculateShadowingWaveformPeak(new Uint8Array([128, 128, 128])), 0);
  assert.equal(calculateShadowingWaveformPeak(new Uint8Array([128, 192, 128])), 0.5);
  assert.equal(calculateShadowingWaveformPeak(new Uint8Array([0, 255])), 1);
});

test("麦克风权限和设备错误转换为明确中文提示", () => {
  assert.match(getShadowingRecordingErrorMessage({ name: "NotAllowedError" }), /允许 Obsidian 使用麦克风/u);
  assert.match(getShadowingRecordingErrorMessage({ name: "NotFoundError" }), /没有检测到/u);
  assert.match(getShadowingRecordingErrorMessage({ name: "NotReadableError" }), /其他应用占用/u);
  assert.match(getShadowingRecordingErrorMessage(new Error("unknown")), /录音启动失败/u);
});
