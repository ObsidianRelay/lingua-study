import { join, posix, win32 } from "node:path";

export interface BilibiliCacheDeviceSettings {
  version: 1;
  bilibiliCacheFolder: string | null;
}

export const DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS: BilibiliCacheDeviceSettings = {
  version: 1,
  bilibiliCacheFolder: null
};

export function getBilibiliCacheDeviceSettingsFile(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Lingua Study", "device-settings.json");
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    return join(
      localAppData && localAppData !== "" ? localAppData : join(homeDirectory, "AppData", "Local"),
      "Lingua Study",
      "device-settings.json"
    );
  }
  const xdgConfigHome = environment.XDG_CONFIG_HOME?.trim();
  return join(
    xdgConfigHome && xdgConfigHome !== "" ? xdgConfigHome : join(homeDirectory, ".config"),
    "lingua-study",
    "device-settings.json"
  );
}

export function parseBilibiliCacheDeviceSettings(
  value: unknown
): BilibiliCacheDeviceSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return { ...DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS };
  }
  const folder = record.bilibiliCacheFolder;
  if (folder === null) {
    return { version: 1, bilibiliCacheFolder: null };
  }
  if (typeof folder !== "string" || folder.trim() === "") {
    return { ...DEFAULT_BILIBILI_CACHE_DEVICE_SETTINGS };
  }
  return { version: 1, bilibiliCacheFolder: folder.trim() };
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

export function isWindowsNetworkPath(value: string): boolean {
  return /^(?:\\\\|\/\/)/u.test(value.trim());
}

export function isPathInsideOrEqual(
  candidate: string,
  root: string,
  platform: NodeJS.Platform
): boolean {
  const api = pathApi(platform);
  const normalize = (value: string): string => {
    const resolved = api.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const normalizedCandidate = normalize(candidate);
  const normalizedRoot = normalize(root);
  const relative = api.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith(`..${api.sep}`) && relative !== ".." && !api.isAbsolute(relative));
}

export function validateBilibiliCachePathSyntax(
  candidate: string,
  vaultRoot: string,
  platform: NodeJS.Platform
): string | null {
  const value = candidate.trim();
  const api = pathApi(platform);
  if (value === "" || !api.isAbsolute(value)) {
    return "请选择绝对路径作为 B站视频缓存目录。";
  }
  if (platform === "win32" && isWindowsNetworkPath(value)) {
    return "当前版本暂不支持 Windows 网络共享目录，请选择本地磁盘或移动磁盘。";
  }
  if (isPathInsideOrEqual(value, vaultRoot, platform)) {
    return "不能把 B站视频缓存放在 Obsidian 仓库内部，请选择仓库外的目录。";
  }
  return null;
}
