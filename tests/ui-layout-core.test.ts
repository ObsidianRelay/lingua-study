import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAlignedScrollTop,
  calculateTranscriptEndSpacer,
  calculateViewportAlignedScrollDelta,
  type SubtitleRowGeometry
} from "../src/ui-layout-core";

const rows: SubtitleRowGeometry[] = [
  { top: 8, height: 128 },
  { top: 144, height: 128 },
  { top: 280, height: 128 },
  { top: 416, height: 128 },
  { top: 552, height: 128 }
];

test("自动跟随只返回完整字幕纸的顶部位置", () => {
  const target = calculateAlignedScrollTop(rows, 3, 300);
  assert.equal(target, 280);
  assert.ok(rows.some((row) => row.top === target));
  assert.equal(calculateAlignedScrollTop(rows, 0, 300), 0);
});

test("超高字幕纸从自身顶部开始，最后一张纸获得足够底部空间", () => {
  const tallRows = [
    { top: 8, height: 128 },
    { top: 144, height: 420 },
    { top: 572, height: 128 }
  ];
  assert.equal(calculateAlignedScrollTop(tallRows, 1, 300), 144);
  assert.equal(calculateTranscriptEndSpacer(128, 300), 172);
  assert.equal(calculateTranscriptEndSpacer(420, 300), 0);
});

test("上一张翻译纸过高时，当前句仍从自身顶部进入可视范围", () => {
  const rowsAfterTallTranslation = [
    { top: 8, height: 520 },
    { top: 536, height: 128 },
    { top: 672, height: 128 }
  ];
  assert.equal(calculateAlignedScrollTop(rowsAfterTallTranslation, 1, 300), 536);
});

test("外层页面只在当前句越出画面时滚动最小距离", () => {
  assert.equal(calculateViewportAlignedScrollDelta(580, 120, 100, 700), 0);
  assert.equal(calculateViewportAlignedScrollDelta(650, 120, 100, 700), 70);
  assert.equal(calculateViewportAlignedScrollDelta(80, 120, 100, 700), -20);
});

test("外层翻页会扣除悬浮视频高度，超高字幕则顶部对齐", () => {
  assert.equal(calculateViewportAlignedScrollDelta(580, 120, 360, 700), 0);
  assert.equal(calculateViewportAlignedScrollDelta(580, 400, 360, 700), 220);
  assert.equal(calculateViewportAlignedScrollDelta(580, 120, 700, 700), 0);
});
