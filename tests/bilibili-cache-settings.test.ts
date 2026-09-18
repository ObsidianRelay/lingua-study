import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BilibiliCacheDeviceSettingsService } from "../src/bilibili-cache-settings";

test("自定义路径仅保存到本机设置，恢复默认不删除缓存", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-cache-settings-"));
  try {
    const vault = join(root, "Vault");
    const custom = join(root, "中文 缓存");
    const home = join(root, "Home");
    await Promise.all([mkdir(vault), mkdir(custom), mkdir(home)]);
    const marker = join(custom, "keep.mp4");
    await writeFile(marker, "video", "utf8");
    const service = new BilibiliCacheDeviceSettingsService({
      vaultRoot: vault,
      platform: "darwin",
      homeDirectory: home,
      environment: {}
    });

    assert.equal((await service.load()).bilibiliCacheFolder, null);
    const saved = await service.saveCustomFolder(custom);
    const canonicalCustom = await realpath(custom);
    assert.equal(saved, canonicalCustom);
    assert.equal((await service.load()).bilibiliCacheFolder, canonicalCustom);
    assert.match(await readFile(service.settingsFile, "utf8"), /bilibiliCacheFolder/u);

    await service.restoreDefault();
    assert.equal((await service.load()).bilibiliCacheFolder, null);
    assert.equal(await readFile(marker, "utf8"), "video");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("拒绝仓库内部目录和不可写的文件路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-cache-validation-"));
  try {
    const vault = join(root, "Vault");
    const home = join(root, "Home");
    const filePath = join(root, "not-a-folder");
    await Promise.all([mkdir(vault), mkdir(home), writeFile(filePath, "x", "utf8")]);
    const service = new BilibiliCacheDeviceSettingsService({
      vaultRoot: vault,
      platform: "darwin",
      homeDirectory: home,
      environment: {}
    });
    await assert.rejects(service.saveCustomFolder(join(vault, "Cache")), /Obsidian 仓库/u);
    await assert.rejects(service.saveCustomFolder(filePath), /无法写入/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("损坏的本机设置文件自动回到默认", async () => {
  const root = await mkdtemp(join(tmpdir(), "lingua-cache-corrupt-"));
  try {
    const vault = join(root, "Vault");
    const home = join(root, "Home");
    await Promise.all([mkdir(vault), mkdir(home)]);
    const service = new BilibiliCacheDeviceSettingsService({
      vaultRoot: vault,
      platform: "darwin",
      homeDirectory: home,
      environment: {}
    });
    await mkdir(join(home, "Library", "Application Support", "Lingua Study"), {
      recursive: true
    });
    await writeFile(service.settingsFile, "{broken", "utf8");
    assert.equal((await service.load()).bilibiliCacheFolder, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
