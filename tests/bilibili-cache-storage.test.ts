import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getOrderedBilibiliCacheFolders,
  readCachedBilibiliFiles
} from "../src/bilibili-cache-storage";

const BVID = "BV1B7411m7LV";

async function writeValidCache(folder: string, label: string, cid: number): Promise<void> {
  await mkdir(folder, { recursive: true });
  const file = `${BVID}-p1-${cid}.mp4`;
  const content = `video-${label}`;
  await writeFile(join(folder, file), content, "utf8");
  await writeFile(join(folder, `${BVID}-p1.json`), `${JSON.stringify({
    version: 1,
    platform: "bilibili",
    bvid: BVID,
    aid: 123,
    cid,
    page: 1,
    title: label,
    sourceUrl: `https://www.bilibili.com/video/${BVID}`,
    createdAt: "2026-09-18T00:00:00.000Z",
    segments: [{ file, size: Buffer.byteLength(content), duration: 10 }]
  })}\n`, "utf8");
}

test("自定义缓存优先于旧默认缓存", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-cache-priority-"));
  try {
    const primary = join(root, "custom");
    const fallback = join(root, "legacy");
    await Promise.all([
      writeValidCache(primary, "custom", 101),
      writeValidCache(fallback, "legacy", 202)
    ]);
    const result = await readCachedBilibiliFiles(primary, [fallback], BVID, 1);
    assert.equal(result?.folder, primary);
    assert.equal(result?.manifest.title, "custom");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("自定义缓存损坏时回退到旧默认缓存", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-cache-fallback-"));
  try {
    const primary = join(root, "custom");
    const fallback = join(root, "legacy");
    await Promise.all([mkdir(primary), writeValidCache(fallback, "legacy", 202)]);
    await writeFile(join(primary, `${BVID}-p1.json`), "{broken", "utf8");
    const result = await readCachedBilibiliFiles(primary, [fallback], BVID, 1);
    assert.equal(result?.folder, fallback);
    assert.equal(result?.manifest.title, "legacy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("缓存读取目录按顺序去重", () => {
  assert.deepEqual(
    getOrderedBilibiliCacheFolders("/custom", ["/legacy", "/custom", "/legacy"]),
    ["/custom", "/legacy"]
  );
});
