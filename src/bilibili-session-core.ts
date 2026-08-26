export const BILIBILI_SESSION_PARTITION = "persist:lingua-study-bilibili";

export interface BilibiliLoginWindowOpenResponse {
  action: "allow" | "deny";
  outlivesOpener?: boolean;
  overrideBrowserWindowOptions?: Record<string, unknown>;
}

export interface ElectronNavigationDetailsLike {
  url?: unknown;
  isMainFrame?: unknown;
}

export function isTrustedBilibiliPage(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/\.$/u, "");
    return url.protocol === "https:" && (host === "bilibili.com" || host.endsWith(".bilibili.com"));
  } catch {
    return false;
  }
}

export function isAllowedBilibiliLoginPopup(rawUrl: string): boolean {
  return rawUrl === "about:blank" || isTrustedBilibiliPage(rawUrl);
}

/**
 * Electron 近期版本把导航地址放在事件详情对象中，旧版本仍把地址作为第二个参数传入。
 * 同时兼容两种格式，避免升级 Electron 后误把正常的 B站页面判定为空地址。
 */
export function readElectronNavigation(
  details: ElectronNavigationDetailsLike | null | undefined,
  deprecatedUrl: unknown,
  deprecatedIsMainFrame: unknown
): { url: string; isMainFrame: boolean } {
  const url = typeof details?.url === "string"
    ? details.url
    : typeof deprecatedUrl === "string"
      ? deprecatedUrl
      : "";
  const isMainFrame = typeof details?.isMainFrame === "boolean"
    ? details.isMainFrame
    : typeof deprecatedIsMainFrame === "boolean"
      ? deprecatedIsMainFrame
      : true;
  return { url, isMainFrame };
}

/** 给插件自己创建的验证窗口重新套上隔离会话和 Electron 安全选项。 */
export function hardenBilibiliLoginWindowOptions(
  original: Record<string, unknown>,
  parent: unknown
): Record<string, unknown> {
  const originalPreferences = original.webPreferences;
  const webPreferences = originalPreferences && typeof originalPreferences === "object"
    ? originalPreferences as Record<string, unknown>
    : {};
  return {
    ...original,
    title: "Lingua Study — B站安全验证",
    width: typeof original.width === "number" ? original.width : 960,
    height: typeof original.height === "number" ? original.height : 720,
    minWidth: 640,
    minHeight: 520,
    parent,
    show: true,
    webPreferences: {
      ...webPreferences,
      partition: BILIBILI_SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  };
}

/** 验证子窗口只能访问 B站，并强制与主登录窗口共用同一个隔离会话。 */
export function buildBilibiliLoginWindowOpenResponse(
  rawUrl: string,
  parent: unknown
): BilibiliLoginWindowOpenResponse {
  if (!isAllowedBilibiliLoginPopup(rawUrl)) {
    return { action: "deny" };
  }
  return {
    action: "allow",
    outlivesOpener: false,
    overrideBrowserWindowOptions: {
      title: "Lingua Study — B站安全验证",
      width: 960,
      height: 720,
      minWidth: 640,
      minHeight: 520,
      parent,
      show: true,
      webPreferences: {
        partition: BILIBILI_SESSION_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    }
  };
}
