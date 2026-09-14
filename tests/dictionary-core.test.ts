import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  DICTIONARY_SOURCE,
  OfflineDictionary,
  extractLookupWord,
  inferLemmaCandidates,
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
  assert.equal(dictionary.lookup("studied").entry?.word, "study");
  assert.equal(dictionary.lookup("running").entry?.word, "run");
  assert.equal(dictionary.lookup("went").entry?.word, "go");
  assert.equal(dictionary.lookup("children").entry?.word, "child");
  assert.equal(dictionary.lookup("better").entry?.word, "good");

  const missing = dictionary.lookup("studyy");
  assert.equal(missing.entry, null);
  assert.ok(missing.suggestions.some((word) => word.toLowerCase() === "study"));
  assert.equal(dictionary.lookup("zzzzzznotaword").entry, null);
});

test("本地词形还原覆盖规则变化和 Issue 中的不规则示例", () => {
  assert.deepEqual(inferLemmaCandidates("studied").slice(0, 1), ["study"]);
  assert.ok(inferLemmaCandidates("running").includes("run"));
  assert.ok(inferLemmaCandidates("boxes").includes("box"));
  assert.ok(inferLemmaCandidates("bigger").includes("big"));
  assert.deepEqual(inferLemmaCandidates("went"), ["go"]);
  assert.deepEqual(inferLemmaCandidates("children"), ["child"]);
  assert.deepEqual(inferLemmaCandidates("better"), ["good", "well"]);
  assert.deepEqual(inferLemmaCandidates("him"), ["he"]);
});

test("查词优先使用明确词形关系，并为无 forms 的自定义词典推断原形", () => {
  const pack = (word: string, exchange = "") =>
    [word, "", `${word} definition`, `${word} 释义`, "", [], 0, 0, exchange];
  const shards: Record<string, ReturnType<typeof gzipSync>> = {
    b: gzipSync(JSON.stringify({
      entries: { better: pack("better", "0:good/1:r") },
      aliases: {}
    })),
    g: gzipSync(JSON.stringify({ entries: { good: pack("good") }, aliases: {} })),
    r: gzipSync(JSON.stringify({ entries: { run: pack("run") }, aliases: {} })),
    s: gzipSync(JSON.stringify({ entries: { study: pack("study") }, aliases: {} })),
    w: gzipSync(JSON.stringify({
      entries: { wander: pack("wander") },
      aliases: { went: "wander" }
    }))
  };
  const dictionary = new OfflineDictionary({});
  dictionary.setExternalShardLoader((key) => shards[key] ?? null);

  assert.equal(dictionary.lookup("better").entry?.word, "good");
  assert.equal(dictionary.lookup("running").entry?.word, "run");
  assert.equal(dictionary.lookup("studied").entry?.word, "study");
  assert.equal(dictionary.lookup("went").entry?.word, "wander");

  const customDirect = new OfflineDictionary({});
  customDirect.setExternalShardLoaders([{
    loader: (key) => key === "b"
      ? gzipSync(JSON.stringify({
        entries: { better: pack("better"), good: pack("good") },
        aliases: {}
      }))
      : null,
    resolveDirectInflections: false
  }]);
  assert.equal(customDirect.lookup("better").entry?.word, "better");
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
  const packed = ["rarewordx", "rer", "an uncommon test word", "测试生僻词", "n", [], 0, 0, ""];
  const compressed = gzipSync(JSON.stringify({ entries: { rarewordx: packed }, aliases: {} }));
  const dictionary = new OfflineDictionary();
  dictionary.setExternalShardLoader((key) => key === "r" ? compressed : null);
  assert.equal(dictionary.lookup("rarewordx").entry?.chineseTranslation, "测试生僻词");
  dictionary.setExternalShardLoader(null);
  assert.equal(dictionary.lookup("rarewordx").entry, null);
});

test("多个本地词典按自定义、完整版、精简版的顺序查找", () => {
  const customAbility = ["ability", "", "custom ability", "自定义能力", "n", [], 0, 0, ""];
  const fullRare = ["rarewordx", "", "full rare word", "完整词典生僻词", "n", [], 0, 0, ""];
  const custom = gzipSync(JSON.stringify({ entries: { ability: customAbility }, aliases: {} }));
  const fullA = gzipSync(JSON.stringify({ entries: {}, aliases: {} }));
  const fullR = gzipSync(JSON.stringify({ entries: { rarewordx: fullRare }, aliases: {} }));
  const dictionary = new OfflineDictionary();
  dictionary.setExternalShardLoaders([
    (key) => key === "a" ? custom : null,
    (key) => key === "a" ? fullA : key === "r" ? fullR : null
  ]);
  assert.equal(dictionary.lookup("ability").entry?.chineseTranslation, "自定义能力");
  assert.equal(dictionary.lookup("rarewordx").entry?.chineseTranslation, "完整词典生僻词");
  assert.ok(dictionary.lookup("study").entry);
});
