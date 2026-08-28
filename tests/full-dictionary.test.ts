import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildFullDictionaryPackage,
  createFullDictionaryArchive,
  downloadFileWithResume,
  extractFullDictionaryArchive,
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

    const firstArchive = join(root, "dictionary-1.zip");
    const secondArchive = join(root, "dictionary-2.zip");
    const firstArchiveResult = await createFullDictionaryArchive(output, firstArchive);
    const secondArchiveResult = await createFullDictionaryArchive(output, secondArchive);
    assert.equal(firstArchiveResult.sha256, secondArchiveResult.sha256);
    assert.equal(firstArchiveResult.bytes, secondArchiveResult.bytes);
    const extracted = join(root, "extracted");
    const extractedManifest = await extractFullDictionaryArchive(firstArchive, extracted);
    assert.equal(extractedManifest.entryCount, manifest.entryCount);
    assert.ok(await verifyFullDictionaryPackage(extracted));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("词典下载中断后保留进度并使用 Range 续传", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-dictionary-download-"));
  const target = join(root, "dictionary.part");
  const payload = Buffer.alloc(512 * 1024);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = index % 251;
  }
  const expectedSha256 = createHash("sha256").update(payload).digest("hex");
  let firstRequest = true;
  let resumedAt = 0;
  const server = createServer((request, response) => {
    const range = request.headers.range;
    if (firstRequest && !range) {
      firstRequest = false;
      response.writeHead(200, { "Content-Length": payload.byteLength });
      response.write(payload.subarray(0, 128 * 1024));
      setImmediate(() => response.destroy());
      return;
    }
    const match = typeof range === "string" ? /^bytes=(\d+)-$/u.exec(range) : null;
    resumedAt = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    response.writeHead(206, {
      "Content-Length": payload.byteLength - resumedAt,
      "Content-Range": `bytes ${resumedAt}-${payload.byteLength - 1}/${payload.byteLength}`
    });
    response.end(payload.subarray(resumedAt));
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await downloadFileWithResume({
      url: `http://127.0.0.1:${address.port}/dictionary`,
      targetPath: target,
      maxBytes: 1024 * 1024,
      expectedSha256,
      attempts: 3,
      retryBaseDelayMs: 5
    });
    assert.ok(resumedAt > 0);
    assert.equal(result.sha256, expectedSha256);
    assert.deepEqual(await readFile(target), payload);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
