import assert from "node:assert/strict";
import test from "node:test";
import {
  alignImportedRows,
  alignmentRowsToSegments,
  findAlignmentTimingIssues,
  formatAlignmentTime,
  normalizeAlignmentWords,
  parseImportedBilingualText,
  parseAlignmentTime,
  recognitionSegmentsToTokens,
  roundAlignmentTime,
  validateAlignmentBoundary
} from "../src/document-transcript-core";

test("对齐时间统一显示到百分之一秒", () => {
  assert.equal(formatAlignmentTime(241.78), "04:01.78");
  assert.equal(formatAlignmentTime(586.61), "09:46.61");
  assert.equal(formatAlignmentTime(3_661.239), "01:01:01.24");
  assert.equal(formatAlignmentTime(null), "--:--.--");
  assert.equal(roundAlignmentTime(4.236), 4.24);
});

test("人工时间输入接受分秒和时分秒并拒绝无效格式", () => {
  assert.equal(parseAlignmentTime("04:15.62"), 255.62);
  assert.equal(parseAlignmentTime("4:15"), 255);
  assert.equal(parseAlignmentTime("01:04:15.6"), 3_855.6);
  assert.equal(parseAlignmentTime("04:60"), null);
  assert.equal(parseAlignmentTime("255.62"), null);
  assert.equal(parseAlignmentTime("--:--.--"), null);
});

test("时间问题检查覆盖缺失、越界和重叠", () => {
  const base = [
    { english: "One", chinese: "一", start: 0, end: 2, confidence: 1 },
    { english: "Two", chinese: "二", start: 1.9, end: 3, confidence: 1 },
    { english: "Three", chinese: "三", start: null, end: null, confidence: 0 }
  ];
  assert.deepEqual(findAlignmentTimingIssues(base, 10).map((issue) => issue.kind), [
    "overlap",
    "missing"
  ]);
  assert.equal(findAlignmentTimingIssues([
    { english: "Late", chinese: "晚", start: 9, end: 11, confidence: 1 }
  ], 10)[0]?.kind, "out-of-range");
});

test("人工记录边界会阻止倒序、越界和相邻句重叠", () => {
  const rows = [
    { english: "One", chinese: "一", start: 0, end: 2, confidence: 1 },
    { english: "Two", chinese: "二", start: 2.5, end: 4, confidence: 1 },
    { english: "Three", chinese: "三", start: 5, end: 7, confidence: 1 }
  ];
  assert.match(validateAlignmentBoundary(rows, 1, "start", 1.5, 10) ?? "", /上一句/u);
  assert.match(validateAlignmentBoundary(rows, 1, "start", 5, 10) ?? "", /下一句/u);
  assert.match(validateAlignmentBoundary(rows, 1, "end", 2.4, 10) ?? "", /晚于开始/u);
  assert.match(validateAlignmentBoundary(rows, 1, "end", 5.5, 10) ?? "", /下一句/u);
  assert.match(validateAlignmentBoundary(rows, 1, "end", 11, 10) ?? "", /必须位于/u);
  assert.equal(validateAlignmentBoundary(rows, 1, "start", 2.2, 10), null);
  assert.equal(validateAlignmentBoundary(rows, 1, "end", 4.5, 10), null);
});

test("解析中英表格并保留说话人标签", () => {
  assert.deepEqual(parseImportedBilingualText(
    "Nathan: Hello and welcome back!\t内森：大家好，欢迎回来！\n" +
    "This is the podcast.\t这是播客节目。"
  ), [
    { english: "Nathan: Hello and welcome back!", chinese: "内森：大家好，欢迎回来！" },
    { english: "This is the podcast.", chinese: "这是播客节目。" }
  ]);
  assert.deepEqual(normalizeAlignmentWords("Nathan: Hello, long-term student's world!"), [
    "hello", "long-term", "student's", "world"
  ]);
});

test("普通中英文段落按照完整句配对", () => {
  const rows = parseImportedBilingualText(
    "Hello there. This is a test!\n你好。 这是测试！"
  );
  assert.deepEqual(rows, [
    { english: "Hello there.", chinese: "你好。" },
    { english: "This is a test!", chinese: "这是测试！" }
  ]);
});

test("自动对齐保持单调顺序并拒绝伪造未匹配时间", () => {
  const tokens = recognitionSegmentsToTokens([
    { start: 1, end: 3, text: "hello there" },
    { start: 3, end: 6, text: "this is a test" }
  ]);
  const result = alignImportedRows([
    { english: "Hello there.", chinese: "你好。" },
    { english: "This is a test.", chinese: "这是测试。" },
    { english: "Words not present anywhere.", chinese: "不存在。" }
  ], tokens);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.rows[0]?.start, 1);
  assert.equal(result.rows[1]?.start, 3);
  assert.equal(result.rows[2]?.start, null);
  assert.throws(() => alignmentRowsToSegments(result.rows), /未对齐/);
});

test("有效校正结果可以转回 version 1 字幕片段", () => {
  assert.deepEqual(alignmentRowsToSegments([
    { english: "First sentence.", chinese: "第一句。", start: 0.5, end: 2, confidence: 0.9 },
    { english: "Second sentence.", chinese: "第二句。", start: 2, end: 4, confidence: 0.8 }
  ]), [
    { text: "First sentence.", start: 0.5, end: 2 },
    { text: "Second sentence.", start: 2, end: 4 }
  ]);
});

test("文稿与语音之间存在较长片头时仍能向后找到原句", () => {
  const filler = Array.from({ length: 120 }, (_value, index) => ({
    text: `filler${index}`,
    start: index * 0.2,
    end: index * 0.2 + 0.15
  }));
  const result = alignImportedRows(
    [{ english: "The actual lesson starts here.", chinese: "课程从这里开始。" }],
    [
      ...filler,
      { text: "the", start: 30, end: 30.2 },
      { text: "actual", start: 30.2, end: 30.4 },
      { text: "lesson", start: 30.4, end: 30.6 },
      { text: "starts", start: 30.6, end: 30.8 },
      { text: "here", start: 30.8, end: 31 }
    ]
  );
  assert.equal(result.matchedCount, 1);
  assert.equal(result.rows[0]?.start, 30);
  assert.equal(result.rows[0]?.end, 31);
});
