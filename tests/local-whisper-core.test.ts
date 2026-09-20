import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getWhisperCacheFolder,
  isWhisperModelCacheUrl,
  WHISPER_MODEL_ID,
  WHISPER_MODEL_REVISION,
  WHISPER_RUNTIME_ASSETS,
  whisperChunksToTokens,
  whisperTokensToTranscriptSegments
} from "../src/local-whisper-core";

test("本地 Whisper 缓存位置不会写入 Obsidian 笔记库", () => {
  assert.equal(
    getWhisperCacheFolder("darwin", "/Users/test", {}),
    "/Users/test/Library/Caches/Lingua Study/Whisper Alignment"
  );
  assert.equal(
    getWhisperCacheFolder("linux", "/home/test", { XDG_CACHE_HOME: "/cache" }),
    "/cache/lingua-study/whisper-alignment"
  );
});

test("只识别固定版本 Whisper Base English 模型缓存", () => {
  assert.equal(WHISPER_MODEL_ID, "Xenova/whisper-base.en");
  assert.equal(
    isWhisperModelCacheUrl(
      `https://huggingface.co/${WHISPER_MODEL_ID}/resolve/${WHISPER_MODEL_REVISION}/onnx/encoder_model_quantized.onnx`
    ),
    true
  );
  assert.equal(
    isWhisperModelCacheUrl("https://huggingface.co/another/model/resolve/main/model.onnx"),
    false
  );
});

test("固定 WASM 运行文件校验值与构建依赖一致", async () => {
  assert.deepEqual(
    WHISPER_RUNTIME_ASSETS.map((asset) => asset.fileName),
    [
      "ort-wasm-simd-threaded.jsep.mjs",
      "ort-wasm-simd-threaded.jsep.wasm"
    ]
  );
  for (const asset of WHISPER_RUNTIME_ASSETS) {
    assert.match(asset.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@[^/]+\/dist\//u);
    const bytes = await readFile(`node_modules/onnxruntime-web/dist/${asset.fileName}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    assert.ok(bytes.length <= asset.maxBytes);
  }
});

test("Whisper 单词块转换为有序时间戳", () => {
  assert.deepEqual(whisperChunksToTokens([
    { text: " Hello", timestamp: [0.2, 0.5] },
    { text: " world", timestamp: [0.5, 0.9] }
  ], 10), [
    { text: "hello", spokenText: "Hello", start: 10.2, end: 10.5 },
    { text: "world", spokenText: "world", start: 10.5, end: 10.9 }
  ]);
});

test("Whisper 单词时间轴会生成可读的完整英文字幕", () => {
  assert.deepEqual(whisperTokensToTranscriptSegments([
    { text: "hello", spokenText: "Hello", start: 0, end: 0.3 },
    { text: "everyone.", spokenText: "everyone.", start: 0.3, end: 0.8 },
    { text: "welcome", spokenText: "Welcome", start: 1, end: 1.4 },
    { text: "back!", spokenText: "back!", start: 1.4, end: 1.8 }
  ]), [
    { text: "Hello everyone.", start: 0, end: 0.8 },
    { text: "Welcome back!", start: 1, end: 1.8 }
  ]);
});
