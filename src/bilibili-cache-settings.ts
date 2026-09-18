import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getDefaultBilibiliCacheFolder } from "./bilibili-cache-core";
import {
  DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS,
  getBilibiliCacheDeviceSettingsFile,
  isPathInsideOrEqual,
  parseBilibiliCacheDeviceSettings,
  validateBilibiliCachePathSyntax,
  type BilibiliCacheDeviceSettings
} from "./bilibili-cache-settings-core";

interface ElectronDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronDialogLike {
  showOpenDialog: (options: Record<string, unknown>) => Promise<ElectronDialogResult>;
}

interface ElectronRemoteLike {
  dialog?: ElectronDialogLike;
}

export interface BilibiliCacheDeviceSettingsServiceOptions {
  vaultRoot: string;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

function loadDesktopDialog(): ElectronDialogLike | null {
  try {
    const electron = require("electron") as { remote?: ElectronRemoteLike };
    if (electron.remote?.dialog) {
      return electron.remote.dialog;
    }
  } catch {
    // 继续尝试 Obsidian 桌面端内置的 @electron/remote。
  }
  try {
    const remote = require("@electron/remote") as ElectronRemoteLike;
    return remote.dialog ?? null;
  } catch {
    return null;
  }
}

async function resolveCanonicalCandidate(path: string): Promise<string> {
  let current = resolve(path);
  const missingParts: string[] = [];
  while (true) {
    try {
      const canonicalParent = await realpath(current);
      return resolve(canonicalParent, ...missingParts);
    } catch (error) {
      const code = error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : null;
      if (code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      missingParts.unshift(basename(current));
      current = parent;
    }
  }
}

export class BilibiliCacheDeviceSettingsService {
  readonly defaultCacheFolder: string;
  readonly settingsFile: string;
  private readonly platform: NodeJS.Platform;
  private readonly vaultRoot: string;

  constructor(options: BilibiliCacheDeviceSettingsServiceOptions) {
    this.platform = options.platform ?? process.platform;
    const homeDirectory = options.homeDirectory ?? homedir();
    const environment = options.environment ?? process.env;
    this.vaultRoot = options.vaultRoot;
    this.defaultCacheFolder = getDefaultBilibiliCacheFolder(
      this.platform,
      homeDirectory,
      environment
    );
    this.settingsFile = getBilibiliCacheDeviceSettingsFile(
      this.platform,
      homeDirectory,
      environment
    );
  }

  async load(): Promise<BilibiliCacheDeviceSettings> {
    try {
      return parseBilibiliCacheDeviceSettings(
        JSON.parse(await readFile(this.settingsFile, "utf8")) as unknown
      );
    } catch {
      return { ...DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS };
    }
  }

  async chooseFolder(defaultPath?: string): Promise<string | null> {
    const dialog = loadDesktopDialog();
    if (!dialog) {
      throw new Error("当前 Obsidian 无法打开系统文件夹选择器。");
    }
    const result = await dialog.showOpenDialog({
      title: "选择 B站视频缓存目录",
      ...(defaultPath ? { defaultPath } : {}),
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async saveCustomFolder(folder: string): Promise<string> {
    const canonicalFolder = await this.validateFolder(folder);
    await this.writeSettings({ version: 1, bilibiliCacheFolder: canonicalFolder });
    return canonicalFolder;
  }

  async restoreDefault(): Promise<void> {
    await this.writeSettings({ ...DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS });
  }

  private async validateFolder(folder: string): Promise<string> {
    const syntaxError = validateBilibiliCachePathSyntax(folder, this.vaultRoot, this.platform);
    if (syntaxError) {
      throw new Error(syntaxError);
    }
    const [canonicalFolder, canonicalVault] = await Promise.all([
      resolveCanonicalCandidate(folder),
      realpath(this.vaultRoot).catch(() => resolve(this.vaultRoot))
    ]);
    if (isPathInsideOrEqual(canonicalFolder, canonicalVault, this.platform)) {
      throw new Error("不能把 B站视频缓存放在 Obsidian 仓库内部，请选择仓库外的目录。");
    }
    try {
      await mkdir(canonicalFolder, { recursive: true });
      const info = await stat(canonicalFolder);
      if (!info.isDirectory()) {
        throw new Error("选择的路径不是文件夹。");
      }
      const probePath = join(canonicalFolder, `.lingua-study-write-${randomBytes(8).toString("hex")}.tmp`);
      const handle = await open(probePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.close();
      await rm(probePath, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      throw new Error(`选择的缓存目录无法写入：${message}`);
    }
    return canonicalFolder;
  }

  private async writeSettings(settings: BilibiliCacheDeviceSettings): Promise<void> {
    const parent = dirname(this.settingsFile);
    await mkdir(parent, { recursive: true });
    const temporary = `${this.settingsFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporary, this.settingsFile);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
