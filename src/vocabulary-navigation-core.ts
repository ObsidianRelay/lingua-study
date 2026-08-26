export interface VocabularyRendererCandidate<T> {
  renderer: T;
  readyOrder: number;
  eligible: boolean;
}

/**
 * 同一笔记可能残留多个 Markdown 渲染实例。只从当前目标标签页的可见实例中，
 * 选择最后完成初始化的一个，避免把高亮加到隐藏或已过期的 DOM 上。
 */
export function selectNewestEligibleRenderer<T>(
  candidates: readonly VocabularyRendererCandidate<T>[]
): T | null {
  let selected: VocabularyRendererCandidate<T> | null = null;
  for (const candidate of candidates) {
    if (!candidate.eligible) {
      continue;
    }
    if (!selected || candidate.readyOrder > selected.readyOrder) {
      selected = candidate;
    }
  }
  return selected?.renderer ?? null;
}
