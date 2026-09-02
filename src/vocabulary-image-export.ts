import type { VocabularyBookFile } from "./vocabulary-core";
import {
  VOCABULARY_IMAGE_MAX_HEIGHT,
  VOCABULARY_IMAGE_WIDTH,
  buildVocabularyImageCards,
  paginateMeasuredVocabularyImageCards,
  type VocabularyImageBlock,
  type VocabularyImageCard
} from "./vocabulary-image-export-core";

const PAGE_PADDING = 54;
const PAGE_BOTTOM_PADDING = 54;
const HEADER_HEIGHT = 142;
const HEADER_GAP = 28;
const CARD_GAP = 24;
const CARD_WIDTH = VOCABULARY_IMAGE_WIDTH - PAGE_PADDING * 2;
const CARD_AVAILABLE_HEIGHT = VOCABULARY_IMAGE_MAX_HEIGHT
  - PAGE_PADDING
  - HEADER_HEIGHT
  - HEADER_GAP
  - PAGE_BOTTOM_PADDING;
const MAX_BLOCK_TEXT_LENGTH = 2_000;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif';
const FONT_PAGE_TITLE = `800 44px ${FONT_FAMILY}`;
const FONT_PAGE_META = `400 23px ${FONT_FAMILY}`;
const FONT_PAGE_NUMBER = `700 24px ${FONT_FAMILY}`;
const FONT_WORD = `800 34px ${FONT_FAMILY}`;
const FONT_BODY = `400 26px ${FONT_FAMILY}`;
const FONT_BODY_BOLD = `750 26px ${FONT_FAMILY}`;
const FONT_SECTION = `800 27px ${FONT_FAMILY}`;

interface VocabularyImageDrawCommand {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
}

interface VocabularyImageCardLayout {
  card: VocabularyImageCard;
  continued: boolean;
  height: number;
  titleHeight: number;
  commands: VocabularyImageDrawCommand[];
}

export type VocabularyImageCanvasEncoder = (canvas: HTMLCanvasElement) => Promise<ArrayBuffer>;

function splitLongText(value: string): string[] {
  const characters = Array.from(value);
  if (characters.length <= MAX_BLOCK_TEXT_LENGTH) {
    return [value];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(characters.length, start + MAX_BLOCK_TEXT_LENGTH);
    if (end < characters.length) {
      const lowerBound = Math.max(start + Math.floor(MAX_BLOCK_TEXT_LENGTH * 0.7), start + 1);
      for (let cursor = end; cursor >= lowerBound; cursor -= 1) {
        if (/\s/u.test(characters[cursor - 1] ?? "")) {
          end = cursor;
          break;
        }
      }
    }
    const chunk = characters.slice(start, end).join("").trim();
    if (chunk !== "") {
      chunks.push(chunk);
    }
    start = end;
  }
  return chunks;
}

function expandLongBlocks(blocks: readonly VocabularyImageBlock[]): VocabularyImageBlock[] {
  const expanded: VocabularyImageBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "section") {
      expanded.push(block);
      continue;
    }
    if (block.kind === "field") {
      splitLongText(block.value).forEach((value, index) => {
        expanded.push({
          kind: "field",
          label: index === 0 ? block.label : `${block.label}（续）`,
          value
        });
      });
      continue;
    }
    const sentenceChunks = splitLongText(block.sentence);
    sentenceChunks.forEach((sentence) => {
      expanded.push({
        kind: "context",
        index: block.index,
        sentence
      });
    });
  }
  return expanded;
}

function textWidth(context: CanvasRenderingContext2D, text: string, font: string): number {
  context.font = font;
  return context.measureText(text).width;
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number
): string[] {
  let characters = Array.from(text.trim());
  const lines: string[] = [];
  context.font = font;
  while (characters.length > 0) {
    while (characters.length > 0 && /\s/u.test(characters[0] ?? "")) {
      characters.shift();
    }
    if (characters.length === 0) {
      break;
    }
    const remainder = characters.join("");
    if (context.measureText(remainder).width <= maxWidth) {
      lines.push(remainder);
      break;
    }
    let low = 1;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = characters.slice(0, middle).join("");
      if (context.measureText(candidate).width <= maxWidth) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    let take = Math.max(1, low);
    const whitespaceFloor = Math.max(1, Math.floor(take * 0.65));
    for (let cursor = take; cursor >= whitespaceFloor; cursor -= 1) {
      if (/\s/u.test(characters[cursor - 1] ?? "")) {
        take = cursor;
        break;
      }
    }
    lines.push(characters.slice(0, take).join("").trimEnd());
    characters = characters.slice(take);
  }
  return lines.length > 0 ? lines : [""];
}

function addCommand(
  commands: VocabularyImageDrawCommand[],
  text: string,
  x: number,
  y: number,
  font: string,
  color = "#172126"
): void {
  commands.push({ text, x, y, font, color });
}

function layoutCard(
  context: CanvasRenderingContext2D,
  card: VocabularyImageCard,
  continued: boolean
): VocabularyImageCardLayout {
  const titleText = continued ? `${card.word}（续）` : card.word;
  const titleLines = wrapText(context, titleText, FONT_WORD, CARD_WIDTH - 56);
  const titleLineHeight = 44;
  const titleHeight = 40 + titleLines.length * titleLineHeight;
  const commands: VocabularyImageDrawCommand[] = [];
  titleLines.forEach((line, index) => addCommand(
    commands,
    line,
    28,
    20 + index * titleLineHeight,
    FONT_WORD
  ));
  if (card.blocks.length === 0) {
    return { card, continued, height: titleHeight, titleHeight, commands };
  }

  const contentX = 30;
  const contentWidth = CARD_WIDTH - 60;
  let y = titleHeight + 22;
  for (const block of card.blocks) {
    if (block.kind === "field") {
      const label = `${block.label}：`;
      const labelWidth = textWidth(context, label, FONT_BODY_BOLD);
      const valueWidth = textWidth(context, block.value, FONT_BODY);
      if (labelWidth + valueWidth <= contentWidth) {
        addCommand(commands, label, contentX, y, FONT_BODY_BOLD);
        addCommand(commands, block.value, contentX + labelWidth, y, FONT_BODY);
        y += 39;
      } else {
        addCommand(commands, label, contentX, y, FONT_BODY_BOLD);
        y += 39;
        const lines = wrapText(context, block.value, FONT_BODY, contentWidth);
        for (const line of lines) {
          addCommand(commands, line, contentX, y, FONT_BODY);
          y += 39;
        }
      }
      y += 9;
      continue;
    }
    if (block.kind === "section") {
      y += 12;
      addCommand(commands, block.label, contentX, y, FONT_SECTION);
      y += 47;
      continue;
    }
    const indexWidth = 38;
    const sentenceLines = wrapText(context, block.sentence, FONT_BODY, contentWidth - indexWidth);
    addCommand(commands, `${block.index}.`, contentX, y, FONT_BODY_BOLD, "#438c97");
    sentenceLines.forEach((line, index) => {
      addCommand(commands, line, contentX + indexWidth, y + index * 39, FONT_BODY);
    });
    y += sentenceLines.length * 39;
    y += 17;
  }
  const height = Math.ceil(y + 18);
  return { card, continued, height, titleHeight, commands };
}

function splitAndLayoutCard(
  context: CanvasRenderingContext2D,
  original: VocabularyImageCard
): VocabularyImageCardLayout[] {
  const expanded: VocabularyImageCard = {
    ...original,
    blocks: expandLongBlocks(original.blocks)
  };
  const full = layoutCard(context, expanded, false);
  if (full.height <= CARD_AVAILABLE_HEIGHT) {
    return [full];
  }
  const slices: VocabularyImageCardLayout[] = [];
  let blocks: VocabularyImageBlock[] = [];
  for (const block of expanded.blocks) {
    const continued = slices.length > 0;
    const candidate = layoutCard(context, { ...expanded, blocks: [...blocks, block] }, continued);
    if (blocks.length > 0 && candidate.height > CARD_AVAILABLE_HEIGHT) {
      slices.push(layoutCard(context, { ...expanded, blocks }, continued));
      blocks = [block];
      const single = layoutCard(context, { ...expanded, blocks }, true);
      if (single.height > CARD_AVAILABLE_HEIGHT) {
        throw new Error(`单词“${original.word}”包含无法安全分页的超长内容。`);
      }
    } else {
      blocks.push(block);
    }
  }
  if (blocks.length > 0) {
    slices.push(layoutCard(context, { ...expanded, blocks }, slices.length > 0));
  }
  return slices;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawCard(
  context: CanvasRenderingContext2D,
  layout: VocabularyImageCardLayout,
  x: number,
  y: number
): void {
  context.save();
  context.shadowColor = "rgba(34, 82, 91, 0.09)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 5;
  roundedRectPath(context, x, y, CARD_WIDTH, layout.height, 18);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();

  context.save();
  roundedRectPath(context, x, y, CARD_WIDTH, layout.height, 18);
  context.clip();
  context.fillStyle = "#e7f8fa";
  context.fillRect(x, y, CARD_WIDTH, layout.titleHeight);
  context.restore();

  roundedRectPath(context, x, y, CARD_WIDTH, layout.height, 18);
  context.strokeStyle = "#c6e8ed";
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.moveTo(x, y + layout.titleHeight);
  context.lineTo(x + CARD_WIDTH, y + layout.titleHeight);
  context.strokeStyle = "#d8edf0";
  context.stroke();

  context.textBaseline = "top";
  for (const command of layout.commands) {
    context.font = command.font;
    context.fillStyle = command.color;
    context.fillText(command.text, x + command.x, y + command.y);
  }
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("生词本长图编码失败。"));
      }
    }, "image/png");
  });
  const output = await blob.arrayBuffer();
  // 大尺寸 Canvas 编码后立即释放像素缓冲，避免多页导出持续占用显存和内存。
  canvas.width = 1;
  canvas.height = 1;
  return output;
}

async function drawPage(
  document: Document,
  layouts: readonly VocabularyImageCardLayout[],
  wordCount: number,
  generatedAt: Date,
  pageIndex: number,
  pageCount: number,
  encodeCanvas: VocabularyImageCanvasEncoder
): Promise<ArrayBuffer> {
  const cardsHeight = layouts.reduce((sum, layout) => sum + layout.height, 0)
    + Math.max(0, layouts.length - 1) * CARD_GAP;
  const height = Math.ceil(Math.min(
    VOCABULARY_IMAGE_MAX_HEIGHT,
    PAGE_PADDING + HEADER_HEIGHT + HEADER_GAP + cardsHeight + PAGE_BOTTOM_PADDING
  ));
  const canvas = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas"
  ) as HTMLCanvasElement;
  canvas.width = VOCABULARY_IMAGE_WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境无法创建长图画布。");
  }
  context.fillStyle = "#f7fafb";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "top";
  context.fillStyle = "#172126";
  context.font = FONT_PAGE_TITLE;
  context.fillText("Lingua Study 生词本", PAGE_PADDING, PAGE_PADDING);
  context.fillStyle = "#657178";
  context.font = FONT_PAGE_META;
  context.fillText(
    `共 ${wordCount} 个生词 · 导出于 ${generatedAt.toLocaleString("zh-CN", { hour12: false })}`,
    PAGE_PADDING,
    PAGE_PADDING + 64
  );
  const pageLabel = `${pageIndex + 1} / ${pageCount}`;
  context.font = FONT_PAGE_NUMBER;
  context.fillStyle = "#438c97";
  context.fillText(
    pageLabel,
    VOCABULARY_IMAGE_WIDTH - PAGE_PADDING - context.measureText(pageLabel).width,
    PAGE_PADDING + 8
  );
  context.fillStyle = "#73d8e5";
  context.fillRect(PAGE_PADDING, PAGE_PADDING + HEADER_HEIGHT - 3, CARD_WIDTH, 3);

  let y = PAGE_PADDING + HEADER_HEIGHT + HEADER_GAP;
  for (const layout of layouts) {
    drawCard(context, layout, PAGE_PADDING, y);
    y += layout.height + CARD_GAP;
  }
  return encodeCanvas(canvas);
}

/** 使用 Canvas 直接绘制固定浅色 PNG，不读取当前 Obsidian 主题或外部资源。 */
export async function renderVocabularyBookImages(
  book: VocabularyBookFile,
  generatedAt: Date,
  document: Document = window.document,
  encodeCanvas: VocabularyImageCanvasEncoder = canvasToPng
): Promise<ArrayBuffer[]> {
  const cards = buildVocabularyImageCards(book);
  if (cards.length === 0) {
    throw new Error("生词本为空，暂时没有可以生成的长图。");
  }
  const measurementCanvas = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas"
  ) as HTMLCanvasElement;
  const measurementContext = measurementCanvas.getContext("2d");
  if (!measurementContext) {
    throw new Error("当前环境无法测量长图文字。");
  }
  const layouts = cards.flatMap((card) => splitAndLayoutCard(measurementContext, card));
  const pages = paginateMeasuredVocabularyImageCards(
    layouts.map((layout) => ({ value: layout, height: layout.height })),
    CARD_AVAILABLE_HEIGHT,
    CARD_GAP
  );
  const output: ArrayBuffer[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    output.push(await drawPage(
      document,
      pages[index],
      cards.length,
      generatedAt,
      index,
      pages.length,
      encodeCanvas
    ));
  }
  return output;
}
