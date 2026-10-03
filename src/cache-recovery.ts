import { App } from "obsidian";
import { ensureRecoveryBackup } from "./recovery-backup";

/** 先保留完整原文件和无法识别的条目，再允许缓存写回。 */
export async function backupDamagedCache(
  app: App,
  path: string,
  raw: string,
  invalidEntries?: Record<string, unknown>
): Promise<void> {
  await ensureRecoveryBackup(app, path, raw,
    invalidEntries ? `${JSON.stringify({ invalidEntries }, null, 2)}\n` : undefined);
}

/** 外层损坏时备份整份原文，再从空缓存继续；条目损坏时仅隔离坏条目。 */
export async function recoverCacheForWrite<T>(
  app: App,
  path: string,
  raw: string,
  recover: (value: unknown) => { cache: T; invalidEntries: Record<string, unknown> },
  createEmpty: () => T
): Promise<T> {
  let result: { cache: T; invalidEntries: Record<string, unknown> };
  try {
    result = recover(JSON.parse(raw) as unknown);
  } catch {
    await backupDamagedCache(app, path, raw);
    return createEmpty();
  }
  if (Object.keys(result.invalidEntries).length > 0) {
    await backupDamagedCache(app, path, raw, result.invalidEntries);
  }
  return result.cache;
}
