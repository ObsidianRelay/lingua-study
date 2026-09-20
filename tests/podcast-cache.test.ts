import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BilibiliCacheService } from "../src/bilibili-cache";
import { PodcastCacheService } from "../src/podcast-cache";

test("播客音频会跟随安全重定向缓存，并在再次导入时复用", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/episode.mp3" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "audio/mpeg", "content-length": "5" });
    response.end("audio");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const cacheFolder = await mkdtemp(join(tmpdir(), "lingua-podcast-test-"));
  const assets = {
    exposeLocalAssets: async () => "http://127.0.0.1:9911/"
  } as unknown as BilibiliCacheService;
  try {
    const service = new PodcastCacheService(assets, { cacheFolder });
    const episode = {
      sourceId: "podcast-Hy7Evp-O9-Pe2QMclLiLfI",
      guid: "episode-42",
      title: "Example",
      publishedAt: null,
      enclosureUrl: `http://127.0.0.1:${address.port}/redirect`,
      enclosureType: "audio/mpeg",
      enclosureBytes: null,
      transcripts: []
    };
    const first = await service.cacheEpisode(episode, () => {});
    assert.equal(first.reused, false);
    assert.equal(first.cached.fileUrls[0], "http://127.0.0.1:9911/podcast-Hy7Evp-O9-Pe2QMclLiLfI.mp3");
    assert.equal(first.cached.segments[0]?.duration, 0);
    const second = await service.cacheEpisode(episode, () => {});
    assert.equal(second.reused, true);
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(cacheFolder, { recursive: true, force: true });
  }
});
