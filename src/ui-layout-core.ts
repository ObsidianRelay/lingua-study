export interface SubtitleRowGeometry {
  top: number;
  height: number;
}

export type PlayerResizeCorner = "nw" | "ne" | "sw" | "se";

/**
 * 把四角拖动换算为播放器宽度。高度仍由 CSS 的 16:9 比例决定。
 * 播放器在文稿中始终居中，因此左侧角向左拖和右侧角向右拖都代表放大。
 */
export function calculatePlayerResizeWidth(
  centerX: number,
  pointerX: number,
  availableWidth: number,
  minWidth: number,
  maxWidth: number
): number {
  if (
    ![
      centerX,
      pointerX,
      availableWidth,
      minWidth,
      maxWidth
    ].every(Number.isFinite)
  ) {
    return 0;
  }

  // 播放器使用 margin-inline:auto 保持居中，因此角落到中心线的距离
  // 正好是宽度的一半。只使用这一条稳定轴，避免横纵位移互相抢占造成抽动。
  const requestedWidth = Math.abs(pointerX - centerX) * 2;
  const safeMaximum = Math.max(0, Math.min(availableWidth, maxWidth));
  const safeMinimum = Math.min(Math.max(0, minWidth), safeMaximum);
  return Math.round(Math.min(safeMaximum, Math.max(safeMinimum, requestedWidth)));
}

/**
 * 计算外层阅读页需要滚动的距离。
 *
 * 当前句已经完整可见时不移动画面；只在它越出可视区域时，
 * 滚动刚好足够的距离让整句重新出现。超高字幕则对齐可视区域顶部。
 */
export function calculateViewportAlignedScrollDelta(
  rowTop: number,
  rowHeight: number,
  visibleTop: number,
  visibleBottom: number
): number {
  if (
    !Number.isFinite(rowTop) ||
    !Number.isFinite(rowHeight) ||
    !Number.isFinite(visibleTop) ||
    !Number.isFinite(visibleBottom) ||
    visibleBottom <= visibleTop
  ) {
    return 0;
  }

  const safeRowHeight = Math.max(0, rowHeight);
  const visibleHeight = visibleBottom - visibleTop;
  if (safeRowHeight >= visibleHeight || rowTop < visibleTop) {
    return rowTop - visibleTop;
  }
  const rowBottom = rowTop + safeRowHeight;
  return rowBottom > visibleBottom ? rowBottom - visibleBottom : 0;
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
