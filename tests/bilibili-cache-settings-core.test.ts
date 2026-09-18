import assert from "node:assert/strict";
import test from "node:test";
import {
  getBilibiliCacheDeviceSettingsFile,
  isPathInsideOrEqual,
  parseBilibiliCacheDeviceSettings,
  validateBilibiliCachePathSyntax
} from "../src/bilibili-cache-settings-core";

test("设备设置文件使用系统本机目录", () => {
  assert.equal(
    getBilibiliCacheDeviceSettingsFile("darwin", "/Users/test", {}),
    "/Users/test/Library/Application Support/Lingua Study/device-settings.json"
  );
  assert.equal(
    getBilibiliCacheDeviceSettingsFile("win32", "C:\\Users\\test", {
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local"
    }),
    "C:\\Users\\test\\AppData\\Local/Lingua Study/device-settings.json"
  );
});

test("设置损坏、空路径或旧版本时恢复默认", () => {
  assert.deepEqual(parseBilibiliCacheDeviceSettings(null), {
    version: 1,
    bilibiliCacheFolder: null
  });
  assert.deepEqual(parseBilibiliCacheDeviceSettings({
    version: 1,
    bilibiliCacheFolder: "   "
  }), {
    version: 1,
    bilibiliCacheFolder: null
  });
  assert.deepEqual(parseBilibiliCacheDeviceSettings({
    version: 2,
    bilibiliCacheFolder: "/Volumes/Cache"
  }), {
    version: 1,
    bilibiliCacheFolder: null
  });
  assert.deepEqual(parseBilibiliCacheDeviceSettings({
    version: 1,
    bilibiliCacheFolder: " /Volumes/学习 缓存 "
  }), {
    version: 1,
    bilibiliCacheFolder: "/Volumes/学习 缓存"
  });
});

test("拒绝相对路径、仓库内部路径和 Windows 网络共享", () => {
  assert.match(
    validateBilibiliCachePathSyntax("cache", "/Users/test/Vault", "darwin") ?? "",
    /绝对路径/u
  );
  assert.match(
    validateBilibiliCachePathSyntax(
      "/Users/test/Vault/.cache/bilibili",
      "/Users/test/Vault",
      "darwin"
    ) ?? "",
    /Obsidian 仓库/u
  );
  assert.match(
    validateBilibiliCachePathSyntax(
      "\\\\server\\share\\Lingua",
      "C:\\Users\\test\\Vault",
      "win32"
    ) ?? "",
    /网络共享/u
  );
});

test("Mac 和 Windows 都能识别仓库边界与合法外部路径", () => {
  assert.equal(isPathInsideOrEqual("/Users/test/Vault", "/Users/test/Vault", "darwin"), true);
  assert.equal(isPathInsideOrEqual("/Users/test/Vault2", "/Users/test/Vault", "darwin"), false);
  assert.equal(
    isPathInsideOrEqual("c:\\users\\test\\vault\\cache", "C:\\Users\\test\\Vault", "win32"),
    true
  );
  assert.equal(
    validateBilibiliCachePathSyntax(
      "D:\\视频 缓存\\Bilibili",
      "C:\\Users\\test\\Vault",
      "win32"
    ),
    null
  );
});
