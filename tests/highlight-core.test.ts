import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HIGHLIGHT_CATEGORIES,
  addHighlightAnnotation,
  buildHighlightMarkerBackground,
  buildHighlightRenderSlices,
  createEmptyHighlightBook,
  createHighlightAnnotation,
  createStudyHighlightAnnotation,
  getStudyHighlightFields,
  getHighlightSelectionActions,
  migrateHighlightCategory,
  parseHighlightBook,
  projectStudyGroupHighlight,
  rangesOverlap,
  removeHighlightAnnotation,
  resolveHighlightAnchor,
  resolveStudyHighlightAnchor,
  sanitizeHighlightCategories,
  updateHighlightAnnotation,
  validateHighlightBook,
  type HighlightAnnotation
} from "../src/highlight-core";
import { AsyncKeyedQueue } from "../src/async-keyed-queue";

function annotation(
  text = "Some surprise stems from the belief.",
  start = 14,
  end = 24,
  overrides: Partial<Pick<HighlightAnnotation, "id" | "categoryIds" | "note">> = {}
) {
  return createHighlightAnnotation({
    id: overrides.id ?? "highlight-1",
    categoryIds: overrides.categoryIds ?? ["expression"],
    note: overrides.note,
    sourcePath: "Video.md",
    transcriptPath: "Lingua Study/Transcripts/video.json",
    videoId: "abcdefghijk",
    segmentIndex: 2,
    segmentStart: 12,
    segmentEnd: 16,
    segmentText: text,
    startOffset: start,
    endOffset: end,
    now: new Date("2026-09-15T00:00:00.000Z")
  });
}

test("旧设置会得到三种独立可修改的默认高亮类别", () => {
  const first = sanitizeHighlightCategories(undefined);
  const second = sanitizeHighlightCategories(undefined);
  assert.deepEqual(first, DEFAULT_HIGHLIGHT_CATEGORIES);
  first[0]!.name = "已修改";
  assert.equal(second[0]!.name, "重点表达");
});

test("高亮类别过滤空名称、错误颜色、重复名称和重复 ID", () => {
  assert.deepEqual(sanitizeHighlightCategories([
    { id: "mine", name: "地道表达", color: "#abcdef" },
    { id: "mine", name: "另一类", color: "#112233" },
    { id: "two", name: "地道表达", color: "#445566" },
    { id: "bad", name: "无效", color: "red" }
  ]), [{ id: "mine", name: "地道表达", color: "#ABCDEF" }]);
  const tooMany = Array.from({ length: 9 }, (_value, index) => ({
    id: `category-${index}`,
    name: `类别 ${index}`,
    color: "#123456"
  }));
  assert.equal(sanitizeHighlightCategories(tooMany).length, 8);
});

test("v1 和 v2 标注在内存中无损升级为 v3", () => {
  const item = annotation(undefined, undefined, undefined, { note: "保留笔记" });
  const { categoryIds: _categoryIds, ...legacyFields } = item;
  const parsed = parseHighlightBook({
    version: 1,
    annotations: {
      [item.id]: { ...legacyFields, categoryId: "expression" }
    }
  });
  assert.equal(parsed.migratedFromVersion, 1);
  assert.equal(parsed.book.version, 3);
  assert.deepEqual(parsed.book.annotations[item.id]!.categoryIds, ["expression"]);
  assert.equal(parsed.book.annotations[item.id]!.note, "保留笔记");
  assert.equal(parsed.book.annotations[item.id]!.targetType, "transcript");
  const { targetType: _targetType, ...v2Item } = item;
  const migratedV2 = parseHighlightBook({ version: 2, annotations: { [item.id]: v2Item } });
  assert.equal(migratedV2.migratedFromVersion, 2);
  assert.equal(migratedV2.book.annotations[item.id]!.note, "保留笔记");
  assert.equal(migratedV2.book.annotations[item.id]!.targetType, "transcript");
  assert.equal(parseHighlightBook(parsed.book).migratedFromVersion, null);
});

test("损坏、未知版本、空类别和重复类别都会被拒绝", () => {
  const item = annotation();
  assert.throws(() => validateHighlightBook({ version: 4, annotations: {} }), /版本/u);
  assert.throws(() => validateHighlightBook({
    version: 2,
    annotations: { [item.id]: { ...item, categoryIds: [] } }
  }), /有效类别/u);
  assert.throws(() => validateHighlightBook({
    version: 2,
    annotations: { [item.id]: { ...item, categoryIds: ["expression", "expression"] } }
  }), /重复类别/u);
  assert.throws(() => validateHighlightBook({ version: 2, annotations: { x: item } }), /无效字段/u);
});

test("相邻、部分重叠和嵌套范围都允许保存", () => {
  assert.equal(rangesOverlap(0, 5, 5, 8), false);
  assert.equal(rangesOverlap(0, 5, 4, 8), true);
  const text = "Some surprise stems from the belief.";
  const first = annotation(text, 14, 24);
  let book = addHighlightAnnotation(createEmptyHighlightBook(), first);
  const adjacent = annotation(text, 24, 28, { id: "highlight-2", categoryIds: ["grammar"] });
  const overlapping = annotation(text, 20, 30, { id: "highlight-3", categoryIds: ["difficulty"] });
  const nested = annotation(text, 21, 24, { id: "highlight-4", categoryIds: ["expression"] });
  book = addHighlightAnnotation(book, adjacent);
  book = addHighlightAnnotation(book, overlapping);
  book = addHighlightAnnotation(book, nested);
  assert.deepEqual(Object.keys(book.annotations).sort(), [
    "highlight-1", "highlight-2", "highlight-3", "highlight-4"
  ]);
});

test("完全相同的范围合并类别并复用原记录，不创建重复项", () => {
  const first = annotation(undefined, undefined, undefined, {
    categoryIds: ["expression"],
    note: "原笔记"
  });
  const sameRange = annotation(undefined, undefined, undefined, {
    id: "highlight-new",
    categoryIds: ["grammar", "expression"],
    note: "更新笔记"
  });
  const merged = addHighlightAnnotation(
    addHighlightAnnotation(createEmptyHighlightBook(), first),
    sameRange
  );
  assert.deepEqual(Object.keys(merged.annotations), [first.id]);
  assert.deepEqual(merged.annotations[first.id]!.categoryIds, ["expression", "grammar"]);
  assert.equal(merged.annotations[first.id]!.note, "更新笔记");
});

test("渲染重叠区间时按设置顺序选择最高优先级颜色", () => {
  const text = "abcdefghij";
  const grammar = annotation(text, 0, 6, { id: "grammar-note", categoryIds: ["grammar"] });
  const expression = annotation(text, 3, 9, { id: "expression-note", categoryIds: ["expression"] });
  assert.deepEqual(
    buildHighlightRenderSlices([grammar, expression], text, ["expression", "grammar", "difficulty"]),
    [
      { startOffset: 0, endOffset: 3, categoryId: "grammar", annotationIds: ["grammar-note"] },
      {
        startOffset: 3,
        endOffset: 6,
        categoryId: "expression",
        annotationIds: ["expression-note", "grammar-note"]
      },
      { startOffset: 6, endOffset: 9, categoryId: "expression", annotationIds: ["expression-note"] }
    ]
  );
  assert.equal(
    buildHighlightRenderSlices([grammar, expression], text, ["grammar", "expression"])[1]!.categoryId,
    "grammar"
  );
});

test("单条多类别高亮也按设置顺序显示背景色", () => {
  const text = "abcdefghij";
  const item = annotation(text, 1, 8, { categoryIds: ["grammar", "expression"] });
  assert.equal(buildHighlightRenderSlices([item], text, ["expression", "grammar"])[0]!.categoryId, "expression");
  assert.equal(buildHighlightRenderSlices([item], text, ["grammar", "expression"])[0]!.categoryId, "grammar");
});

test("多个类别生成可叠加的荧光笔图层且总浓度不会随数量变深", () => {
  const single = buildHighlightMarkerBackground(["#56A3FF"]);
  const blended = buildHighlightMarkerBackground(["#56A3FF", "#EB6F92"]);
  assert.match(single, /#56A3FF 34%/u);
  assert.equal((blended.match(/linear-gradient/gu) ?? []).length, 2);
  assert.ok(blended.indexOf("#56A3FF") < blended.indexOf("#EB6F92"));
  assert.match(blended, /#56A3FF 18\.76%/u);
  assert.match(blended, /#EB6F92 18\.76%/u);
});

test("旧字幕中已经无法定位的高亮不会参与新字幕渲染", () => {
  const stale = annotation("old wording", 0, 3);
  assert.deepEqual(buildHighlightRenderSlices([stale], "new wording", ["expression"]), []);
});

test("高亮保存原文、偏移、前后文和非空类别", () => {
  const item = annotation(undefined, undefined, undefined, { categoryIds: ["expression", "grammar"] });
  assert.equal(item.quote, "stems from");
  assert.equal(item.note, "");
  assert.deepEqual(item.categoryIds, ["expression", "grammar"]);
  assert.deepEqual(validateHighlightBook({ version: 3, annotations: { [item.id]: item } }).annotations[item.id], item);
  assert.throws(() => createHighlightAnnotation({
    id: "too-long",
    categoryIds: ["expression"],
    sourcePath: "Video.md",
    transcriptPath: "Lingua Study/Transcripts/video.json",
    videoId: "abcdefghijk",
    segmentIndex: 2,
    segmentStart: 12,
    segmentEnd: 16,
    segmentText: "word",
    startOffset: 0,
    endOffset: 4,
    note: "x".repeat(2_001),
    now: new Date("2026-09-15T00:00:00.000Z")
  }), /无效字段/u);
});

test("单词、标点和 Unicode 文本使用与 DOM Range 一致的偏移", () => {
  const text = "Hello, café 🌍 — 你好!";
  const startOffset = text.indexOf("café");
  const endOffset = text.indexOf("!") + 1;
  const item = annotation(text, startOffset, endOffset);
  assert.equal(item.quote, "café 🌍 — 你好!");
  assert.equal(text.slice(item.startOffset, item.endOffset), item.quote);
  assert.deepEqual(resolveHighlightAnchor(item, `Prefix ${text}`), {
    status: "resolved",
    startOffset: startOffset + 7,
    endOffset: endOffset + 7
  });
});

test("高亮和划词翻译开关相互独立", () => {
  assert.deepEqual(getHighlightSelectionActions("one word", true, true, false), {
    highlight: true, translate: false, showPopover: true
  });
  assert.deepEqual(getHighlightSelectionActions("one word", true, false, true), {
    highlight: false, translate: true, showPopover: true
  });
  assert.deepEqual(getHighlightSelectionActions("one word", true, false, false), {
    highlight: false, translate: false, showPopover: false
  });
  assert.deepEqual(getHighlightSelectionActions("word", false, true, false), {
    highlight: false, translate: false, showPopover: false
  });
});

test("知识点标注保留字段、类别、Unicode 偏移及个人笔记", () => {
  const text = "分享他们的东西，也许会有点烦躁。";
  const item = createStudyHighlightAnnotation({
    id: "study-1",
    categoryIds: ["expression", "grammar"],
    note: "注意 share 的用法",
    sourcePath: "Video.md",
    transcriptPath: "Lingua Study/Transcripts/video.json",
    videoId: "abcdefghijk",
    segmentIndex: 2,
    segmentStart: 12,
    segmentEnd: 16,
    segmentText: text,
    startOffset: 0,
    endOffset: 7,
    studyTarget: { profile: "cet4", field: "keyPoints.0.meaning" },
    now: new Date("2026-09-15T00:00:00.000Z")
  });
  assert.equal(item.quote, "分享他们的东西");
  assert.equal(item.targetType, "study");
  assert.deepEqual(item.studyTarget, { profile: "cet4", field: "keyPoints.0.meaning" });
  assert.deepEqual(parseHighlightBook({
    version: 3, annotations: { [item.id]: item }
  }).book.annotations[item.id], item);
  assert.throws(() => validateHighlightBook({
    version: 3,
    annotations: { [item.id]: { ...item, studyTarget: { profile: "cet4", field: "other" } } }
  }), /无效字段/u);
});

test("知识点重新生成后仅在可唯一判断时恢复标记", () => {
  const item = createStudyHighlightAnnotation({
    id: "study-2",
    categoryIds: ["grammar"],
    sourcePath: "Video.md",
    transcriptPath: "Lingua Study/Transcripts/video.json",
    videoId: "abcdefghijk",
    segmentIndex: 2,
    segmentStart: 12,
    segmentEnd: 16,
    segmentText: "prefix target suffix",
    startOffset: 7,
    endOffset: 13,
    studyTarget: { profile: "cet4", field: "grammar.0.explanation" },
    now: new Date("2026-09-15T00:00:00.000Z")
  });
  assert.deepEqual(resolveStudyHighlightAnchor(item, {
    "grammar.0.explanation": "new prefix target suffix"
  }), { status: "resolved", field: "grammar.0.explanation", startOffset: 11, endOffset: 17 });
  assert.deepEqual(resolveStudyHighlightAnchor(item, {
    "grammar.0.explanation": "replaced",
    "grammar.1.explanation": "prefix target suffix"
  }), { status: "resolved", field: "grammar.1.explanation", startOffset: 7, endOffset: 13 });
  assert.deepEqual(resolveStudyHighlightAnchor(item, {
    "grammar.0.explanation": "replaced",
    "grammar.1.explanation": "prefix target suffix",
    "grammar.2.explanation": "prefix target suffix"
  }), { status: "unresolved" });
});

test("知识点和字幕即使文字范围相同也分别保存，相同知识点范围只合并类别", () => {
  const transcript = annotation("share", 0, 5);
  const studyInput = {
    id: "study-range-1",
    categoryIds: ["grammar"],
    sourcePath: "Video.md",
    transcriptPath: transcript.transcriptPath,
    videoId: transcript.videoId,
    segmentIndex: transcript.segmentIndex,
    segmentStart: transcript.segmentStart,
    segmentEnd: transcript.segmentEnd,
    segmentText: "share",
    startOffset: 0,
    endOffset: 5,
    studyTarget: { profile: "cet4", field: "keyPoints.0.expression" },
    now: new Date("2026-09-15T00:00:00.000Z")
  } as const;
  const first = createStudyHighlightAnnotation({ ...studyInput, categoryIds: [...studyInput.categoryIds] });
  const second = createStudyHighlightAnnotation({
    ...studyInput, id: "study-range-2", categoryIds: ["difficulty"]
  });
  let book = addHighlightAnnotation(createEmptyHighlightBook(), transcript);
  book = addHighlightAnnotation(book, first);
  book = addHighlightAnnotation(book, second);
  assert.equal(Object.keys(book.annotations).length, 2);
  assert.deepEqual(book.annotations[first.id]!.categoryIds, ["grammar", "difficulty"]);
  assert.equal(book.annotations[transcript.id]!.targetType, "transcript");
});

test("知识点字段提取覆盖译文、词汇、语法、提示和拓展", () => {
  const fields = getStudyHighlightFields({
    translation: "旧译文",
    keyPoints: [{ expression: "share", meaning: "分享", note: "可接宾语" }],
    grammar: [{ pattern: "when ...", explanation: "时间状语从句" }],
    examTip: "留意语境",
    extensions: [{
      anchor: "share", expression: "share with", meaning: "与人分享",
      note: "搭配", example: "Share it with me.", exampleTranslation: "与我分享。"
    }]
  }, "新译文");
  assert.equal(fields.translation, "新译文");
  assert.equal(fields["keyPoints.0.note"], "可接宾语");
  assert.equal(fields["keyPoints.0.group"], "share：分享 可接宾语");
  assert.equal(fields["grammar.0.explanation"], "时间状语从句");
  assert.equal(fields["grammar.0.group"], "when ... 时间状语从句");
  assert.equal(fields.examTip, "留意语境");
  assert.equal(fields["extensions.0.exampleTranslation"], "与我分享。");
  assert.equal(fields["extensions.0.group"],
    "由原句中的“share”延伸 share with：与人分享 搭配 Share it with me. 与我分享。");
});

test("同一语法点可从标题划到讲解，保存为一条标注并映射到两行", () => {
  const pattern = "Maybe + 主语 + have/has even + 过去分词";
  const explanation = "用于推测对方可能有过某种经历，when 引导时间状语从句。";
  const text = `${pattern} ${explanation}`;
  const startOffset = pattern.indexOf("have/has");
  const endOffset = pattern.length + 1 + explanation.indexOf("，when");
  const item = createStudyHighlightAnnotation({
    id: "grammar-group",
    categoryIds: ["grammar"],
    sourcePath: "Video.md",
    transcriptPath: "Lingua Study/Transcripts/video.json",
    videoId: "abcdefghijk",
    segmentIndex: 2,
    segmentStart: 12,
    segmentEnd: 16,
    segmentText: text,
    startOffset,
    endOffset,
    studyTarget: { profile: "cet4", field: "grammar.0.group" },
    now: new Date("2026-09-15T00:00:00.000Z")
  });
  assert.equal(item.quote, `${pattern.slice(startOffset)} ${explanation.slice(0, explanation.indexOf("，when"))}`);
  const title = projectStudyGroupHighlight(item, pattern, 0);
  const note = projectStudyGroupHighlight(item, explanation, pattern.length + 1);
  assert.equal(title?.quote, pattern.slice(startOffset));
  assert.equal(note?.quote, explanation.slice(0, explanation.indexOf("，when")));
  assert.equal(title?.id, note?.id);
  assert.deepEqual(resolveStudyHighlightAnchor(item, {
    "grammar.0.group": text
  }), { status: "resolved", field: "grammar.0.group", startOffset, endOffset });
});

test("字幕未变、唯一匹配和前后文唯一匹配都可恢复位置", () => {
  const item = annotation("alpha target omega", 6, 12);
  assert.deepEqual(resolveHighlightAnchor(item, "alpha target omega"), {
    status: "resolved", startOffset: 6, endOffset: 12
  });
  assert.deepEqual(resolveHighlightAnchor(item, "prefix alpha target omega"), {
    status: "resolved", startOffset: 13, endOffset: 19
  });

  const repeated = annotation("left target middle target right", 5, 11);
  assert.deepEqual(resolveHighlightAnchor(repeated, "new left target middle target right"), {
    status: "resolved", startOffset: 9, endOffset: 15
  });
});

test("重复文本无法唯一判断或原文消失时保留为未定位", () => {
  const item = annotation("target and target", 0, 6);
  const withoutUsefulContext = { ...item, prefix: "", suffix: "" };
  assert.deepEqual(resolveHighlightAnchor(withoutUsefulContext, "target and target"), {
    status: "resolved", startOffset: 0, endOffset: 6
  });
  assert.deepEqual(resolveHighlightAnchor(withoutUsefulContext, "x target and target"), {
    status: "unresolved"
  });
  assert.deepEqual(resolveHighlightAnchor(item, "nothing remains"), { status: "unresolved" });
});

test("编辑多类别和迁移类别会去重，并保留锚点与创建时间", () => {
  const item = annotation();
  const book = addHighlightAnnotation(createEmptyHighlightBook(), item);
  const edited = updateHighlightAnnotation(
    book,
    item.id,
    { categoryIds: ["grammar", "difficulty"], note: "  写作表达  " },
    new Date("2026-09-15T01:00:00.000Z")
  );
  assert.equal(edited.annotations[item.id]!.note, "写作表达");
  assert.equal(edited.annotations[item.id]!.createdAt, item.createdAt);
  const migrated = migrateHighlightCategory(
    edited,
    "grammar",
    "difficulty",
    new Date("2026-09-15T02:00:00.000Z")
  );
  assert.deepEqual(migrated.annotations[item.id]!.categoryIds, ["difficulty"]);
  assert.equal(migrated.annotations[item.id]!.createdAt, item.createdAt);
  assert.deepEqual(removeHighlightAnnotation(migrated, item.id).annotations, {});
  const empty = createEmptyHighlightBook();
  assert.equal(migrateHighlightCategory(empty, "grammar", "difficulty", new Date()), empty);
});

test("快速连续保存两条高亮时串行合并，不会后写覆盖前写", async () => {
  const queue = new AsyncKeyedQueue();
  let book = createEmptyHighlightBook();
  const first = annotation("first second third", 0, 5);
  const second = annotation("first second third", 6, 12, { id: "highlight-2" });
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const saveFirst = queue.run("highlights.json", async () => {
    await firstGate;
    book = addHighlightAnnotation(book, first);
  });
  const saveSecond = queue.run("highlights.json", async () => {
    book = addHighlightAnnotation(book, second);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseFirst();
  await Promise.all([saveFirst, saveSecond]);
  assert.deepEqual(Object.keys(book.annotations).sort(), ["highlight-1", "highlight-2"]);
});
