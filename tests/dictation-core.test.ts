import assert from "node:assert/strict";
import test from "node:test";
import { compareDictation, tokenizeDictationText } from "../src/dictation-core";

test("完全一致的听写得到 100 分", () => {
  const result = compareDictation("I really like this game.", "I really like this game.");
  assert.equal(result.score, 100);
  assert.equal(result.distance, 0);
  assert.ok(result.operations.every((operation) => operation.kind === "match"));
});

test("学习友好模式忽略大小写、标点、弯引号和多余空格", () => {
  assert.deepEqual(tokenizeDictationText("  DON’T   stop—now!  "), ["dont", "stop", "now"]);
  assert.equal(compareDictation("Don't stop now.", "dont STOP, now").score, 100);
});

test("错写、漏写和多写都会生成明确对齐结果", () => {
  const substituted = compareDictation("I like this game", "I love this game");
  assert.equal(substituted.score, 75);
  assert.deepEqual(substituted.operations[1], {
    kind: "substitution",
    expected: "like",
    actual: "love"
  });

  const deleted = compareDictation("I really like this game", "I like this game");
  assert.equal(deleted.score, 80);
  assert.ok(deleted.operations.some((operation) =>
    operation.kind === "deletion" && operation.expected === "really"
  ));

  const inserted = compareDictation("I like this game", "I really like this game");
  assert.equal(inserted.score, 80);
  assert.ok(inserted.operations.some((operation) =>
    operation.kind === "insertion" && operation.actual === "really"
  ));
});

test("日常学习模式会给轻微拼写错误部分分并保留原文显示", () => {
  const result = compareDictation(
    "I've heard of acrobatic training, but never aerobatic training.",
    "I heard of acrobatc training, but never aerobatc training."
  );

  assert.equal(result.score, 84);
  assert.equal(result.distance, 3);
  assert.deepEqual(result.operations[0], {
    kind: "substitution",
    expected: "I've",
    actual: "I"
  });
  assert.ok(result.operations.some((operation) =>
    operation.kind === "substitution" &&
    operation.expected === "acrobatic" &&
    operation.actual === "acrobatc"
  ));
});

test("词序错误、空答案和数字差异会正确扣分", () => {
  assert.ok(compareDictation("I really like it", "Really I like it").score < 100);
  assert.equal(compareDictation("I like it", "").score, 0);
  assert.ok(compareDictation("I bought 2 books", "I bought 3 books").score < 100);
});

test("长句评分结果稳定且不会低于零分", () => {
  const reference = "This is a deliberately longer sentence for checking stable word alignment in dictation practice";
  const answer = "This is a longer sentence checking stable alignment during dictation practice today";
  const first = compareDictation(reference, answer);
  const second = compareDictation(reference, answer);
  assert.deepEqual(first, second);
  assert.ok(first.score >= 0 && first.score <= 100);
});

test("长句只有一个无关答案词时不会把错词漂移到句尾", () => {
  const result = compareDictation(
    "Yeah. So, aerobatics is flying the airplane in unusual ways. So things like loops and and uh spins and rolls and really learning how to control the airplane at all areas of the envelope, you know, really beyond the normal",
    "hello"
  );

  assert.equal(result.score, 0);
  assert.equal(result.distance, 40);
  assert.deepEqual(result.operations[0], {
    kind: "substitution",
    expected: "Yeah",
    actual: "hello"
  });
  assert.deepEqual(result.operations.at(-1), {
    kind: "deletion",
    expected: "normal",
    actual: null
  });
});

test("同分对齐仍会优先保留更接近的拼写位置", () => {
  const result = compareDictation("a cat", "bat");

  assert.equal(result.distance, 2);
  assert.equal(result.score, 17);
  assert.deepEqual(result.operations, [
    { kind: "deletion", expected: "a", actual: null },
    { kind: "substitution", expected: "cat", actual: "bat" }
  ]);

  const answerHasExtraPrefix = compareDictation("cat", "a bat");
  assert.equal(answerHasExtraPrefix.score, 17);
  assert.deepEqual(answerHasExtraPrefix.operations, [
    { kind: "insertion", expected: null, actual: "a" },
    { kind: "substitution", expected: "cat", actual: "bat" }
  ]);

  assert.deepEqual(compareDictation("one cat three", "one bat").operations, [
    { kind: "match", expected: "one", actual: "one" },
    { kind: "substitution", expected: "cat", actual: "bat" },
    { kind: "deletion", expected: "three", actual: null }
  ]);
});

test("只有一个参考词和多个无关答案词时也会稳定靠左对齐", () => {
  const result = compareDictation("cat", "hello world");

  assert.deepEqual(result.operations, [
    { kind: "substitution", expected: "cat", actual: "hello" },
    { kind: "insertion", expected: null, actual: "world" }
  ]);
});

test("句尾存在精确答案时仍优先保留精确匹配", () => {
  const result = compareDictation(
    "Yeah so aerobatics is flying the airplane beyond the normal",
    "normal"
  );

  assert.deepEqual(result.operations.at(-1), {
    kind: "match",
    expected: "normal",
    actual: "normal"
  });
});
