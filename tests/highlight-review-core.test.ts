import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  applyGrade,
  appendReviewLog,
  buildCards,
  buildHeatmap,
  buildReviewQueue,
  buildTranslationTable,
  collapse,
  computeReviewStats,
  dayKey,
  emptyState,
  mmss,
  normalizeState,
  splitQuote,
  type HighlightLike,
  type ReviewCard,
  type ReviewLog,
  type ReviewStore,
  type TranscriptFile,
} from "../src/highlight-review-core";

/* ------------------------------------------------------------------ 夹具 */

function annotation(partial: Partial<HighlightLike>): HighlightLike {
  return {
    id: "highlight-1",
    targetType: "study",
    categoryIds: ["grammar"],
    quote: "",
    sourcePath: "1英语素材/10.17.md",
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    ...partial,
  };
}

const TRANSCRIPT: TranscriptFile = {
  videoId: "BV1xx411c7mD",
  segments: [
    { start: 0, end: 3.2, text: "I'm out of breath." },
    { start: 3.2, end: 7.9, text: "I haven't exercised for months and I'm really out of shape." },
    { start: 7.9, end: 11.4, text: "Because I remember I've been to the Rocky Mountains many times." },
  ],
};

const TRANSLATIONS = buildTranslationTable({
  translations: {
    aaa: { sourceText: "I'm out of breath.", text: "我喘不过气来了。" },
    bbb: {
      sourceText: "I haven't exercised for months and I'm really out of shape.",
      text: "我好几月没锻炼，身体真的很差。",
    },
  },
});

function buildFixtureCards(): ReviewCard[] {
  return buildCards({
    annotations: [
      annotation({
        id: "highlight-out-of-shape",
        quote: "out of shape：身体状况不佳；走样 同样由 out of 加名词构成，指健康状态差或物体变形。",
        transcriptPath: "Transcripts/BV1xx411c7mD-p1.json",
        videoId: "BV1xx411c7mD",
        segmentIndex: 1,
        segmentStart: 3.2,
        segmentEnd: 7.9,
        categoryIds: ["grammar"],
      }),
      annotation({
        id: "highlight-out-of-breath",
        quote: "out of breath",
        targetType: "transcript",
        transcriptPath: "Transcripts/BV1xx411c7mD-p1.json",
        videoId: "BV1xx411c7mD",
        segmentIndex: 0,
        segmentStart: 0,
        segmentEnd: 3.2,
        categoryIds: ["expression"],
      }),
      annotation({
        id: "highlight-scrape",
        quote: "scrape the sky：高耸入云 形象化表达，形容山或建筑极高，动词 scrape 本义为“刮，擦”。",
        transcriptPath: "Transcripts/BV1xx411c7mD-p1.json",
        videoId: "BV1xx411c7mD",
        segmentIndex: 2,
        segmentStart: 7.9,
        segmentEnd: 11.4,
        categoryIds: ["expression"],
      }),
    ],
    transcripts: { "Transcripts/BV1xx411c7mD-p1.json": TRANSCRIPT },
    translations: { "Transcripts/BV1xx411c7mD-p1.json": TRANSLATIONS },
  }).cards;
}

/* ------------------------------------------------------------------ 文本解析 */

test("splitQuote: 冒号切出词条、释义与讲解", () => {
  const parts = splitQuote("out of shape：身体状况不佳；走样 同样由 out of 加名词构成。");
  assert.equal(parts.front, "out of shape");
  assert.equal(parts.gloss, "身体状况不佳；走样");
  assert.equal(parts.explain, "同样由 out of 加名词构成。");
  assert.equal(parts.frontSource, "colon");
  assert.equal(parts.hasColon, true);
});

test("splitQuote: 释义过长时整段归入讲解", () => {
  const long = "top 11 most competitive：" + "最激烈的十一个".repeat(8);
  const parts = splitQuote(long);
  assert.equal(parts.front, "top 11 most competitive");
  assert.equal(parts.gloss, "");
  assert.ok(parts.explain.length > 40);
});

test("splitQuote: 英文开头、无冒号时按中英边界切分", () => {
  const parts = splitQuote("instead of 代替 表示「代替某人做某事」，后面接名词或动名词。");
  assert.equal(parts.front, "instead of");
  assert.equal(parts.frontSource, "boundary");
  assert.ok(parts.explain.startsWith("代替"));
});

test("splitQuote: 纯中文提示里抽引号内的英文结构", () => {
  const parts = splitQuote("六级写作可以套用 “the + 最高级 + of which” 这种结构来补充说明前面的事物。");
  assert.equal(parts.front, "the + 最高级 + of which");
  assert.equal(parts.frontSource, "quoted");
});

test("splitQuote: 没有引号时退化为第一段英文", () => {
  const parts = splitQuote("六级口语与写作中可用 vibe 替换 atmosphere，但正式议论文慎用。");
  assert.equal(parts.front, "vibe");
  assert.equal(parts.frontSource, "run");
});

test("splitQuote: 时间戳里的冒号不会被当作分隔符", () => {
  const parts = splitQuote("see 01:32 for details：这个例子里有冒号。");
  assert.equal(parts.front, "see 01:32 for details");
  assert.equal(parts.frontSource, "colon");
});

test("collapse / mmss 基本行为", () => {
  assert.equal(collapse("  a \n  b\u3000c  "), "a b c");
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65), "1:05");
  assert.equal(mmss(3661), "1:01:01");
});

/* ------------------------------------------------------------------ 卡片构建 */

test("buildCards: 分类、类型、上下文与译文都对得上", () => {
  const cards = buildFixtureCards();
  assert.equal(cards.length, 3);

  const shape = cards.find((c) => c.id === "highlight-out-of-shape");
  assert.ok(shape);
  assert.equal(shape.kind, "point");
  assert.equal(shape.category, "grammar");
  assert.equal(shape.front, "out of shape");
  assert.equal(shape.context.text, "I haven't exercised for months and I'm really out of shape.");
  assert.equal(shape.context.translation, "我好几月没锻炼，身体真的很差。");
  assert.equal(shape.videoId, "BV1xx411c7mD");
  assert.equal(shape.context.start, 3.2);

  const sentence = cards.find((c) => c.id === "highlight-out-of-breath");
  assert.ok(sentence);
  assert.equal(sentence.kind, "sentence");
  assert.equal(sentence.front, "out of breath");
  assert.equal(sentence.context.translation, "我喘不过气来了。");
});

test("buildCards: 同一段字幕上的多张卡互为相关高亮", () => {
  const cards = buildCards({
    annotations: [
      annotation({ id: "a", quote: "out of shape", segmentIndex: 1, transcriptPath: "t.json" }),
      annotation({ id: "b", quote: "out of breath", segmentIndex: 1, transcriptPath: "t.json" }),
      annotation({ id: "c", quote: "scrape the sky", segmentIndex: 2, transcriptPath: "t.json" }),
    ],
    transcripts: { "t.json": TRANSCRIPT },
  }).cards;
  const a = cards.find((c) => c.id === "a");
  assert.ok(a);
  assert.deepEqual(a.relatedIds, ["b"]);
});

test("buildCards: 空 quote 与重复 id 会被跳过，空输入给出 warning", () => {
  const result = buildCards({
    annotations: [
      annotation({ id: "x", quote: "   " }),
      annotation({ id: "y", quote: "out of shape" }),
      annotation({ id: "y", quote: "out of shape（重复）" }),
    ],
  });
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(buildCards({ annotations: [] }).warnings, ["没有高亮数据"]);
});

test("buildCards: 排序按分类顺序再按创建时间", () => {
  const cards = buildCards({
    annotations: [
      annotation({ id: "late", quote: "zzz", categoryIds: ["difficulty"], createdAt: "2026-10-20T00:00:00.000Z" }),
      annotation({ id: "early", quote: "aaa", categoryIds: ["expression"], createdAt: "2026-10-10T00:00:00.000Z" }),
      annotation({ id: "later", quote: "bbb", categoryIds: ["expression"], createdAt: "2026-10-19T00:00:00.000Z" }),
    ],
  }).cards;
  assert.deepEqual(
    cards.map((c) => c.id),
    ["early", "later", "late"]
  );
});

test("buildCards: 保留同一条高亮的全部类别与个人笔记", () => {
  const [card] = buildCards({
    annotations: [annotation({
      id: "multi",
      quote: "out of shape",
      categoryIds: ["expression", "grammar"],
      note: "表示身体状态不佳",
    })],
  }).cards;
  assert.ok(card);
  assert.deepEqual(card.categoryIds, ["expression", "grammar"]);
  assert.equal(card.note, "表示身体状态不佳");
  assert.deepEqual(
    buildReviewQueue([card], {}, { category: "grammar" }).queue.map((item) => item.id),
    ["multi"]
  );
});

/* ------------------------------------------------------------------ 调度 */

test("applyGrade: 忘记回到第 0 档且当天再来一次", () => {
  const state = applyGrade({ level: 4, reps: 3, due: "2026-10-01" }, "forgot", "2026-10-25");
  assert.equal(state.level, 0);
  assert.equal(state.due, "2026-10-25");
  assert.equal(state.reps, 4);
  assert.equal(state.lapses, 1);
});

test("applyGrade: 模糊保持档位、间隔折半", () => {
  const state = applyGrade({ level: 4, reps: 2 }, "fuzzy", "2026-10-25");
  assert.equal(state.level, 4);
  assert.equal(state.due, "2026-10-29"); // 第 4 档 7 天 → 折半 4 天（四舍五入）
});

test("applyGrade: 记住升档并按间隔表拉长", () => {
  const state = applyGrade({ level: 0, reps: 0 }, "know", "2026-10-25");
  assert.equal(state.level, 1);
  assert.equal(state.due, "2026-10-26");

  const top = applyGrade({ level: 8, reps: 9 }, "know", "2026-10-25");
  assert.equal(top.level, 8);
  assert.equal(top.due, "2027-02-22"); // 第 8 档 120 天
});

test("applyGrade: 未知评分直接报错", () => {
  assert.throws(() => applyGrade(emptyState(), "meh" as never, "2026-10-25"), /unknown grade/);
});

test("normalizeState: 越界字段被夹回合法范围", () => {
  const state = normalizeState({ level: 99, reps: -3, lapses: -1, starred: "yes" as never });
  assert.equal(state.level, 8);
  assert.equal(state.reps, 0);
  assert.equal(state.lapses, 0);
  assert.equal(state.starred, true);
});

test("buildReviewQueue: 到期卡在前、新卡受每日上限约束", () => {
  const cards = buildFixtureCards();
  const store: ReviewStore = {
    "highlight-out-of-shape": { ...emptyState(), reps: 1, level: 1, due: "2026-10-20", last: "2026-10-19" },
    "highlight-scrape": { ...emptyState(), reps: 1, level: 1, due: "2026-10-24", last: "2026-10-20" },
  };
  const result = buildReviewQueue(cards, store, {
    today: "2026-10-25",
    newPerDay: 1,
    introducedToday: [],
  });
  // 两张到期卡按 due 升序，新卡只放 1 张
  assert.deepEqual(
    result.queue.map((c) => c.id),
    ["highlight-out-of-shape", "highlight-scrape", "highlight-out-of-breath"]
  );
  assert.equal(result.counts.due, 2);
  assert.equal(result.counts.fresh, 1);
  assert.equal(result.counts.newAllowed, 1);
});

test("buildReviewQueue: 今天已引入的新卡不重复占用名额", () => {
  const cards = buildFixtureCards();
  const result = buildReviewQueue(cards, {}, { today: "2026-10-25", newPerDay: 2, introducedToday: ["a", "b"] });
  assert.equal(result.queue.length, 0);
  assert.equal(result.counts.newAllowed, 0);
});

test("buildReviewQueue: 关闭「只看到期」时把其余卡片接在到期卡后面", () => {
  const cards = buildFixtureCards();
  const store: ReviewStore = {
    "highlight-out-of-shape": { ...emptyState(), reps: 2, level: 3, due: "2026-11-20", last: "2026-10-01" },
    "highlight-out-of-breath": { ...emptyState(), reps: 1, level: 2, due: "2026-11-21", last: "2026-10-20" },
  };
  // newPerDay=0：到期模式不引入新卡，自由复习仍可浏览全部卡片
  const strict = buildReviewQueue(cards, store, { today: "2026-10-25", newPerDay: 0, onlyDue: true });
  assert.deepEqual(strict.queue, []);
  assert.equal(strict.counts.later, 2);

  const relaxed = buildReviewQueue(cards, store, { today: "2026-10-25", newPerDay: 0, onlyDue: false });
  assert.deepEqual(
    relaxed.queue.map((c) => c.id),
    ["highlight-scrape", "highlight-out-of-shape", "highlight-out-of-breath"]
  );
});

test("buildReviewQueue: 自由复习包含超过每日限额的新卡", () => {
  const cards = buildFixtureCards();
  const result = buildReviewQueue(cards, {}, {
    today: "2026-10-25",
    newPerDay: 0,
    onlyDue: false,
  });
  assert.equal(result.queue.length, cards.length);
});

test("buildReviewQueue: 分类 / 来源 / 收藏 / 搜索筛选", () => {
  const cards = buildFixtureCards();
  const store: ReviewStore = {
    "highlight-scrape": { ...emptyState(), reps: 1, level: 2, starred: true, due: "2026-10-20", last: "2026-10-19" },
  };
  // 只看到期 = 到期卡 + 今天允许引入的新卡
  assert.deepEqual(
    buildReviewQueue(cards, store, { today: "2026-10-25", category: "expression", onlyDue: true }).queue.map((c) => c.id),
    ["highlight-scrape", "highlight-out-of-breath"]
  );
  assert.deepEqual(
    buildReviewQueue(cards, store, { today: "2026-10-25", starredOnly: true, onlyDue: true }).queue.map((c) => c.id),
    ["highlight-scrape"]
  );
  assert.deepEqual(
    buildReviewQueue(cards, store, { today: "2026-10-25", search: "scrape", onlyDue: true }).queue.map((c) => c.id),
    ["highlight-scrape"]
  );
  assert.deepEqual(
    buildReviewQueue(cards, store, { today: "2026-10-25", sourcePath: "nope.md", onlyDue: true }).queue,
    []
  );
});

/* ------------------------------------------------------------------ 统计 */

test("appendReviewLog 累计当天各档次数与新卡 id", () => {
  const log: ReviewLog = {};
  appendReviewLog(log, "2026-10-25", "know", "a");
  appendReviewLog(log, "2026-10-25", "forgot", "b");
  appendReviewLog(log, "2026-10-25", "know", "a");
  assert.equal(log["2026-10-25"].total, 3);
  assert.equal(log["2026-10-25"].know, 2);
  assert.equal(log["2026-10-25"].forgot, 1);
  assert.deepEqual(log["2026-10-25"].newIds, ["a", "b"]);
});

test("computeReviewStats: 连续天数从今天或昨天往回数", () => {
  const cards = buildFixtureCards();
  const store: ReviewStore = {
    "highlight-out-of-shape": { ...emptyState(), reps: 2, level: 3, starred: true, sentence: "I'm out of shape.", due: "2026-10-25" },
  };
  const log: ReviewLog = {
    "2026-10-23": { total: 2, forgot: 0, fuzzy: 1, know: 1, newIds: ["a"] },
    "2026-10-24": { total: 4, forgot: 1, fuzzy: 0, know: 3, newIds: ["b"] },
    "2026-10-25": { total: 1, forgot: 0, fuzzy: 0, know: 1, newIds: [] },
  };
  const stats = computeReviewStats(store, log, cards, { today: "2026-10-25" });
  assert.equal(stats.streak, 3);
  assert.equal(stats.todayTotal, 1);
  assert.equal(stats.todayAccuracy, 100);
  assert.equal(stats.totalReviews, 7);
  assert.equal(stats.learned, 1);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.starred, 1);
  assert.equal(stats.sentences, 1);
  assert.equal(stats.dueToday, 1);
  assert.equal(stats.total, 3);
});

test("buildHeatmap: 26 周 × 7 天，未来日期被标记", () => {
  const log: ReviewLog = { "2026-10-25": { total: 3, forgot: 0, fuzzy: 0, know: 3, newIds: [] } };
  // 2026-10-25 是周日，本周就是最后一周，没有“未来”格子
  const sunday = buildHeatmap(log, { today: "2026-10-25", weeks: 26 });
  assert.equal(sunday.cells.length, 26 * 7);
  assert.equal(sunday.weeks, 26);
  assert.equal(sunday.max, 3);
  assert.equal(sunday.end, "2026-10-25");
  assert.equal(sunday.cells.filter((c) => c.future).length, 0);
  assert.equal(sunday.cells.find((c) => c.date === "2026-10-25").count, 3);

  // 周四看，本周还剩周五/周六/周日三格
  const thursday = buildHeatmap(log, { today: "2026-10-22", weeks: 26 });
  assert.equal(thursday.end, "2026-10-25");
  assert.equal(thursday.cells.filter((c) => c.future).length, 3);
});

test("dayKey 用本地时区，不受 UTC 偏移影响", () => {
  assert.equal(dayKey(new Date(2026, 9, 25, 23, 30)), "2026-10-25");
  assert.equal(dayKey(new Date(2026, 9, 26, 0, 15)), "2026-10-26");
});
