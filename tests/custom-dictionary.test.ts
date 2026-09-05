import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  CustomDictionaryService,
  getCustomDictionaryCacheFolder,
  verifyCustomDictionaryPackage
} from "../src/custom-dictionary";

test("自定义词典缓存位于系统缓存而不是笔记库", () => {
  assert.equal(
    getCustomDictionaryCacheFolder("darwin", "/Users/tester", {}),
    "/Users/tester/Library/Caches/Lingua Study/Custom Dictionary"
  );
  assert.equal(
    getCustomDictionaryCacheFolder("win32", "C:\\Users\\tester", { LOCALAPPDATA: "D:\\Cache" }),
    "D:\\Cache/Lingua Study/Cache/Custom Dictionary"
  );
});

test("自定义词典文件原子安装为可读取的分片并可独立删除", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-custom-dictionary-"));
  const cache = join(root, "custom");
  const service = new CustomDictionaryService(cache);
  try {
    const result = await service.installFromFile(
      "my-words.csv",
      new TextEncoder().encode([
        "word,phonetic,definition,translation,pos,tags",
        "ability,əˈbɪləti,custom explanation,自定义能力,n,cet4",
        "rarewordx,,an uncommon word,测试生僻词,n,toefl",
        "bad row,,missing both,,n,cet4"
      ].join("\n")),
      () => undefined
    );
    assert.equal(result.manifest.entryCount, 2);
    assert.equal(result.manifest.skippedRows, 1);
    assert.equal(result.manifest.sourceFileName, "my-words.csv");
    assert.ok(await verifyCustomDictionaryPackage(cache));
    const shard = JSON.parse(
      gunzipSync(await readFile(join(cache, "a.json.gz"))).toString("utf8")
    ) as { entries: Record<string, unknown> };
    assert.ok(shard.entries.ability);
    assert.ok(service.readCompressedShard("r"));

    await service.clear();
    assert.equal(service.getStatus().installed, false);
    assert.equal(await verifyCustomDictionaryPackage(cache), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("自定义词典支持 TSV 和 JSON 安装", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-custom-dictionary-formats-"));
  const service = new CustomDictionaryService(join(root, "custom"));
  try {
    const tsv = await service.installFromFile(
      "dictionary.tsv",
      new TextEncoder().encode("word\ttranslation\nfocus\t专注"),
      () => undefined
    );
    assert.equal(tsv.manifest.entryCount, 1);
    assert.equal(tsv.manifest.sourceFileName, "dictionary.tsv");

    const json = await service.installFromFile(
      "dictionary.json",
      new TextEncoder().encode(JSON.stringify([
        { word: "clarity", translation: "清晰" }
      ])),
      () => undefined
    );
    assert.equal(json.manifest.entryCount, 1);
    assert.equal(json.manifest.sourceFileName, "dictionary.json");
    assert.ok(service.readCompressedShard("c"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("自定义词典拒绝错误扩展名和非 UTF-8 文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-custom-dictionary-invalid-"));
  const service = new CustomDictionaryService(join(root, "custom"));
  try {
    await assert.rejects(
      service.installFromFile("dictionary.txt", new TextEncoder().encode("word,translation\nx,测试"), () => undefined),
      /CSV、TSV 或 JSON/u
    );
    await assert.rejects(
      service.installFromFile("dictionary.csv", new Uint8Array([0xff, 0xfe]), () => undefined),
      /UTF-8/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
