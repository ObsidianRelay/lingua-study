export interface SubtitleRowGeometry {
  top: number;
  height: number;
}

/**
 * 计算自动跟随的滚动位置。
 *
 * 当前句尽量位于视口中部，但返回值永远来自某一行字幕纸的顶部，
 * 避免上一张纸只显示一半。超高字幕纸则直接从当前纸张顶部开始显示。
 */
export function calculateAlignedScrollTop(
  rows: readonly SubtitleRowGeometry[],
  activeIndex: number,
  viewportHeight: number
): number {
  const active = rows[activeIndex];
  if (!active || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 0;
  }
  if (active.height >= viewportHeight) {
    return activeIndex === 0 ? 0 : Math.max(0, active.top);
  }

  const idealTop = active.top + active.height / 2 - viewportHeight / 2;
  const activeBottom = active.top + active.height;
  let alignedTop: number | null = null;
  for (const row of rows) {
    if (row.top > idealTop) {
      break;
    }
    // 候选纸张的顶部不仅要接近居中位置，还必须能让当前纸完整可见。
    // 这可以避开“上一张翻译纸很高，把当前句挤到视口外”的情况。
    if (row.top <= active.top && row.top + viewportHeight >= activeBottom) {
      alignedTop = row.top;
    }
  }
  return activeIndex === 0 ? 0 : Math.max(0, alignedTop ?? active.top);
}

/** 让最后一张字幕纸也可以滚动到视口顶部。 */
export function calculateTranscriptEndSpacer(
  lastRowHeight: number,
  viewportHeight: number
): number {
  if (!Number.isFinite(lastRowHeight) || !Number.isFinite(viewportHeight)) {
    return 0;
  }
  return Math.max(0, viewportHeight - Math.max(0, lastRowHeight));
}
