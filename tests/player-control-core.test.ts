import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlaybackStateConfirmed,
  shouldAdvancePlaybackClock,
  shouldResumeTranscriptAutoFollow,
  waitForMediaMetadata,
  type MediaMetadataSource
} from "../src/player-control-core";

class FakeMediaSource extends EventTarget implements MediaMetadataSource {
  readyState = 0;
}

const timers = {
  schedule: (callback: () => void, timeoutMs: number): unknown =>
    setTimeout(callback, timeoutMs),
  cancel: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout)
};

test("YouTube 播放和暂停只接受对应的播放器确认状态", () => {
  assert.equal(isPlaybackStateConfirmed(1, 1, 1, 2), true);
  assert.equal(isPlaybackStateConfirmed(1, 3, 1, 2), false);
  assert.equal(isPlaybackStateConfirmed(2, 2, 1, 2), true);
  assert.equal(isPlaybackStateConfirmed(2, 0, 1, 2), true);
  assert.equal(isPlaybackStateConfirmed(null, 1, 1, 2), false);
});

test("YouTube 命令未确认时本地计时器不继续推进", () => {
  assert.equal(shouldAdvancePlaybackClock(1, null, 1), true);
  assert.equal(shouldAdvancePlaybackClock(1, 1, 1), false);
  assert.equal(shouldAdvancePlaybackClock(1, 2, 1), false);
  assert.equal(shouldAdvancePlaybackClock(2, null, 1), false);
});

test("暂停或等待暂停确认时不会恢复字幕自动跟随", () => {
  assert.equal(shouldResumeTranscriptAutoFollow(1, null, 1, null), true);
  assert.equal(shouldResumeTranscriptAutoFollow(2, null, 1, null), false);
  assert.equal(shouldResumeTranscriptAutoFollow(1, 2, 1, null), false);
  assert.equal(shouldResumeTranscriptAutoFollow(1, null, 1, false), true);
  assert.equal(shouldResumeTranscriptAutoFollow(1, null, 1, true), false);
});

test("本地分段元数据成功、失败和超时都能结束等待", async () => {
  const loaded = new FakeMediaSource();
  const loadedPromise = waitForMediaMetadata(loaded, 100, timers);
  loaded.readyState = 1;
  loaded.dispatchEvent(new Event("loadedmetadata"));
  await loadedPromise;

  const failed = new FakeMediaSource();
  const failedPromise = waitForMediaMetadata(failed, 100, timers);
  failed.dispatchEvent(new Event("error"));
  await assert.rejects(failedPromise, /无法读取/);

  const aborted = new FakeMediaSource();
  const abortedPromise = waitForMediaMetadata(aborted, 100, timers);
  aborted.dispatchEvent(new Event("abort"));
  await assert.rejects(abortedPromise, /中止/);

  const timedOut = new FakeMediaSource();
  await assert.rejects(waitForMediaMetadata(timedOut, 5, timers), /超时/);
});
