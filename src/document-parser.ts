import * as mammoth from "mammoth";
import {
  getDocument,
  GlobalWorkerOptions
} from "pdfjs-dist/legacy/build/pdf.mjs";
import PDF_WORKER_SOURCE from "virtual:pdf-worker";

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
let pdfWorkerUrl: string | null = null;

function preparePdfWorker(): void {
  if (pdfWorkerUrl === null) {
    pdfWorkerUrl = URL.createObjectURL(new Blob([PDF_WORKER_SOURCE], {
      type: "text/javascript"
    }));
  }
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export function disposeDocumentParserRuntime(): void {
  if (pdfWorkerUrl !== null) {
    URL.revokeObjectURL(pdfWorkerUrl);
    pdfWorkerUrl = null;
  }
  GlobalWorkerOptions.workerSrc = "";
}

interface PdfTextItemLike {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
}

function normalizedExtension(name: string): string {
  return name.toLocaleLowerCase("en-US").split(".").at(-1) ?? "";
}

function assertFileSize(file: File, extension: string): void {
  const limit = extension === "txt" || extension === "md" ? MAX_TEXT_BYTES : MAX_DOCUMENT_BYTES;
  if (file.size > limit) {
    throw new Error(
      extension === "txt" || extension === "md"
        ? "TXT/MD 文件不能超过 5 MB。"
        : "PDF/DOCX 文件不能超过 20 MB。"
    );
  }
}

function htmlToStructuredText(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const lines: string[] = [];
  for (const node of Array.from(document.body.children)) {
    if (node.tagName === "TABLE") {
      for (const row of Array.from(node.querySelectorAll(":scope > tbody > tr, :scope > tr"))) {
        const cells = Array.from(row.querySelectorAll(":scope > td, :scope > th"))
          .map((cell) => cell.textContent?.replace(/\s+/gu, " ").trim() ?? "")
          .filter(Boolean);
        if (cells.length > 0) {
          lines.push(cells.join("\t"));
        }
      }
      continue;
    }
    const text = node.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    if (text !== "") {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const text = htmlToStructuredText(result.value);
    if (text.trim() === "") {
      throw new Error("Word 文档中没有可读取的文字。");
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes("没有可读取")) {
      throw error;
    }
    throw new Error("无法读取 DOCX 文件，请确认文件没有损坏或加密。", { cause: error });
  }
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  let task;
  try {
    preparePdfWorker();
    task = getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false
    });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items.flatMap((raw): Array<{
        text: string;
        x: number;
        y: number;
        width: number;
      }> => {
        const item = raw as PdfTextItemLike;
        if (typeof item.str !== "string" || !Array.isArray(item.transform)) {
          return [];
        }
        const x = Number(item.transform[4]);
        const y = Number(item.transform[5]);
        const width = typeof item.width === "number" ? item.width : 0;
        return Number.isFinite(x) && Number.isFinite(y)
          ? [{ text: item.str.trim(), x, y, width }]
          : [];
      }).filter((item) => item.text !== "");
      positioned.sort((left, right) => Math.abs(left.y - right.y) > 2
        ? right.y - left.y
        : left.x - right.x);
      const rows: Array<typeof positioned> = [];
      for (const item of positioned) {
        const row = rows.find((candidate) => Math.abs((candidate[0]?.y ?? item.y) - item.y) <= 2);
        if (row) {
          row.push(item);
        } else {
          rows.push([item]);
        }
      }
      const pageLines = rows.map((row) => {
        row.sort((left, right) => left.x - right.x);
        let line = "";
        let previousEnd: number | null = null;
        for (const item of row) {
          if (previousEnd !== null) {
            const gap = item.x - previousEnd;
            line += gap > 55 ? "\t" : " ";
          }
          line += item.text;
          previousEnd = item.x + item.width;
        }
        return line.replace(/ +/gu, " ").trim();
      }).filter(Boolean);
      pages.push(pageLines.join("\n"));
    }
    const text = pages.join("\n").trim();
    if (text === "") {
      throw new Error("PDF 没有可复制的文字层；扫描图片型 PDF 请先使用 OCR 转成文字。");
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes("文字层")) {
      throw error;
    }
    throw new Error("无法读取 PDF，请确认文件没有损坏、加密，并且包含可复制的文字。", {
      cause: error
    });
  } finally {
    await task?.destroy();
  }
}

export async function extractImportedDocument(file: File): Promise<string> {
  const extension = normalizedExtension(file.name);
  if (!new Set(["pdf", "docx", "txt", "md"]).has(extension)) {
    throw new Error("只支持 PDF、DOCX、TXT 或 MD 文稿。");
  }
  assertFileSize(file, extension);
  if (extension === "txt" || extension === "md") {
    const text = (await file.text()).replace(/^\uFEFF/u, "").trim();
    if (text === "") {
      throw new Error("文本文件是空的。");
    }
    return text;
  }
  const buffer = await file.arrayBuffer();
  return extension === "pdf" ? extractPdf(buffer) : extractDocx(buffer);
}
