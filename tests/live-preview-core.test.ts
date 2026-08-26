import assert from "node:assert/strict";
import test from "node:test";
import {
  addStudyBlockExitLine,
  containsStudyBlock,
  getStudyBlockCursorRecovery
} from "../src/live-preview-core";

test("识别已经闭合的 Lingua Study 代码块", () => {
  const lines = [
    "# 未命名",
    "",
    "```lingua-study",
    "platform: bilibili",
    "bvid: BV1Gf4y1y7wc",
    "```"
  ];

  assert.equal(containsStudyBlock(lines), true);
});

test("兼容旧代码块名称", () => {
  const lines = [
    "```english-video-study",
    "transcript: Lingua Study/Transcripts/example.json",
    "```",
    "后续说明"
  ];

  assert.equal(containsStudyBlock(lines), true);
});

test("普通代码块和未闭合代码块不触发恢复", () => {
  assert.equal(containsStudyBlock(["```json", "{}", "```"]), false);
  assert.equal(containsStudyBlock(["```lingua-study", "transcript: a.json"]), false);
});

test("代码块位于文件末尾时创建代码块外的安全光标行", () => {
  const lines = [
    "```lingua-study",
    "transcript: Lingua Study/Transcripts/example.json",
    "```"
  ];

  assert.deepEqual(getStudyBlockCursorRecovery(lines, 1), {
    closingLine: 2,
    exitLine: 3,
    needsTrailingLine: true
  });
  assert.equal(addStudyBlockExitLine(lines.join("\n")), `${lines.join("\n")}\n`);
});

test("光标在代码块外时不移动，已有后续行时不追加换行", () => {
  const lines = [
    "```english-video-study",
    "transcript: example.json",
    "```",
    "后续说明"
  ];

  assert.equal(getStudyBlockCursorRecovery(lines, 3), null);
  assert.deepEqual(getStudyBlockCursorRecovery(lines, 0), {
    closingLine: 2,
    exitLine: 3,
    needsTrailingLine: false
  });
  assert.equal(addStudyBlockExitLine("```lingua-study\n```\n"), "```lingua-study\n```\n");
});
