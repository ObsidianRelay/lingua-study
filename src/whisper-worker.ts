import { env, pipeline } from "@huggingface/transformers";
import { WHISPER_MODEL_ID, WHISPER_MODEL_REVISION } from "./whisper-model";
import type {
  WhisperWorkerResponse,
  WhisperWorkerTranscribeRequest
} from "./whisper-worker-protocol";

// Electron 会在 Web Worker 中注入 Node 的 process。ONNX Runtime 后续动态
// import 的 Emscripten 模块会据此误判为 Node，并尝试加载浏览器无法解析的
// worker_threads。这个 Worker 只运行浏览器版 Transformers，因此在隔离线程
// 内移除该标记，确保动态加载的 JSEP/WASM 也走 Web 分支。
Object.defineProperty(self, "process", {
  value: undefined,
  configurable: true
});

interface WhisperPipelineOutput {
  chunks?: unknown;
}

type WhisperTranscriber = (
  audio: Float32Array,
  options: Record<string, unknown>
) => Promise<WhisperPipelineOutput>;

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WhisperWorkerTranscribeRequest>) => void
  ): void;
  postMessage(message: WhisperWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;
let transcriberPromise: Promise<WhisperTranscriber> | null = null;

function post(message: WhisperWorkerResponse): void {
  workerScope.postMessage(message);
}

async function getTranscriber(id: number, wasmBaseUrl: string): Promise<WhisperTranscriber> {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+\/[a-f0-9]{48}\/$/u.test(wasmBaseUrl)) {
    throw new Error("本地 Whisper 运行地址无效。");
  }
  if (transcriberPromise) {
    return transcriberPromise;
  }
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.useFS = false;
  env.useFSCache = false;
  const wasm = env.backends.onnx?.wasm;
  if (!wasm) {
    throw new Error("当前环境没有可用的 ONNX WASM 后端。");
  }
  wasm.wasmPaths = wasmBaseUrl;
  wasm.numThreads = 1;
  wasm.proxy = false;
  transcriberPromise = pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
    revision: WHISPER_MODEL_REVISION,
    dtype: "q8",
    device: "wasm",
    progress_callback: (progress: Record<string, unknown>): void => {
      post({
        type: "progress",
        id,
        message: "正在准备本地 Whisper Base English 模型…",
        percent: typeof progress.progress === "number" ? progress.progress : null
      });
    }
  }).then((value) => value as unknown as WhisperTranscriber).catch((error: unknown) => {
    transcriberPromise = null;
    throw error;
  });
  return transcriberPromise;
}

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (
    !request || request.type !== "transcribe" || !Number.isSafeInteger(request.id) ||
    !(request.audio instanceof Float32Array)
  ) {
    return;
  }
  void (async (): Promise<void> => {
    try {
      const transcriber = await getTranscriber(request.id, request.wasmBaseUrl);
      post({ type: "progress", id: request.id, message: "正在本地识别并生成单词时间轴…", percent: null });
      const result = await transcriber(request.audio, {
        chunk_length_s: 29,
        stride_length_s: 5,
        return_timestamps: "word",
        force_full_sequences: false
      });
      post({ type: "result", id: request.id, chunks: result.chunks });
    } catch (error) {
      post({
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : "本地 Whisper 识别失败。"
      });
    }
  })();
});
