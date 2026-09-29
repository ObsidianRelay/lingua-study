/** 可由本地 Whisper 解码的、通过 localhost 暴露的音频文件。 */
export interface CachedAudioMedia {
  fileUrls: readonly string[];
  segments: readonly { duration: number }[];
}
