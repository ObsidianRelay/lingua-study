import assert from "node:assert/strict";
import test from "node:test";
import {
  BILIBILI_SESSION_PARTITION,
  buildBilibiliLoginWindowOpenResponse,
  hardenBilibiliLoginWindowOptions,
  isAllowedBilibiliLoginPopup,
  isTrustedBilibiliPage,
  readElectronNavigation
} from "../src/bilibili-session-core";

test("B站登录导航只信任官方 HTTPS 域名", () => {
  assert.equal(isTrustedBilibiliPage("https://passport.bilibili.com/login"), true);
  assert.equal(isTrustedBilibiliPage("https://www.bilibili.com/account"), true);
  assert.equal(isTrustedBilibiliPage("http://passport.bilibili.com/login"), false);
  assert.equal(isTrustedBilibiliPage("https://bilibili.com.example.com/login"), false);
  assert.equal(isTrustedBilibiliPage("https://example.com/?next=bilibili.com"), false);
});

test("账号验证码弹窗复用插件隔离会话且外部网页仍被拦截", () => {
  assert.equal(isAllowedBilibiliLoginPopup("about:blank"), true);
  const parent = { name: "login-window" };
  const allowed = buildBilibiliLoginWindowOpenResponse(
    "https://passport.bilibili.com/h5-app/passport/verify",
    parent
  );
  assert.equal(allowed.action, "allow");
  const preferences = (allowed.overrideBrowserWindowOptions?.webPreferences ?? {}) as Record<string, unknown>;
  assert.equal(preferences.partition, BILIBILI_SESSION_PARTITION);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(
    buildBilibiliLoginWindowOpenResponse("https://example.com/verify", parent).action,
    "deny"
  );
});

test("兼容 Electron 新旧导航事件且只把顶层页面视为受限导航", () => {
  assert.deepEqual(
    readElectronNavigation(
      { url: "https://passport.bilibili.com/login", isMainFrame: true },
      undefined,
      undefined
    ),
    { url: "https://passport.bilibili.com/login", isMainFrame: true }
  );
  assert.deepEqual(
    readElectronNavigation(undefined, "https://passport.bilibili.com/login", false),
    { url: "https://passport.bilibili.com/login", isMainFrame: false }
  );
});

test("插件自建验证窗口会覆盖不安全选项并保留 Electron 提供的 webContents", () => {
  const parent = { name: "login-window" };
  const existingWebContents = { name: "electron-created-web-contents" };
  const options = hardenBilibiliLoginWindowOptions({
    width: 800,
    webContents: existingWebContents,
    webPreferences: {
      partition: "persist:wrong",
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  }, parent);
  assert.equal(options.width, 800);
  assert.equal(options.parent, parent);
  assert.equal(options.webContents, existingWebContents);
  const preferences = options.webPreferences as Record<string, unknown>;
  assert.equal(preferences.partition, BILIBILI_SESSION_PARTITION);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
});
