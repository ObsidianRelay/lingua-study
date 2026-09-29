import assert from "node:assert/strict";
import test from "node:test";
import { StudyChatTextAnimator } from "../src/study-chat-text-animator";

function createFrames() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  return {
    pending,
    request(callback: () => void): number {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id: number): void { pending.delete(id); },
    tick(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    }
  };
}

test("大段回复分多次画面更新，完整呈现且不丢字", async () => {
  const frames = createFrames();
  const animator = new StudyChatTextAnimator(frames.request, frames.cancel);
  const chunks: string[] = [];
  animator.setRenderer((chunk) => { chunks.push(chunk); });
  const answer = "学习英语需要联系上下文。".repeat(40);
  animator.append(answer);
  const finished = animator.finish();

  assert.equal(chunks.length, 0);
  frames.tick();
  assert.ok(chunks.length > 0);
  assert.ok(animator.visibleText.length < answer.length);
  while (frames.pending.size > 0) frames.tick();
  await finished;

  assert.equal(chunks.join(""), answer);
  assert.equal(animator.visibleText, answer);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 64));
});

test("重绘时能接续已显示内容，关闭视图会取消后续画面更新", async () => {
  const frames = createFrames();
  const animator = new StudyChatTextAnimator(frames.request, frames.cancel);
  const first: string[] = [];
  animator.setRenderer((chunk) => { first.push(chunk); });
  animator.append("a".repeat(300));
  frames.tick();
  const visible = animator.visibleText;

  const second: string[] = [];
  animator.setRenderer((chunk) => { second.push(chunk); });
  const finished = animator.finish();
  frames.tick();
  assert.equal(first.join(""), visible);
  assert.ok(second.length > 0);
  animator.dispose();
  await finished;
  assert.equal(frames.pending.size, 0);
});
