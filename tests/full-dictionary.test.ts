import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildFullDictionaryPackage,
  getFullDictionaryCacheFolder,
  validateFullDictionaryManifest,
  verifyFullDictionaryPackage
} from "../src/full-dictionary";

test("完整版词典缓存目录位于系统缓存而不是笔记库", () => {
  assert.equal(
    getFullDictionaryCacheFolder("darwin", "/Users/tester", {}),
    "/Users/tester/Library/Caches/Lingua Study/Dictionary"
  );
  assert.equal(
    getFullDictionaryCacheFolder("win32", "C:\\Users\\tester", { LOCALAPPDATA: "D:\\Cache" }),
    "D:\\Cache/Lingua Study/Cache/Dictionary"
  );
});

test("完整版词典清单拒绝损坏和不兼容数据", () => {
  assert.equal(validateFullDictionaryManifest({ version: 99 }), null);
  assert.equal(validateFullDictionaryManifest({ version: 1, entryCount: -1 }), null);
});

test("官方 CSV 可以生成按首字母加载的压缩分片", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-full-dictionary-"));
  const source = join(root, "ecdict.csv");
  const output = join(root, "package");
  await mkdir(output);
  await writeFile(source, [
    "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio",
    "rarewordx,rer,an uncommon test word,测试生僻词,n,0,0,toefl,0,0,s:rarewordxes,,",
    "study,stadi,to learn,学习,v,0,0,cet4,100,90,s:studies/p:studied,,",
    "constructor,kanstraktar,a person who constructs,建造者,n,0,0,,24093,29875,s:constructors,,"
  ].join("\n"), "utf8");

  try {
    const manifest = await buildFullDictionaryPackage(source, output);
    assert.equal(manifest.entryCount, 3);
    assert.ok(manifest.aliasCount >= 3);
    const shard = JSON.parse(
      gunzipSync(await readFile(join(output, "r.json.gz"))).toString("utf8")
    ) as { entries: Record<string, unknown>; aliases: Record<string, string> };
    assert.ok(shard.entries.rarewordx);
    assert.equal(shard.aliases.rarewordxes, "rarewordx");
    const constructorShard = JSON.parse(
      gunzipSync(await readFile(join(output, "c.json.gz"))).toString("utf8")
    ) as { entries: Record<string, unknown>; aliases: Record<string, string> };
    assert.ok(constructorShard.entries.constructor);
    assert.equal(constructorShard.aliases.constructors, "constructor");
    assert.ok(validateFullDictionaryManifest(manifest));
    const index = JSON.parse(
      await readFile(join(output, "dictionary-index.json"), "utf8")
    ) as { entryCount: number };
    assert.equal(index.entryCount, manifest.entryCount);
    await assert.rejects(readFile(join(output, "manifest.json"), "utf8"));

    // 旧版缓存无需重新下载：发现合法的旧索引后会改成专用文件名。
    await rename(
      join(output, "dictionary-index.json"),
      join(output, "manifest.json")
    );
    assert.ok(await verifyFullDictionaryPackage(output));
    await readFile(join(output, "dictionary-index.json"), "utf8");
    await assert.rejects(readFile(join(output, "manifest.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
