import type { CachedBilibiliVideo } from "./bilibili-cache";

export interface DecodedAudioChunk {
  samples: Float32Array;
  offsetSeconds: number;
}

const SAMPLE_RATE = 16_000;

async function decodeLocalAsset(fileUrl: string): Promise<Float32Array> {
  const parsed = new URL(fileUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("已阻止从非本机地址读取视频音轨。");
  }
  const response = await window.fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`无法读取本地缓存视频（HTTP ${response.status}）。`);
  }
  const source = await response.arrayBuffer();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(source);
    if (decoded.length === 0 || decoded.numberOfChannels === 0) {
      throw new Error("视频中没有可识别的音轨。");
    }
    const output = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const input = decoded.getChannelData(channel);
      for (let index = 0; index < input.length; index += 1) {
        output[index] = (output[index] ?? 0) + (input[index] ?? 0) / decoded.numberOfChannels;
      }
    }
    return output;
  } catch (error) {
    throw new Error("无法解码本地缓存视频的音轨。", { cause: error });
  } finally {
    await context.close();
  }
}

export async function decodeCachedAudio(
  cached: CachedBilibiliVideo,
  onProgress: (message: string) => void
): Promise<DecodedAudioChunk[]> {
  const chunks: DecodedAudioChunk[] = [];
  let manifestOffset = 0;
  for (const [index, fileUrl] of cached.fileUrls.entries()) {
    onProgress(`正在读取视频音轨 ${index + 1}/${cached.fileUrls.length}…`);
    const samples = await decodeLocalAsset(fileUrl);
    chunks.push({ samples, offsetSeconds: manifestOffset });
    manifestOffset += cached.manifest.segments[index]?.duration ?? samples.length / SAMPLE_RATE;
  }
  if (chunks.length === 0) {
    throw new Error("缓存视频中没有可用音轨。");
  }
  return chunks;
}
