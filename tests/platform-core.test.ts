import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlatformCapabilities } from "../src/platform-core";

test("电脑端保留全部本地能力", () => {
  const capabilities = resolvePlatformCapabilities({
    isDesktopApp: true,
    isMobile: false,
    isIosApp: false,
    isAndroidApp: false
  });
  assert.equal(capabilities.desktop, true);
  assert.equal(capabilities.mobile, false);
  assert.equal(capabilities.ytDlp, true);
  assert.equal(capabilities.bilibiliLogin, true);
  assert.equal(capabilities.bilibiliVideoCache, true);
  assert.equal(capabilities.localWhisper, true);
  assert.equal(capabilities.fullDictionary, true);
});

test("iPhone 和 iPad 禁用所有 Node.js/Electron 能力", () => {
  const capabilities = resolvePlatformCapabilities({
    isDesktopApp: false,
    isMobile: true,
    isIosApp: true,
    isAndroidApp: false
  });
  assert.equal(capabilities.mobile, true);
  assert.equal(capabilities.ios, true);
  assert.equal(capabilities.desktop, false);
  assert.equal(capabilities.ytDlp, false);
  assert.equal(capabilities.bilibiliLogin, false);
  assert.equal(capabilities.bilibiliVideoCache, false);
  assert.equal(capabilities.localWhisper, false);
  assert.equal(capabilities.fullDictionary, false);
});

test("Android 手机和平板即使在桌面模拟中也不加载本地能力", () => {
  const capabilities = resolvePlatformCapabilities({
    isDesktopApp: true,
    isMobile: true,
    isIosApp: false,
    isAndroidApp: true
  });
  assert.equal(capabilities.android, true);
  assert.equal(capabilities.desktop, false);
  assert.equal(capabilities.systemFolderAccess, false);
});
