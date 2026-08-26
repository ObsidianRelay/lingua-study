import { join } from "node:path";
import type { TimedRecognitionToken } from "./document-transcript-core";
export {
  WHISPER_MODEL_ID,
  WHISPER_MODEL_REVISION,
  WHISPER_RUNTIME_VERSION
} from "./whisper-model";
import { WHISPER_MODEL_ID, WHISPER_MODEL_REVISION } from "./whisper-model";

const ONNXRUNTIME_WEB_VERSION = "1.22.0-dev.20250409-89f8206ba4";
const ONNXRUNTIME_WEB_DIST_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist`;

export interface WhisperRuntimeAsset {
  fileName: string;
  url: string;
  sha256: string;
  contentType: string;
  maxBytes: number;
}

export const WHISPER_RUNTIME_ASSETS: readonly WhisperRuntimeAsset[] = [
  {
    // Transformers 的浏览器构建使用带 JSEP 的 ONNX Runtime，文件名必须
    // 与运行时动态 import 的名称完全一致，否则本地服务会返回 404。
    fileName: "ort-wasm-simd-threaded.jsep.mjs",
    url: `${ONNXRUNTIME_WEB_DIST_URL}/ort-wasm-simd-threaded.jsep.mjs`,
    sha256: "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9",
    contentType: "text/javascript; charset=utf-8",
    maxBytes: 128 * 1024
  },
  {
    fileName: "ort-wasm-simd-threaded.jsep.wasm",
    url: `${ONNXRUNTIME_WEB_DIST_URL}/ort-wasm-simd-threaded.jsep.wasm`,
    sha256: "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
    contentType: "application/wasm",
    maxBytes: 32 * 1024 * 1024
  }
] as const;

export function getWhisperCacheFolder(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Caches", "Lingua Study", "Whisper Alignment");
  }
  if (platform === "win32") {
    return join(
      environment.LOCALAPPDATA?.trim() || join(homeDirectory, "AppData", "Local"),
      "Lingua Study",
      "Cache",
      "Whisper Alignment"
    );
  }
  return join(
    environment.XDG_CACHE_HOME?.trim() || join(homeDirectory, ".cache"),
    "lingua-study",
    "whisper-alignment"
  );
}

export function isWhisperModelCacheUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLocaleLowerCase("en-US") === "huggingface.co" &&
      url.pathname.startsWith(`/${WHISPER_MODEL_ID}/resolve/${WHISPER_MODEL_REVISION}/`);
  } catch {
    return false;
  }
}

export function whisperChunksToTokens(
  value: unknown,
  offsetSeconds = 0
): TimedRecognitionToken[] {
  if (!Array.isArray(value) || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    throw new Error("本地语音识别没有返回有效的单词时间轴。");
  }
  const tokens = value.flatMap((raw): TimedRecognitionToken[] => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const item = raw as Record<string, unknown>;
    const timestamp = item.timestamp;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!Array.isArray(timestamp) || typeof timestamp[0] !== "number" || text === "") {
      return [];
    }
    const start = timestamp[0];
    const end = typeof timestamp[1] === "number" ? timestamp[1] : start + 0.2;
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ text: text.toLocaleLowerCase("en-US"), start: start + offsetSeconds, end: end + offsetSeconds }]
      : [];
  });
  if (tokens.length === 0) {
    throw new Error("本地语音识别没有生成有效的单词时间轴。");
  }
  return tokens;
}
