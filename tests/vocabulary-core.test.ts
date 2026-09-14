import assert from "node:assert/strict";
import test from "node:test";
import type { DictionaryEntry } from "../src/dictionary-core";
import {
  addVocabularyEntry,
  buildDailyReviewQueue,
  createEmptyVocabularyBook,
  getDailyReviewSummary,
  introduceVocabularyEntry,
  previewVocabularyRating,
  rateVocabularyEntry,
  removeVocabularyEntry,
  updateVocabularyEntry,
  updateVocabularyNote,
  validateVocabularyBook,
  type VocabularyAddInput,
  type VocabularyBookFile
} from "../src/vocabulary-core";

const dictionaryEntry: DictionaryEntry = {
  word: "study",
  phonetic: "ˈstʌdi",
  englishDefinition: "learn about a subject",
  chineseTranslation: "学习；研究",
  partOfSpeech: "v. / n.",
  examTags: ["cet4", "cet6"],
  bncRank: 500,
  frequencyRank: 300,
  inflections: [{ label: "第三人称单数", value: "studies" }]
};

function addInput(now: Date, start = 6): VocabularyAddInput {
  return {
    rawWord: "Studies",
    dictionaryEntry,
    customMeaning: "",
    studyProfile: "cet4",
    context: {
      sentence: "She studies every day.",
      sourcePath: "视频学习/测试.md",
      transcriptPath: "Lingua Study/Transcripts/test.json",
      videoId: "test-video",
      segmentIndex: 0,
      start,
      end: start + 2
    },
    now
  };
}

function oneEntryBook(now: Date): VocabularyBookFile {
  return addVocabularyEntry(createEmptyVocabularyBook(), addInput(now)).book;
}

test("同一词形归并为词典原形并合并不同语境", () => {
  const now = new Date("2026-08-18T01:00:00.000Z");
  const first = addVocabularyEntry(createEmptyVocabularyBook(), addInput(now));
  assert.equal(first.created, true);
  assert.equal(first.entry.id, "study");
  assert.equal(first.entry.userEdited, false);
  assert.equal(first.entry.contexts.length, 1);

  const duplicate = addVocabularyEntry(first.book, {
    ...addInput(new Date("2026-08-18T02:00:00.000Z")),
    rawWord: "study's",
    studyProfile: "cet6"
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.entry.contexts.length, 1);
  assert.deepEqual(duplicate.entry.studyProfiles, ["cet4", "cet6"]);

  const anotherContext = addVocabularyEntry(duplicate.book, addInput(
    new Date("2026-08-18T03:00:00.000Z"),
    20
  ));
  assert.equal(anotherContext.entry.contexts.length, 2);
  assert.deepEqual(validateVocabularyBook(JSON.parse(JSON.stringify(anotherContext.book))), anotherContext.book);

  const newProfiles = addVocabularyEntry(anotherContext.book, {
    ...addInput(new Date("2026-08-18T04:00:00.000Z")),
    studyProfile: "toefl"
  });
  assert.deepEqual(newProfiles.entry.studyProfiles, ["cet4", "cet6", "toefl"]);
  assert.deepEqual(validateVocabularyBook(newProfiles.book), newProfiles.book);
});

test("未收录词可以保存自定义释义和无视频语境", () => {
  const result = addVocabularyEntry(createEmptyVocabularyBook(), {
    rawWord: "Codexian",
    dictionaryEntry: null,
    customMeaning: "自定义学习术语",
    personalNote: "只在本课程中使用",
    studyProfile: "ielts",
    context: null,
    now: new Date("2026-08-18T01:00:00.000Z")
  });
  assert.equal(result.entry.id, "codexian");
  assert.equal(result.entry.chineseTranslation, "自定义学习术语");
  assert.equal(result.entry.personalNote, "只在本课程中使用");
  assert.deepEqual(result.entry.contexts, []);
});

test("FSRS-6 为四档评分生成真实间隔并保存记忆状态", () => {
  const now = new Date(2026, 7, 18, 9, 0, 0);
  let book = introduceVocabularyEntry(oneEntryBook(now), "study", now);
  const entry = book.entries.study!;
  assert.equal(previewVocabularyRating(entry, "again", now).intervalLabel, "1 分钟");
  assert.equal(previewVocabularyRating(entry, "hard", now).intervalLabel, "6 分钟");
  assert.equal(previewVocabularyRating(entry, "good", now).intervalLabel, "10 分钟");
  assert.equal(previewVocabularyRating(entry, "easy", now).intervalLabel, "8 天");

  book = rateVocabularyEntry(book, "study", "easy", now);
  const reviewed = book.entries.study!.review;
  assert.equal(reviewed.phase, "review");
  assert.equal(reviewed.intervalDays, 8);
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.lapses, 0);
  assert.equal(reviewed.fsrsCard?.state, 2);
  assert.equal(reviewed.fsrsCard?.scheduled_days, reviewed.intervalDays);
  assert.ok((reviewed.fsrsCard?.stability ?? 0) > 0);
  assert.equal(reviewed.reviewLogs?.length, 1);
  assert.equal(reviewed.reviewLogs?.[0]?.rating, 4);
  assert.deepEqual(validateVocabularyBook(JSON.parse(JSON.stringify(book))), book);
});

test("目标留存率越高，FSRS-6 首次熟练的复习间隔越短", () => {
  const now = new Date("2026-08-18T09:00:00.000Z");
  const entry = introduceVocabularyEntry(oneEntryBook(now), "study", now).entries.study!;
  assert.equal(previewVocabularyRating(entry, "easy", now, 0.7).intervalLabel, "77 天");
  assert.equal(previewVocabularyRating(entry, "easy", now, 0.99).intervalLabel, "1 天");
});

test("旧版固定间隔生词保留原到期时间并在下次评分接入 FSRS-6", () => {
  const now = new Date("2026-08-20T09:00:00.000Z");
  const legacy = JSON.parse(JSON.stringify(oneEntryBook(now))) as VocabularyBookFile;
  const review = legacy.entries.study!.review;
  delete review.fsrsCard;
  delete review.reviewLogs;
  review.phase = "review";
  review.introducedAt = "2026-08-10T09:00:00.000Z";
  review.dueAt = now.toISOString();
  review.intervalDays = 10;
  review.reviewCount = 3;
  review.lastReviewedAt = "2026-08-10T09:00:00.000Z";

  const loaded = validateVocabularyBook(legacy);
  assert.equal(loaded.entries.study?.review.dueAt, now.toISOString());
  assert.equal(loaded.entries.study?.review.fsrsCard, undefined);
  const migrated = rateVocabularyEntry(loaded, "study", "good", now);
  assert.equal(migrated.entries.study?.review.reviewCount, 4);
  assert.ok(migrated.entries.study?.review.fsrsCard);
  assert.equal(migrated.entries.study?.review.reviewLogs?.length, 1);
  assert.ok(Date.parse(migrated.entries.study!.review.dueAt) > now.getTime());
});

test("每日队列优先到期词并限制新词数量", () => {
  const now = new Date(2026, 7, 18, 9, 0, 0);
  let book = createEmptyVocabularyBook();
  for (let index = 0; index < 12; index += 1) {
    const entry = { ...dictionaryEntry, word: `word${String.fromCharCode(97 + index)}` };
    book = addVocabularyEntry(book, {
      ...addInput(new Date(now.getTime() + index * 1_000)),
      rawWord: entry.word,
      dictionaryEntry: entry,
      context: null
    }).book;
  }
  const queue = buildDailyReviewQueue(book, 10, now);
  assert.equal(queue.length, 10);
  assert.equal(getDailyReviewSummary(book, 10, now).availableNew, 10);

  const yesterday = new Date(2026, 7, 17, 9, 0, 0);
  const introduced = introduceVocabularyEntry(book, queue[0]!, yesterday);
  const reviewed = rateVocabularyEntry(introduced, queue[0]!, "hard", yesterday);
  const reordered = buildDailyReviewQueue(reviewed, 10, now);
  assert.equal(reordered[0], queue[0]);
  assert.equal(reordered.length, 11);
});

test("备注更新和确认后的删除只影响目标条目", () => {
  const now = new Date("2026-08-18T01:00:00.000Z");
  const book = oneEntryBook(now);
  const noted = updateVocabularyNote(book, "study", "注意过去式 studied");
  assert.equal(noted.entries.study?.personalNote, "注意过去式 studied");
  const removed = removeVocabularyEntry(noted, "study");
  assert.equal(removed.entries.study, undefined);
});

test("完整编辑生词会迁移 ID 并保留语境和复习进度", () => {
  const now = new Date("2026-08-18T01:00:00.000Z");
  const introduced = introduceVocabularyEntry(oneEntryBook(now), "study", now);
  const reviewed = rateVocabularyEntry(introduced, "study", "good", now);
  const original = reviewed.entries.study!;
  const edited = updateVocabularyEntry(reviewed, "study", {
    word: "Research",
    phonetic: "rɪˈsɜːrtʃ",
    partOfSpeech: "v. / n.",
    chineseTranslation: "研究；调查",
    englishDefinition: "a careful investigation",
    examTags: ["cet6", "toefl", "cet6"],
    personalNote: "注意重音"
  });
  assert.equal(edited.entries.study, undefined);
  assert.equal(edited.entries.research?.id, "research");
  assert.equal(edited.entries.research?.word, "Research");
  assert.equal(edited.entries.research?.userEdited, true);
  assert.deepEqual(edited.entries.research?.examTags, ["cet6", "toefl"]);
  assert.deepEqual(edited.entries.research?.contexts, original.contexts);
  assert.deepEqual(edited.entries.research?.review, original.review);
  assert.equal(edited.entries.research?.createdAt, original.createdAt);
  assert.deepEqual(validateVocabularyBook(edited), edited);
});

test("个人版本再次加入时只增加语境且不被词典字段覆盖", () => {
  const firstTime = new Date("2026-08-18T01:00:00.000Z");
  const edited = updateVocabularyEntry(oneEntryBook(firstTime), "study", {
    word: "study",
    phonetic: "个人音标",
    partOfSpeech: "个人词性",
    chineseTranslation: "我的释义",
    englishDefinition: "my definition",
    examTags: ["ielts"],
    personalNote: "我的备注"
  });
  const secondTime = new Date("2026-08-19T01:00:00.000Z");
  const readded = addVocabularyEntry(edited, {
    ...addInput(secondTime, 20),
    dictionaryEntry: {
      ...dictionaryEntry,
      phonetic: "不应覆盖",
      partOfSpeech: "不应覆盖",
      chineseTranslation: "不应覆盖",
      englishDefinition: "should not overwrite",
      examTags: ["cet4"]
    },
    personalNote: "不应覆盖",
    studyProfile: "toefl"
  }).entry;

  assert.equal(readded.userEdited, true);
  assert.equal(readded.phonetic, "个人音标");
  assert.equal(readded.partOfSpeech, "个人词性");
  assert.equal(readded.chineseTranslation, "我的释义");
  assert.equal(readded.englishDefinition, "my definition");
  assert.deepEqual(readded.examTags, ["ielts"]);
  assert.equal(readded.personalNote, "我的备注");
  assert.equal(readded.contexts.length, 2);
  assert.deepEqual(readded.studyProfiles, ["cet4", "toefl"]);
  assert.equal(readded.lastSeenAt, secondTime.toISOString());
});

test("旧版生词数据没有个人版本标记时仍可读取", () => {
  const legacy = JSON.parse(JSON.stringify(
    oneEntryBook(new Date("2026-08-18T01:00:00.000Z"))
  )) as { entries: Record<string, Record<string, unknown>> };
  delete legacy.entries.study?.userEdited;
  assert.equal(validateVocabularyBook(legacy).entries.study?.userEdited, false);
});

test("完整编辑生词会拒绝重复单词和无效空内容", () => {
  const now = new Date("2026-08-18T01:00:00.000Z");
  let book = oneEntryBook(now);
  book = addVocabularyEntry(book, {
    ...addInput(now),
    rawWord: "focus",
    dictionaryEntry: { ...dictionaryEntry, word: "focus" },
    context: null
  }).book;
  const base = {
    word: "focus",
    phonetic: "",
    partOfSpeech: "",
    chineseTranslation: "专注",
    englishDefinition: "",
    examTags: [],
    personalNote: ""
  };
  assert.throws(
    () => updateVocabularyEntry(book, "study", base),
    /已经存在/u
  );
  assert.throws(
    () => updateVocabularyEntry(book, "study", {
      ...base,
      word: "two words",
      chineseTranslation: ""
    }),
    /只能包含英文字母/u
  );
  assert.throws(
    () => updateVocabularyEntry(book, "study", {
      ...base,
      word: "study",
      chineseTranslation: ""
    }),
    /至少填写一项/u
  );
});
