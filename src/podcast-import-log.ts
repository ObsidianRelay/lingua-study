import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_LOG_BYTES = 512 * 1024;

function getLogFolder(platform: NodeJS.Platform, home: string): string {
  if (platform === "darwin") {
    return join(home, "Library", "Logs", "Lingua Study");
  }
  if (platform === "win32") {
    return join(process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "Lingua Study", "Logs");
  }
  return join(process.env.XDG_STATE_HOME?.trim() || join(home, ".local", "state"), "lingua-study");
}

function timestamp(): string {
  return new Date().toISOString();
}

function redactUrlQuery(value: string): string {
  return value.replace(/https?:\/\/[^\s)]+/gu, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}`;
    } catch {
      return raw;
    }
  });
}

/** 本机诊断日志：不记录 enclosure URL，避免写入短期签名媒体参数。 */
export class PodcastImportLog {
  readonly path: string;

  constructor(options: { folder?: string } = {}) {
    this.path = join(options.folder ?? getLogFolder(process.platform, homedir()), "podcast-import.log");
  }

  async write(stage: string, message: string): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const info = await stat(this.path).catch(() => null);
      if (info && info.size >= MAX_LOG_BYTES) {
        await rename(this.path, `${this.path}.previous`);
      }
      await appendFile(this.path, `${timestamp()} [podcast-import:${stage}] ${redactUrlQuery(message)}\n`, "utf8");
    } catch {
      // 诊断日志绝不能阻断正常导入。
    }
  }
}
