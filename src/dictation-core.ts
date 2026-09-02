export type DictationOperationKind = "match" | "substitution" | "deletion" | "insertion";

export interface DictationOperation {
  kind: DictationOperationKind;
  expected: string | null;
  actual: string | null;
}

export interface DictationResult {
  score: number;
  distance: number;
  expectedTokens: string[];
  actualTokens: string[];
  operations: DictationOperation[];
}

interface DictationToken {
  normalized: string;
  display: string;
}

interface AlignmentCandidate {
  kind: DictationOperationKind;
  distance: number;
  weightedDistance: number;
}

const DICTATION_TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[\u2018\u2019\u0060\u00b4'][\p{L}\p{N}]+)*/gu;
const DICTATION_APOSTROPHE_PATTERN = /[\u2018\u2019\u0060\u00b4']/gu;

function tokenizeDictationEntries(text: string): DictationToken[] {
  const normalizedText = text.normalize("NFKC");
  return Array.from(normalizedText.matchAll(DICTATION_TOKEN_PATTERN), (match) => ({
    display: match[0],
    normalized: match[0]
      .toLocaleLowerCase("en-US")
      .replace(DICTATION_APOSTROPHE_PATTERN, "")
  }));
}

function calculateCharacterDistance(expected: string, actual: string): number {
  const rowCount = expected.length + 1;
  const columnCount = actual.length + 1;
  const previous = Array.from({ length: columnCount }, (_, index) => index);
  const current = Array<number>(columnCount).fill(0);

  for (let row = 1; row < rowCount; row += 1) {
    current[0] = row;
    for (let column = 1; column < columnCount; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[actual.length];
}

/**
 * 日常学习模式会给接近正确的拼写部分分。
 * 字符差异按 2 倍计入，既不会让少一个字母等同于整词错误，
 * 也不会让拼写错误几乎不扣分。
 */
function calculateSubstitutionPenalty(expected: string, actual: string): number {
  const denominator = Math.max(expected.length, actual.length);
  if (denominator === 0) {
    return 0;
  }
  return Math.min(1, (calculateCharacterDistance(expected, actual) / denominator) * 2);
}

const ALIGNMENT_EPSILON = 1e-9;

/**
 * 先保证单词编辑距离最小，再优先选择拼写更接近的对齐。
 * 如果两条路径仍完全同分，则把较短的一侧靠左对齐，避免反向回溯把孤立错词漂到句尾。
 */
function getAlignmentTiePriority(
  kind: DictationOperationKind,
  row: number,
  column: number
): number {
  if (kind === "match") {
    return 0;
  }
  if (row > column) {
    return kind === "deletion" ? 1 : kind === "substitution" ? 2 : 3;
  }
  if (column > row) {
    return kind === "insertion" ? 1 : kind === "substitution" ? 2 : 3;
  }
  return kind === "substitution" ? 1 : kind === "deletion" ? 2 : 3;
}

function chooseAlignmentCandidate(
  candidates: AlignmentCandidate[],
  row: number,
  column: number
): AlignmentCandidate {
  return candidates.reduce((best, candidate) => {
    if (candidate.distance !== best.distance) {
      return candidate.distance < best.distance ? candidate : best;
    }
    const weightedDifference = candidate.weightedDistance - best.weightedDistance;
    if (Math.abs(weightedDifference) > ALIGNMENT_EPSILON) {
      return weightedDifference < 0 ? candidate : best;
    }
    return getAlignmentTiePriority(candidate.kind, row, column) <
      getAlignmentTiePriority(best.kind, row, column)
      ? candidate
      : best;
  });
}

/**
 * 听写采用学习友好模式：忽略大小写、普通标点、弯引号和多余空格。
 * 撇号会被移除而不是切开单词，因此 don't 和 dont 会被视为相同答案。
 */
export function tokenizeDictationText(text: string): string[] {
  return tokenizeDictationEntries(text).map((token) => token.normalized);
}

/**
 * 使用单词级 Levenshtein 对齐，同时返回 UI 可直接渲染的逐词差异。
 */
export function compareDictation(reference: string, answer: string): DictationResult {
  const expectedEntries = tokenizeDictationEntries(reference);
  const actualEntries = tokenizeDictationEntries(answer);
  const expectedTokens = expectedEntries.map((token) => token.normalized);
  const actualTokens = actualEntries.map((token) => token.normalized);
  const rowCount = expectedTokens.length + 1;
  const columnCount = actualTokens.length + 1;
  const matrix = Array.from({ length: rowCount }, () =>
    Array<number>(columnCount).fill(0)
  );
  const weightedMatrix = Array.from({ length: rowCount }, () =>
    Array<number>(columnCount).fill(0)
  );
  const traceMatrix = Array.from({ length: rowCount }, () =>
    Array<DictationOperationKind | null>(columnCount).fill(null)
  );

  for (let row = 1; row < rowCount; row += 1) {
    matrix[row][0] = row;
    weightedMatrix[row][0] = row;
    traceMatrix[row][0] = "deletion";
  }
  for (let column = 1; column < columnCount; column += 1) {
    matrix[0][column] = column;
    weightedMatrix[0][column] = column;
    traceMatrix[0][column] = "insertion";
  }

  for (let row = 1; row < rowCount; row += 1) {
    for (let column = 1; column < columnCount; column += 1) {
      const isMatch = expectedTokens[row - 1] === actualTokens[column - 1];
      const substitutionPenalty = isMatch
        ? 0
        : calculateSubstitutionPenalty(expectedTokens[row - 1], actualTokens[column - 1]);
      const best = chooseAlignmentCandidate([
        {
          kind: "deletion",
          distance: matrix[row - 1][column] + 1,
          weightedDistance: weightedMatrix[row - 1][column] + 1
        },
        {
          kind: "insertion",
          distance: matrix[row][column - 1] + 1,
          weightedDistance: weightedMatrix[row][column - 1] + 1
        },
        {
          kind: isMatch ? "match" : "substitution",
          distance: matrix[row - 1][column - 1] + (isMatch ? 0 : 1),
          weightedDistance: weightedMatrix[row - 1][column - 1] + substitutionPenalty
        }
      ], row, column);
      matrix[row][column] = best.distance;
      weightedMatrix[row][column] = best.weightedDistance;
      traceMatrix[row][column] = best.kind;
    }
  }

  const operations: DictationOperation[] = [];
  let row = expectedTokens.length;
  let column = actualTokens.length;
  while (row > 0 || column > 0) {
    const step = traceMatrix[row][column];
    if (step === "match" || step === "substitution") {
      operations.push({
        kind: step,
        expected: expectedEntries[row - 1].display,
        actual: actualEntries[column - 1].display
      });
      row -= 1;
      column -= 1;
      continue;
    }
    if (step === "deletion") {
      operations.push({
        kind: "deletion",
        expected: expectedEntries[row - 1].display,
        actual: null
      });
      row -= 1;
      continue;
    }
    if (step === "insertion") {
      operations.push({
        kind: "insertion",
        expected: null,
        actual: actualEntries[column - 1].display
      });
      column -= 1;
      continue;
    }
    throw new Error("Unable to reconstruct dictation alignment");
  }

  operations.reverse();
  const distance = matrix[expectedTokens.length][actualTokens.length];
  const weightedDistance = weightedMatrix[expectedTokens.length][actualTokens.length];
  const denominator = Math.max(expectedTokens.length, actualTokens.length);
  const score = denominator === 0
    ? 100
    : Math.max(0, Math.round((1 - weightedDistance / denominator) * 100));

  return {
    score,
    distance,
    expectedTokens,
    actualTokens,
    operations
  };
}
