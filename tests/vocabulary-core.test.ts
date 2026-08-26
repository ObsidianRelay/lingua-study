import assert from "node:assert/strict";
import test from "node:test";
import type { DictionaryEntry } from "../src/dictionary-core";
import {
  addVocabularyEntry,
  buildDailyReviewQueue,
  createEmptyVocabularyBook,
  getDailyReviewSummary,
  introduceVocabularyEntry,
  rateVocabularyEntry,
  removeVocabularyEntry,
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

test("四档评分使用固定首轮间隔和后续倍率", () => {
  const now = new Date(2026, 7, 18, 9, 0, 0);
  let book = introduceVocabularyEntry(oneEntryBook(now), "study", now);
  book = rateVocabularyEntry(book, "study", "again", now);
  assert.equal(Date.parse(book.entries.study!.review.dueAt) - now.getTime(), 10 * 60 * 1_000);
  assert.equal(book.entries.study!.review.lapses, 1);

  book = rateVocabularyEntry(book, "study", "hard", now);
  assert.equal(book.entries.study!.review.intervalDays, 1);
  book = rateVocabularyEntry(book, "study", "good", new Date(2026, 7, 19, 9, 0, 0));
  assert.equal(book.entries.study!.review.intervalDays, 3);
  book = rateVocabularyEntry(book, "study", "easy", new Date(2026, 7, 22, 9, 0, 0));
  assert.equal(book.entries.study!.review.intervalDays, 11);
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
