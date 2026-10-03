import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { streamStudyChat, StudyChatHttpError } from "../src/study-chat-stream";

test("本地聊天通过 HTTP 流式返回，按需发送凭据并报告服务错误", async () => {
  const seenAuth: Array<string | undefined> = [];
  const server = createServer(async (request, response) => {
    seenAuth.push(request.headers.authorization);
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const model = (JSON.parse(raw) as { model: string }).model;
    if (model === "missing") {
      response.writeHead(404).end();
      return;
    }
    if (model === "unsupported") {
      response.writeHead(400).end();
      return;
    }
    if (model === "cut") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n');
      return;
    }
    if (model === "reasoning-only") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"reasoning":"思考"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    if (model === "reasoning-then-answer") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"本地回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"本地回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const body = { model: "ready", messages: [{ role: "user", content: "你好" }], stream: true };
  try {
    const deltas: string[] = [];
    assert.equal(await streamStudyChat(endpoint, "", body, (text) => deltas.push(text)), "本地回答");
    assert.deepEqual(deltas, ["本地回答"]);
    assert.equal(await streamStudyChat(endpoint, "secret", body, () => undefined), "本地回答");
    assert.deepEqual(seenAuth.slice(0, 2), [undefined, "Bearer secret"]);
    assert.equal(await streamStudyChat(
      endpoint, "", { ...body, model: "reasoning-only" }, () => undefined,
      undefined, { allowEmptyResponse: true }
    ), "");
    await assert.rejects(
      streamStudyChat(endpoint, "", { ...body, model: "reasoning-only" }, () => undefined), /只返回了思考内容/u
    );
    let reasoningCount = 0;
    assert.equal(await streamStudyChat(
      endpoint, "", { ...body, model: "reasoning-then-answer" }, () => undefined,
      undefined, { onReasoning: () => { reasoningCount += 1; } }
    ), "本地回答");
    assert.equal(reasoningCount, 1);
    await assert.rejects(
      streamStudyChat(endpoint, "", { ...body, model: "missing" }, () => undefined), /模型或 API 路径不存在/u
    );
    await assert.rejects(
      streamStudyChat(endpoint, "", { ...body, model: "unsupported" }, () => undefined),
      (error: unknown) => error instanceof StudyChatHttpError && error.status === 400
    );
    await assert.rejects(
      streamStudyChat(endpoint, "", { ...body, model: "cut" }, () => undefined), /提前中断/u
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await assert.rejects(streamStudyChat(endpoint, "", body, () => undefined), /服务已启动/u);
  assert.throws(() => streamStudyChat("http://example.com/v1/chat/completions", "", body, () => undefined), /回环地址/u);
});

test("本地聊天请求可以取消", async () => {
  const controller = new AbortController();
  const server = createServer(async (request) => {
    for await (const _chunk of request) { /* 等待完整请求后取消。 */ }
    controller.abort();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(streamStudyChat(
      `http://127.0.0.1:${address.port}/v1/chat/completions`, "",
      { model: "ready", messages: [{ role: "user", content: "你好" }], stream: true },
      () => undefined, controller.signal
    ), { name: "AbortError" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
