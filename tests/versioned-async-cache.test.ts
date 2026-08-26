import assert from "node:assert/strict";
import test from "node:test";
import { VersionedAsyncCache } from "../src/versioned-async-cache";

test("相同键和版本复用异步计算结果", async () => {
  const cache = new VersionedAsyncCache<number>(2);
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await cache.getOrCreate("a", "1", factory), 1);
  assert.equal(await cache.getOrCreate("a", "1", factory), 1);
  assert.equal(calls, 1);
});

test("版本变化、失败结果和超出容量都会重新计算", async () => {
  const cache = new VersionedAsyncCache<number>(2);
  let calls = 0;
  const next = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await cache.getOrCreate("a", "1", next), 1);
  assert.equal(await cache.getOrCreate("a", "2", next), 2);
  await assert.rejects(cache.getOrCreate("bad", "1", async () => Promise.reject(new Error("失败"))));
  assert.equal(await cache.getOrCreate("bad", "1", next), 3);
  assert.equal(await cache.getOrCreate("c", "1", next), 4);
  assert.equal(await cache.getOrCreate("a", "2", next), 5);
});
