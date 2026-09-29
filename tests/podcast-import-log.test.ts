import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PodcastImportLog } from "../src/podcast-import-log";

test("播客导入日志写入本机文件且不妨碍调用方", async () => {
  const folder = await mkdtemp(join(tmpdir(), "lingua-podcast-log-test-"));
  try {
    const log = new PodcastImportLog({ folder });
    await log.write("cache", "音频缓存完成");
    await log.write("error", "下载 https://audio.example.test/a.mp3?token=secret 失败");
    const value = await readFile(log.path, "utf8");
    assert.match(value, /\[podcast-import:cache\] 音频缓存完成/u);
    assert.match(value, /https:\/\/audio\.example\.test\/a\.mp3/u);
    assert.doesNotMatch(value, /token=secret/u);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
