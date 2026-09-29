import assert from "node:assert/strict";
import test from "node:test";
import { StudyChatStreamParser } from "../src/study-chat-stream-core";

test("流式聊天按跨网络片段的 SSE 事件逐段输出，只显示回答内容", () => {
  const parser = new StudyChatStreamParser();
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"reasoning_content":"隐藏思考"}}]}\r'), []);
  assert.deepEqual(parser.push('\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\n'), ["你好"]);
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n\n'), ["，世界"]);
  assert.deepEqual(parser.push("data: [DONE]\n\n"), []);
  assert.equal(parser.finish(), "你好，世界");
});

test("流式聊天发现提前断线、无效事件和空回答", () => {
  const interrupted = new StudyChatStreamParser();
  interrupted.push('data: {"choices":[{"delta":{"content":"部分内容"}}]}\n\n');
  assert.throws(() => interrupted.finish(), /提前中断/u);

  const malformed = new StudyChatStreamParser();
  assert.throws(() => malformed.push("data: {bad}\n\n"), /无法解析/u);

  const empty = new StudyChatStreamParser();
  empty.push("data: [DONE]\n\n");
  assert.throws(() => empty.finish(), /空内容/u);
});
