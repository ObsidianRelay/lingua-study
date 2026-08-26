import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";
import { parseJson3Captions, parseSubtitleFile } from "./import-core";
import type { TranscriptSegment } from "./transcript-core";
import {
  buildYtDlpCandidates,
  mapYtDlpFailure,
  selectGeneratedSubtitleFile
} from "./yt-dlp-core";

const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_CHARS = 256 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;

interface ProcessResult {
  started: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type YtDlpTranscriptResult =
  | { status: "success"; segments: TranscriptSegment[] }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/**
 * 在电脑本机运行 yt-dlp。所有参数都以数组传给程序，不经过 shell，避免链接或路径被当成命令执行。
 */
function runProcess(executable: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setNodeTimeout> | null = null;
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (result: ProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearNodeTimeout(timer);
      }
      resolve(result);
    };
    const appendLimited = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(-MAX_PROCESS_OUTPUT_CHARS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", () => {
      finish({ started: false, exitCode: null, stdout, stderr, timedOut: false });
    });
    child.on("close", (exitCode) => {
      finish({ started: true, exitCode, stdout, stderr, timedOut: false });
    });

    timer = setNodeTimeout(() => {
      child.kill();
      finish({ started: true, exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
  });
}

async function findYtDlp(configuredPath: string): Promise<string | null> {
  for (const candidate of buildYtDlpCandidates(configuredPath, process.platform)) {
    const result = await runProcess(candidate, ["--version"], PROBE_TIMEOUT_MS);
    if (
      result.started &&
      result.exitCode === 0 &&
      `${result.stdout}${result.stderr}`.trim().length > 0
    ) {
      return candidate;
    }
  }
  return null;
}

function buildSubtitleArgs(
  outputTemplate: string,
  sourceUrl: string,
  automatic: boolean
): string[] {
  return [
    "--ignore-config",
    "--skip-download",
    "--no-playlist",
    "--no-overwrites",
    "--no-progress",
    automatic ? "--write-auto-subs" : "--write-subs",
    "--sub-langs",
    "en,en-US,en-GB,en-orig",
    "--sub-format",
    "json3/vtt/best",
    "--output",
    outputTemplate,
    sourceUrl
  ];
}

async function readGeneratedSubtitle(folder: string): Promise<TranscriptSegment[] | null> {
  const fileName = selectGeneratedSubtitleFile(await readdir(folder));
  if (!fileName) {
    return null;
  }
  const path = join(folder, fileName);
  if ((await stat(path)).size > MAX_SUBTITLE_BYTES) {
    throw new Error("yt-dlp 生成的字幕文件超过 10 兆字节，已停止读取。");
  }
  const text = await readFile(path, "utf8");
  return fileName.toLowerCase().endsWith(".json3")
    ? parseJson3Captions(text)
    : parseSubtitleFile(text);
}

/**
 * 先尝试人工英文字幕，再尝试英文自动字幕。临时字幕始终写入独立目录，并在结束后删除。
 */
export async function fetchTranscriptWithYtDlp(
  sourceUrl: string,
  configuredPath: string
): Promise<YtDlpTranscriptResult> {
  const executable = await findYtDlp(configuredPath);
  if (!executable) {
    return {
      status: "unavailable",
      message: "电脑上没有找到 yt-dlp。可在插件设置中填写 yt-dlp 程序路径。"
    };
  }

  const tempFolder = await mkdtemp(join(tmpdir(), "lingua-study-ytdlp-"));
  let combinedOutput = "";
  try {
    const outputTemplate = join(tempFolder, "%(id)s.%(ext)s");
    for (const automatic of [false, true]) {
      const result = await runProcess(
        executable,
        buildSubtitleArgs(outputTemplate, sourceUrl, automatic),
        DOWNLOAD_TIMEOUT_MS
      );
      combinedOutput += `\n${result.stdout}\n${result.stderr}`;
      if (result.timedOut) {
        return { status: "failed", message: "本机 yt-dlp 获取字幕超时，请稍后重试。" };
      }
      const segments = await readGeneratedSubtitle(tempFolder);
      if (segments) {
        return { status: "success", segments };
      }
    }

    return { status: "failed", message: mapYtDlpFailure(combinedOutput).message };
  } catch (error) {
    const message = error instanceof Error ? error.message : mapYtDlpFailure(combinedOutput).message;
    return { status: "failed", message };
  } finally {
    await rm(tempFolder, { recursive: true, force: true }).catch(() => undefined);
  }
}
