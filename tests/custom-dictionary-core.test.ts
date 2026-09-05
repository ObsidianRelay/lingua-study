import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_DICTIONARY_JSON_TEMPLATE,
  CUSTOM_DICTIONARY_TEMPLATE,
  CUSTOM_DICTIONARY_TSV_TEMPLATE,
  parseCustomDictionaryCsv,
  parseCustomDictionaryJson,
  parseCustomDictionaryTsv
} from "../src/custom-dictionary-core";

test("CSV、TSV 和 JSON 模板均可直接导入", () => {
  for (const parsed of [
    parseCustomDictionaryCsv(CUSTOM_DICTIONARY_TEMPLATE),
    parseCustomDictionaryTsv(CUSTOM_DICTIONARY_TSV_TEMPLATE),
    parseCustomDictionaryJson(CUSTOM_DICTIONARY_JSON_TEMPLATE)
  ]) {
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]?.normalizedWord, "dedication");
    assert.equal(parsed.entries[0]?.translation, "奉献");
    assert.deepEqual(parsed.entries[0]?.tags, ["cet4", "ielts"]);
  }
});

test("自定义词典支持中文表头、带逗号的引号字段和重复词覆盖", () => {
  const parsed = parseCustomDictionaryCsv([
    "\uFEFF单词,音标,英文释义,中文释义,词性,标签",
    "study,ˈstʌdi,old meaning,旧释义,n,cet4",
    "study,ˈstʌdi,\"to learn, examine or review\",学习,v,\"cet4,toefl\"",
    "long-term,,lasting for a long time,长期的,adj,ielts"
  ].join("\r\n"));
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.duplicateRows, 1);
  assert.equal(parsed.entries[0]?.definition, "to learn, examine or review");
  assert.deepEqual(parsed.entries[0]?.tags, ["cet4", "toefl"]);
  assert.equal(parsed.entries[1]?.normalizedWord, "long-term");
});

test("自定义词典报告无效行并拒绝缺失关键表头", () => {
  const parsed = parseCustomDictionaryCsv([
    "word,definition,translation",
    "two words,phrase,短语",
    "valid,acceptable,有效",
    ",missing,缺失"
  ].join("\n"));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.skippedRows, 2);
  assert.match(parsed.warnings[0] ?? "", /第 2 行/u);
  assert.throws(
    () => parseCustomDictionaryCsv("phonetic,translation\nx,测试"),
    /缺少 word/u
  );
  assert.throws(
    () => parseCustomDictionaryCsv("word,pos\nstudy,v"),
    /至少需要 definition/u
  );
});

test("自定义词典支持释义中的换行并拒绝未闭合引号", () => {
  const parsed = parseCustomDictionaryCsv(
    "word,definition,translation\r\nexample,\"first line\r\nsecond line\",例子"
  );
  assert.equal(parsed.entries[0]?.definition, "first line\nsecond line");
  assert.throws(
    () => parseCustomDictionaryCsv("word,translation\nexample,\"例子"),
    /未闭合/u
  );
});

test("TSV 支持相同表头、引号字段和重复词覆盖", () => {
  const parsed = parseCustomDictionaryTsv([
    "word\tdefinition\ttranslation\ttags",
    "focus\told meaning\t旧释义\tcet4",
    "focus\t\"attention paid\tto something\"\t专注\tielts toefl"
  ].join("\n"));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.duplicateRows, 1);
  assert.equal(parsed.entries[0]?.definition, "attention paid\tto something");
  assert.deepEqual(parsed.entries[0]?.tags, ["ielts", "toefl"]);
});

test("JSON 支持词条数组、entries 包装和中文字段", () => {
  const direct = parseCustomDictionaryJson(JSON.stringify([
    { word: "focus", definition: "attention", translation: "专注", tags: ["cet4", "ielts"] },
    { 单词: "focus", 英文释义: "concentration", 中文释义: "集中", 标签: "toefl" }
  ]));
  assert.equal(direct.entries.length, 1);
  assert.equal(direct.duplicateRows, 1);
  assert.equal(direct.entries[0]?.definition, "concentration");
  assert.deepEqual(direct.entries[0]?.tags, ["toefl"]);

  const wrapped = parseCustomDictionaryJson(JSON.stringify({
    entries: [{ word: "clarity", translation: "清晰" }]
  }));
  assert.equal(wrapped.entries[0]?.normalizedWord, "clarity");
  assert.throws(
    () => parseCustomDictionaryJson('{"word":"focus"}'),
    /顶层必须/u
  );
});
