import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isLocalChatHost } from "./study-chat-core";
import { StudyChatStreamParser } from "./study-chat-stream-core";
import { translationHttpError } from "./translation-core";

const CHAT_IDLE_TIMEOUT_MS = 30_000;
const LOCAL_CHAT_IDLE_TIMEOUT_MS = 120_000;

export class StudyChatHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function streamStudyChat(
  endpoint: string,
  apiKey: string,
  body: object,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  options?: { allowEmptyResponse?: boolean; onReasoning?: () => void }
): Promise<string> {
  const url = new URL(endpoint);
  const isLocal = isLocalChatHost(url.hostname.toLowerCase());
  if (url.protocol === "http:" && !isLocal) {
    throw new Error("聊天服务的 HTTP 地址只允许本机回环地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("聊天服务地址必须使用 HTTP 或 HTTPS。");
  }
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
    const request = (url.protocol === "http:" ? httpRequest : httpsRequest)(endpoint, {
      method: "POST",
      signal,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        finish(new StudyChatHttpError(status, isLocal
          ? status === 404
            ? "本地模型或 API 路径不存在（404），请检查模型 ID 与地址。"
            : `本地模型请求失败（${status}），请检查模型 ID 与服务设置。`
          : translationHttpError(status).replaceAll("翻译", "聊天")));
        return;
      }
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        try {
          const hadReasoning = parser.hasReasoning;
          const deltas = parser.push(chunk);
          if (!hadReasoning && parser.hasReasoning) options?.onReasoning?.();
          for (const delta of deltas) onDelta(delta);
        } catch (error) {
          request.destroy(error instanceof Error ? error : new Error("聊天流式响应解析失败。"));
        }
      });
      response.on("end", () => {
        try {
          finish(null, parser.finish(!options?.allowEmptyResponse));
        } catch (error) {
          finish(error instanceof Error ? error : new Error("聊天回答未完整返回。"));
        }
      });
      response.on("aborted", () => finish(new Error("聊天连接提前中断，请重试。")));
      response.on("error", (error) => finish(error));
    });
    const timeoutMs = isLocal ? LOCAL_CHAT_IDLE_TIMEOUT_MS : CHAT_IDLE_TIMEOUT_MS;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(isLocal
        ? "本地模型响应等待超过 120 秒，请检查模型是否已加载。"
        : "聊天响应等待超过 30 秒，请检查网络或稍后重试。"));
    });
    request.on("error", (error) => {
      finish(error.message.startsWith("聊天") || error.message.startsWith("本地模型") || error.name === "AbortError"
        ? error
        : new Error(isLocal
          ? "无法连接本地模型服务，请确认服务已启动且地址、端口正确。"
          : "无法连接聊天服务，请检查网络、API 地址或代理设置。", { cause: error }));
    });
    request.end(payload);
  });
}
