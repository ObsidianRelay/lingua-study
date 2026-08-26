import assert from "node:assert/strict";
import test from "node:test";
import { AsyncKeyedQueue } from "../src/async-keyed-queue";

test("同一字幕文件的两个写入任务严格串行并保留两次修改", async () => {
  const queue = new AsyncKeyedQueue();
  const events: string[] = [];
  const values: string[] = [];
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run("subtitle.json", async () => {
    events.push("first-start");
    await firstGate;
    values.push("first");
    events.push("first-end");
  });
  const second = queue.run("subtitle.json", async () => {
    events.push("second-start");
    values.push("second");
    events.push("second-end");
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  assert.deepEqual(values, ["first", "second"]);
});

test("不同字幕文件的写入任务可以并行", async () => {
  const queue = new AsyncKeyedQueue();
  const started: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run("first.json", async () => {
    started.push("first");
    await gate;
  });
  const second = queue.run("second.json", async () => {
    started.push("second");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["first", "second"]);
  release();
  await Promise.all([first, second]);
});
