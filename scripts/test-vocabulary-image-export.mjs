import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import esbuild from "esbuild";

const execFileAsync = promisify(execFile);
const candidates = process.platform === "darwin"
  ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ]
  : process.platform === "win32"
    ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ]
    : ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];

const chrome = process.env.CHROME_BIN?.trim() || candidates[0];
const temporaryRoot = await mkdtemp(join(tmpdir(), "lingua-study-image-export-"));
const entryPath = join(temporaryRoot, "entry.ts");
const bundlePath = join(temporaryRoot, "bundle.js");
const fixturePath = join(temporaryRoot, "fixture.html");
const rendererPath = resolve("src/vocabulary-image-export.ts");

try {
  const entrySource = `
    import { renderVocabularyBookImages } from ${JSON.stringify(rendererPath)};
    const makeEntry = (index) => ({
      id: "word-" + index,
      word: "word " + index,
      normalizedWord: "word-" + index,
      phonetic: "wɜːd",
      partOfSpeech: "n.",
      chineseTranslation: "这是用于真实浏览器长图分页检查的中文释义。".repeat(10),
      englishDefinition: "A deliberately long English definition used to verify wrapping and card pagination. ".repeat(15),
      examTags: ["cet4"],
      studyProfiles: ["cet4"],
      personalNote: index === 0 ? "特殊字符 < > & 应作为普通文本安全绘制" : "",
      contexts: [{
        sentence: "This is a complete video context sentence for vocabulary image export. ".repeat(8),
        sourcePath: "视频学习/长图测试.md",
        transcriptPath: "Lingua Study/Transcripts/test.json",
        videoId: "test",
        segmentIndex: index,
        start: index,
        end: index + 1,
        studyProfile: "cet4",
        addedAt: new Date(1_800_000_000_000 - index * 1_000).toISOString()
      }],
      createdAt: new Date(1_700_000_000_000).toISOString(),
      lastSeenAt: new Date(1_800_000_000_000 - index * 1_000).toISOString(),
      review: {
        phase: "new",
        introducedAt: null,
        dueAt: new Date(1_800_000_000_000).toISOString(),
        intervalDays: 0,
        reviewCount: 0,
        lapses: 0,
        lastReviewedAt: null
      }
    });
    const entries = Array.from({ length: 8 }, (_value, index) => makeEntry(index));
    const book = { version: 1, entries: Object.fromEntries(entries.map((entry) => [entry.id, entry])) };
    (async () => {
      try {
        const encodeCanvas = async (canvas) => {
          const dataUrl = canvas.toDataURL("image/png");
          const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          canvas.width = 1;
          canvas.height = 1;
          return bytes.buffer;
        };
        const pages = await renderVocabularyBookImages(
          book,
          new Date("2026-09-01T01:02:03.000Z"),
          document,
          encodeCanvas
        );
        if (pages.length < 2) throw new Error("长内容没有自动分页");
        for (const [index, page] of pages.entries()) {
          const bytes = new Uint8Array(page);
          if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
            throw new Error("第 " + (index + 1) + " 页不是有效 PNG");
          }
          const dimensions = new DataView(page);
          const width = dimensions.getUint32(16);
          const height = dimensions.getUint32(20);
          if (width !== 1080) throw new Error("长图宽度不是 1080px");
          if (height <= 0 || height > 12000) throw new Error("长图高度超出安全范围");
        }
        document.body.dataset.imagePages = String(pages.length);
        document.body.dataset.imageTest = "pass";
      } catch (error) {
        document.body.dataset.imageTest = "fail";
        document.body.dataset.imageMessage = error instanceof Error ? error.message : String(error);
      }
    })();
  `;
  await writeFile(entryPath, entrySource, "utf8");
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome120",
    outfile: bundlePath,
    logLevel: "silent"
  });
  const bundle = (await readFile(bundlePath, "utf8")).replaceAll("</script>", "<\\/script>");
  await writeFile(
    fixturePath,
    `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${bundle}</script></body></html>`,
    "utf8"
  );
  const { stdout, stderr } = await execFileAsync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    `--user-data-dir=${join(temporaryRoot, "chrome-profile")}`,
    "--virtual-time-budget=20000",
    "--window-size=1200,900",
    "--dump-dom",
    pathToFileURL(fixturePath).href
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
  if (!stdout.includes('data-image-test="pass"')) {
    const message = stdout.match(/data-image-message="([^"]*)"/u)?.[1] ?? stderr.trim();
    throw new Error(`真实 Chrome 长图生成检查失败：${message || "页面没有返回测试结果"}`);
  }
  const pageCount = Number(stdout.match(/data-image-pages="([^"]*)"/u)?.[1]);
  if (!Number.isSafeInteger(pageCount) || pageCount < 2) {
    throw new Error("真实 Chrome 长图生成检查失败：没有得到有效分页数量");
  }
  console.log(`真实 Chrome 长图生成检查通过：生成 ${pageCount} 张 1080px PNG。`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
