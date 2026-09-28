/** 浏览器 Worker 与桌面主线程共享的固定模型标识；本文件不能导入 Node 模块。 */
export const WHISPER_MODEL_ID = "Xenova/whisper-base.en";
export const WHISPER_MODEL_REVISION = "95bf40a508535962c6483ead40270b2e32267508";
export const WHISPER_RUNTIME_VERSION = "3.8.1";
export const DEFAULT_WHISPER_MODEL_HOST = "https://huggingface.co/";

/** 备用来源只接受不含凭据或查询参数的 HTTPS 根地址。空值表示官方来源。 */
export function sanitizeWhisperModelSource(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  try {
    const input = value.trim();
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password ||
      input.includes("?") || input.includes("#")) {
      return "";
    }
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return "";
  }
}

export function getWhisperModelHost(source: string): string {
  return source || DEFAULT_WHISPER_MODEL_HOST;
}
