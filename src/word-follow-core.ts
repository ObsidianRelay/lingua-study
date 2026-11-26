import type { TranscriptWord } from "./transcript-core";

export interface TimedWordRange {
  startOffset: number;
  endOffset: number;
}

/** 仅在识别出的词能按顺序对应当前字幕时启用逐词跟随。 */
export function matchTimedWordsToText(
  text: string,
  words: readonly TranscriptWord[]
): TimedWordRange[] | null {
  const source = text.toLocaleLowerCase();
  const ranges: TimedWordRange[] = [];
  let cursor = 0;
  for (const word of words) {
    const token = word.text.trim().toLocaleLowerCase();
    const startOffset = source.indexOf(token, cursor);
    if (token === "" || startOffset < 0) return null;
    if (/[\p{L}\p{N}]/u.test(source.slice(cursor, startOffset))) return null;
    const endOffset = startOffset + token.length;
    ranges.push({ startOffset, endOffset });
    cursor = endOffset;
  }
  if (/[\p{L}\p{N}]/u.test(source.slice(cursor))) return null;
  return ranges;
}
