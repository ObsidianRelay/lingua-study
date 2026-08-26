const STUDY_FENCE_OPEN_PATTERN = /^\s*```(?:lingua-study|english-video-study)\s*$/u;
const FENCE_CLOSE_PATTERN = /^\s*```\s*$/u;

export interface StudyBlockCursorRecovery {
  closingLine: number;
  exitLine: number;
  needsTrailingLine: boolean;
}

function findStudyBlockContainingLine(
  lines: readonly string[],
  targetLine: number
): { openingLine: number; closingLine: number } | null {
  for (let openingLine = 0; openingLine < lines.length; openingLine += 1) {
    if (!STUDY_FENCE_OPEN_PATTERN.test(lines[openingLine] ?? "")) {
      continue;
    }

    for (let closingLine = openingLine + 1; closingLine < lines.length; closingLine += 1) {
      if (!FENCE_CLOSE_PATTERN.test(lines[closingLine] ?? "")) {
        continue;
      }
      if (targetLine >= openingLine && targetLine <= closingLine) {
        return { openingLine, closingLine };
      }
      openingLine = closingLine;
      break;
    }
  }
  return null;
}

/**
 * 只识别已经闭合的 Lingua Study 围栏代码块，避免普通或尚未写完的代码块
 * 触发 Live Preview 的播放器恢复逻辑。
 */
export function containsStudyBlock(lines: readonly string[]): boolean {
  for (let openingLine = 0; openingLine < lines.length; openingLine += 1) {
    if (!STUDY_FENCE_OPEN_PATTERN.test(lines[openingLine] ?? "")) {
      continue;
    }

    let closingLine = -1;
    for (let line = openingLine + 1; line < lines.length; line += 1) {
      if (FENCE_CLOSE_PATTERN.test(lines[line] ?? "")) {
        closingLine = line;
        break;
      }
    }
    if (closingLine < 0) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Live Preview 会把光标所在的围栏代码块显示为源码。返回一个代码块外的安全行；
 * 如果代码块正好结束在文件末尾，调用方需要先补一个换行来创建该行。
 */
export function getStudyBlockCursorRecovery(
  lines: readonly string[],
  cursorLine: number
): StudyBlockCursorRecovery | null {
  const range = findStudyBlockContainingLine(lines, cursorLine);
  if (!range) {
    return null;
  }
  return {
    closingLine: range.closingLine,
    exitLine: range.closingLine + 1,
    needsTrailingLine: range.closingLine === lines.length - 1
  };
}

/** 为新插入的学习代码块保留一个代码块外的编辑器行。 */
export function addStudyBlockExitLine(block: string): string {
  return block.endsWith("\n") ? block : `${block}\n`;
}
