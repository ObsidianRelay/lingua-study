import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const CLEANUP_MARKER = "whisper-cache-removed-v110";
const MANAGED_MODELS = [
  "distil-whisper/distil-large-v3",
  "Xenova/whisper-base.en",
  "Xenova/whisper-small.en"
] as const;

function getLinguaCacheRoot(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "Lingua Study");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local"), "Lingua Study", "Cache");
  }
  return join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache"), "lingua-study");
}

export function isManagedLegacyWhisperUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "huggingface.co") {
    return false;
  }
  return MANAGED_MODELS.some((model) => parsed.pathname.startsWith(`/${model}/resolve/`));
}

export async function removeLegacyWhisperCachesOnce(): Promise<boolean> {
  const cacheRoot = getLinguaCacheRoot();
  const markerPath = join(cacheRoot, CLEANUP_MARKER);
  try {
    await readFile(markerPath, "utf8");
    return false;
  } catch {
    // 没有标记时才执行一次精确清理。
  }

  const browserCaches = window.caches;
  if (!browserCaches) {
    throw new Error("当前 Obsidian 环境无法读取旧模型缓存，下次启动会继续尝试。");
  }
  for (const cacheName of await browserCaches.keys()) {
    const cache = await browserCaches.open(cacheName);
    for (const request of await cache.keys()) {
      if (isManagedLegacyWhisperUrl(request.url)) {
        await cache.delete(request);
      }
    }
  }

  await rm(join(cacheRoot, "Whisper"), { recursive: true, force: true });
  await rm(join(cacheRoot, "whisper"), { recursive: true, force: true });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(markerPath, "Lingua Study 1.1.0\n", { encoding: "utf8", mode: 0o600 });
  return true;
}
