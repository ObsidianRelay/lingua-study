import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  DICTIONARY_SOURCE,
  OfflineDictionary,
  extractLookupWord,
  normalizeLookupWord,
  tokenizeDictionaryText
} from "../src/dictionary-core";

test("离线词典包含考试与高频子集并支持大小写和所有格", () => {
  assert.equal(DICTIONARY_SOURCE.revision, "bc015ed2e24a");
  assert.equal(DICTIONARY_SOURCE.frequencyLimit, 20_000);
  assert.ok(DICTIONARY_SOURCE.entryCount > 20_000);

  const dictionary = new OfflineDictionary();
  const ability = dictionary.lookup("Ability's");
  assert.equal(ability.normalizedQuery, "ability");
  assert.equal(ability.entry?.word, "ability");
  assert.ok(ability.entry?.chineseTranslation.includes("能力"));
  assert.ok(ability.entry?.examTags.includes("cet4"));
  assert.ok(ability.entry?.examTags.includes("ielts"));
});

test("字幕查词分词完整保留原文、空格和标点", () => {
  const source = "Dr. Smith's long-term plan — don't stop! 中文";
  const tokens = tokenizeDictionaryText(source);
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.deepEqual(
    tokens.filter((token) => token.isWord).map((token) => token.text),
    ["Dr", "Smith's", "long-term", "plan", "don't", "stop"]
  );
});

test("离线词典保留词形变化并为拼写误差提供建议", () => {
  const dictionary = new OfflineDictionary();
  const study = dictionary.lookup("study").entry;
  assert.equal(study?.word, "study");
  assert.ok(study?.inflections.some((item) => item.value === "studies"));

  const missing = dictionary.lookup("studyy");
  assert.equal(missing.entry, null);
  assert.ok(missing.suggestions.some((word) => word.toLowerCase() === "study"));
  assert.equal(dictionary.lookup("zzzzzznotaword").entry, null);
});

test("双击词提取只接受一个英文词", () => {
  assert.equal(extractLookupWord("dedication"), "dedication");
  assert.equal(extractLookupWord("don't"), "don't");
  assert.equal(extractLookupWord("long-term"), "long-term");
  assert.equal(extractLookupWord("two words"), null);
  assert.equal(extractLookupWord("中文"), null);
  assert.equal(normalizeLookupWord("  Student’s  "), "student");
});

test("精简版未收录时自动回退到本地完整版分片", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-external-dictionary-"));
  await mkdir(root, { recursive: true });
  const packed = ["rarewordx", "rer", "an uncommon test word", "测试生僻词", "n", [], 0, 0, ""];
  await writeFile(
    join(root, "r.json.gz"),
    gzipSync(JSON.stringify({ entries: { rarewordx: packed }, aliases: {} }))
  );
  try {
    const dictionary = new OfflineDictionary();
    dictionary.setExternalShardFolder(root);
    assert.equal(dictionary.lookup("rarewordx").entry?.chineseTranslation, "测试生僻词");
    dictionary.setExternalShardFolder(null);
    assert.equal(dictionary.lookup("rarewordx").entry, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
