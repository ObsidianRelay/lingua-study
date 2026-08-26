export interface MediaMetadataSource {
  readonly readyState: number;
  addEventListener(
    type: "loadedmetadata" | "error" | "abort",
    listener: () => void,
    options?: AddEventListenerOptions
  ): void;
  removeEventListener(
    type: "loadedmetadata" | "error" | "abort",
    listener: () => void
  ): void;
}

export interface MediaTimerHost {
  schedule(callback: () => void, timeoutMs: number): unknown;
  cancel(handle: unknown): void;
}

/** YouTube 暂停命令也允许以“视频结束”状态作为确认。 */
export function isPlaybackStateConfirmed(
  pendingState: number | null,
  receivedState: number,
  playingState: number,
  pausedState: number
): boolean {
  return pendingState !== null && (
    (pendingState === playingState && receivedState === playingState) ||
    (pendingState === pausedState && (receivedState === pausedState || receivedState === 0))
  );
}

/** 等待 YouTube 确认播放/暂停命令时，本地时钟必须保持冻结。 */
export function shouldAdvancePlaybackClock(
  playerState: number,
  pendingState: number | null,
  playingState: number
): boolean {
  return pendingState === null && playerState === playingState;
}

/**
 * 自动跟随只允许在视频确实播放时恢复。
 * 本地播放器直接读取 paused；YouTube 则要求当前状态为播放且没有待确认命令。
 */
export function shouldResumeTranscriptAutoFollow(
  playerState: number,
  pendingState: number | null,
  playingState: number,
  localMediaPaused: boolean | null
): boolean {
  return localMediaPaused === null
    ? shouldAdvancePlaybackClock(playerState, pendingState, playingState)
    : !localMediaPaused;
}

/** 等待本地视频元数据，并保证成功、失败和超时都会清理监听器。 */
export function waitForMediaMetadata(
  source: MediaMetadataSource,
  timeoutMs: number,
  timers: MediaTimerHost
): Promise<void> {
  if (source.readyState >= 1) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timer: unknown = null;
    const cleanup = (): void => {
      source.removeEventListener("loadedmetadata", onLoaded);
      source.removeEventListener("error", onError);
      source.removeEventListener("abort", onAbort);
      if (timer !== null) {
        timers.cancel(timer);
        timer = null;
      }
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
    const onError = (): void => finish(new Error("本地缓存分段无法读取，请检查缓存文件。"));
    const onAbort = (): void => finish(new Error("本地缓存分段加载已中止，请重新跳转。"));
    source.addEventListener("loadedmetadata", onLoaded, { once: true });
    source.addEventListener("error", onError, { once: true });
    source.addEventListener("abort", onAbort, { once: true });
    timer = timers.schedule(() => {
      finish(new Error("本地缓存分段加载超时，请检查缓存文件。"));
    }, timeoutMs);
  });
}
