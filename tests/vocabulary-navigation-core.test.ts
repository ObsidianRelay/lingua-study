import assert from "node:assert/strict";
import test from "node:test";
import { selectNewestEligibleRenderer } from "../src/vocabulary-navigation-core";

test("原句定位只选择目标标签页中最新的可见渲染实例", () => {
  const hiddenOldRenderer = { id: "hidden-old" };
  const visibleOldRenderer = { id: "visible-old" };
  const visibleCurrentRenderer = { id: "visible-current" };
  const selected = selectNewestEligibleRenderer([
    { renderer: hiddenOldRenderer, readyOrder: 9, eligible: false },
    { renderer: visibleOldRenderer, readyOrder: 2, eligible: true },
    { renderer: visibleCurrentRenderer, readyOrder: 7, eligible: true }
  ]);

  assert.equal(selected, visibleCurrentRenderer);
});

test("没有属于目标标签页的可见渲染实例时继续等待", () => {
  const selected = selectNewestEligibleRenderer([
    { renderer: { id: "other-leaf" }, readyOrder: 3, eligible: false },
    { renderer: { id: "detached" }, readyOrder: 4, eligible: false }
  ]);

  assert.equal(selected, null);
});
