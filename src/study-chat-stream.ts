import { request as httpsRequest } from "node:https";
import { StudyChatStreamParser } from "./study-chat-stream-core";
import { translationHttpError } from "./translation-core";

const CHAT_IDLE_TIMEOUT_MS = 30_000;

export function streamStudyChat(
  endpoint: string,
  apiKey: string,
  body: object,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const payload = JSON.stringify(body);
  const parser = new StudyChatStreamParser();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, answer?: string): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(answer ?? "");
    };
    const request = httpsRequest(endpoint, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        finish(new Error(translationHttpError(status).replaceAll("翻译", "聊天")));
        return;
      }
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        try {
          for (const delta of parser.push(chunk)) onDelta(delta);
        } catch (error) {
          request.destroy(error instanceof Error ? error : new Error("聊天流式响应解析失败。"));
        }
      });
      response.on("end", () => {
        try {
          finish(null, parser.finish());
        } catch (error) {
          finish(error instanceof Error ? error : new Error("聊天回答未完整返回。"));
        }
      });
      response.on("aborted", () => finish(new Error("聊天连接提前中断，请重试。")));
      response.on("error", (error) => finish(error));
    });
    request.setTimeout(CHAT_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error("聊天响应等待超过 30 秒，请检查网络或稍后重试。"));
    });
    request.on("error", (error) => {
      finish(error.message.startsWith("聊天") || error.name === "AbortError"
        ? error
        : new Error("无法连接聊天服务，请检查网络、API 地址或代理设置。", { cause: error }));
    });
    request.end(payload);
  });
}
