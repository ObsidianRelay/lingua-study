import assert from "node:assert/strict";
import test from "node:test";
import { isManagedLegacyWhisperUrl } from "../src/legacy-whisper-cleanup";

test("只识别 Lingua Study 管理过的三种 Whisper 模型缓存", () => {
  assert.equal(isManagedLegacyWhisperUrl("https://huggingface.co/distil-whisper/distil-large-v3/resolve/rev/model.onnx"), true);
  assert.equal(isManagedLegacyWhisperUrl("https://huggingface.co/Xenova/whisper-base.en/resolve/main/model.onnx"), true);
  assert.equal(isManagedLegacyWhisperUrl("https://huggingface.co/Xenova/whisper-small.en/resolve/main/model.onnx"), true);
  assert.equal(isManagedLegacyWhisperUrl("https://huggingface.co/user/other-model/resolve/main/model.onnx"), false);
  assert.equal(isManagedLegacyWhisperUrl("https://evil.example/Xenova/whisper-small.en/resolve/main/model.onnx"), false);
});
