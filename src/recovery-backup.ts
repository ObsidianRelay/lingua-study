import { App } from "obsidian";

/** 同一份原文只备份一次；重试写入冲突时复用已有备份。 */
export async function ensureRecoveryBackup(
  app: App,
  path: string,
  raw: string,
  quarantineContent?: string
): Promise<void> {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const prefix = path.replace(/\.json$/u, ".recovery-");
  const existing = await app.vault.adapter.list(folder);
  for (const backupPath of existing.files) {
    if (!backupPath.startsWith(prefix) || !backupPath.endsWith(".backup.json")) continue;
    if (await app.vault.adapter.read(backupPath) !== raw) continue;
    if (quarantineContent !== undefined) {
      const quarantinePath = backupPath.replace(/\.backup\.json$/u, ".quarantine.json");
      if (!(await app.vault.adapter.exists(quarantinePath))) {
        await app.vault.create(quarantinePath, quarantineContent);
      }
    }
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const base = `${prefix}${stamp}${suffix ? `-${suffix}` : ""}`;
    const backupPath = `${base}.backup.json`;
    const quarantinePath = `${base}.quarantine.json`;
    if (await app.vault.adapter.exists(backupPath) ||
        await app.vault.adapter.exists(quarantinePath) ||
        app.vault.getAbstractFileByPath(backupPath) !== null ||
        app.vault.getAbstractFileByPath(quarantinePath) !== null) continue;
    await app.vault.create(backupPath, raw);
    if (quarantineContent !== undefined) {
      await app.vault.create(quarantinePath, quarantineContent);
    }
    return;
  }
  throw new Error(`无法为损坏的数据创建恢复备份，已停止写入：${path}`);
}
