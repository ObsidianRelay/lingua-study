import { requestUrl } from "obsidian";
import {
  BilibiliApiError,
  hasBilibiliLoginCookie,
  parseBilibiliSubtitleBody,
  parseBilibiliSubtitleTracks,
  parseBilibiliVideoMetadata,
  selectBilibiliEnglishTrack,
  type BilibiliSubtitleErrorResult,
  type BilibiliSubtitleFailureKind,
  type BilibiliSubtitleResult,
  type BilibiliSubtitleSuccessResult,
  type BilibiliVideoIdentity
} from "./bilibili-api-core";
import {
  BILIBILI_SESSION_PARTITION,
  buildBilibiliLoginWindowOpenResponse,
  hardenBilibiliLoginWindowOptions,
  isAllowedBilibiliLoginPopup,
  readElectronNavigation
} from "./bilibili-session-core";

const BILIBILI_LOGIN_URL = "https://passport.bilibili.com/login";
const BILIBILI_API_ORIGIN = "https://api.bilibili.com";
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface ElectronCookie {
  name: string;
  value: string;
}

interface ElectronSessionLike {
  cookies: {
    get: (filter: { url?: string; domain?: string; name?: string }) => Promise<ElectronCookie[]>;
    remove: (url: string, name: string) => Promise<void>;
    on?: (event: "changed", listener: (...args: unknown[]) => void) => void;
    removeListener?: (event: "changed", listener: (...args: unknown[]) => void) => void;
  };
  clearStorageData: (options: { storages: string[] }) => Promise<void>;
}

interface ElectronWebContentsLike {
  session: ElectronSessionLike;
  setWindowOpenHandler: (handler: (details: { url: string }) => {
    action: "allow" | "deny";
    outlivesOpener?: boolean;
    overrideBrowserWindowOptions?: Record<string, unknown>;
    createWindow?: (options: Record<string, unknown>) => ElectronWebContentsLike;
  }) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface ElectronBrowserWindowLike {
  webContents: ElectronWebContentsLike;
  loadURL: (url: string) => Promise<void>;
  show: () => void;
  focus: () => void;
  close: () => void;
  isDestroyed: () => boolean;
  setMenuBarVisibility?: (visible: boolean) => void;
  once: (event: string, listener: (...args: unknown[]) => void) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface ElectronRemoteLike {
  BrowserWindow: new (options: Record<string, unknown>) => ElectronBrowserWindowLike;
  session: {
    fromPartition: (partition: string, options?: { cache: boolean }) => ElectronSessionLike;
  };
  getCurrentWindow?: () => unknown;
}

function loadElectronRemote(): ElectronRemoteLike | null {
  try {
    const electron = require("electron") as { remote?: ElectronRemoteLike };
    if (electron.remote?.BrowserWindow && electron.remote.session) {
      return electron.remote;
    }
  } catch {
    // 继续尝试 Obsidian 桌面端内置的 @electron/remote。
  }
  try {
    const remote = require("@electron/remote") as ElectronRemoteLike;
    return remote.BrowserWindow && remote.session ? remote : null;
  } catch {
    return null;
  }
}

function toFailure(error: unknown): { kind: BilibiliSubtitleFailureKind; message: string } {
  if (error instanceof BilibiliApiError) {
    return { kind: error.kind, message: error.message };
  }
  return {
    kind: "network",
    message: error instanceof Error ? error.message : "B站字幕读取失败，请稍后重试。"
  };
}

export interface BilibiliSessionStatus {
  supported: boolean;
  loggedIn: boolean;
}

/**
 * 使用 Obsidian/Electron 自己的独立会话登录 B站。
 * Cookie 由 Electron 持久化在应用数据目录，本类只在请求时临时拼接请求头。
 */
export class BilibiliSessionService {
  private readonly remote = loadElectronRemote();
  private loginWindow: ElectronBrowserWindowLike | null = null;
  private readonly loginAuxiliaryWindows = new Set<ElectronBrowserWindowLike>();
  private loginPromise: Promise<void> | null = null;

  async getStatus(): Promise<BilibiliSessionStatus> {
    return {
      supported: this.remote !== null,
      loggedIn: await this.hasLoginCookie()
    };
  }

  async requestTranscript(bvid: string, page: number): Promise<BilibiliSubtitleResult> {
    const anonymous = await this.extractTranscript(bvid, page, false);
    if (anonymous.status === "success" || anonymous.error.kind !== "login-required") {
      return anonymous;
    }
    if (!await this.hasLoginCookie()) {
      return anonymous;
    }
    return this.extractTranscript(bvid, page, true);
  }

  async loginAndRequestTranscript(bvid: string, page: number): Promise<BilibiliSubtitleResult> {
    await this.openLogin();
    return this.extractTranscript(bvid, page, true);
  }

  async openLogin(): Promise<void> {
    if (await this.hasLoginCookie()) {
      return;
    }
    if (this.loginPromise) {
      this.loginWindow?.show();
      this.loginWindow?.focus();
      return this.loginPromise;
    }
    if (!this.remote) {
      throw new Error("当前环境无法打开插件内登录窗口。此功能只支持 Obsidian 桌面版。");
    }
    const remote = this.remote;
    const isolatedSession = remote.session.fromPartition(BILIBILI_SESSION_PARTITION, { cache: true });

    this.loginPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let pollTimer: number | null = null;
      let cookieCheckInProgress = false;
      const cookieChanged = (...args: unknown[]): void => {
        const cookie = args[1] as ElectronCookie | undefined;
        const removed = args[3] === true;
        if (!removed && cookie?.name === "SESSDATA" && cookie.value.trim() !== "") {
          finish();
        }
      };
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
        }
        isolatedSession.cookies.removeListener?.("changed", cookieChanged);
        for (const auxiliary of this.loginAuxiliaryWindows) {
          if (!auxiliary.isDestroyed()) {
            auxiliary.close();
          }
        }
        this.loginAuxiliaryWindows.clear();
        const current = this.loginWindow;
        this.loginWindow = null;
        if (current && !current.isDestroyed()) {
          current.close();
        }
        error ? reject(error) : resolve();
      };
      const checkLoginCookie = (): void => {
        if (settled || cookieCheckInProgress) {
          return;
        }
        cookieCheckInProgress = true;
        void this.hasLoginCookie().then((loggedIn) => {
          if (loggedIn) {
            finish();
          }
        }).catch(() => {
          // Cookie 存储短暂不可用时保留登录窗口，由下一次导航或轮询继续检查。
        }).finally(() => {
          cookieCheckInProgress = false;
        });
      };
      const protectNavigation = (webContents: ElectronWebContentsLike): void => {
        webContents.on("will-navigate", (...args: unknown[]) => {
          const event = args[0] as ({
            preventDefault?: () => void;
            url?: unknown;
            isMainFrame?: unknown;
          } | undefined);
          const navigation = readElectronNavigation(event, args[1], args[3]);
          // 极验等安全验证会在跨域 iframe 内工作。这里只限制顶层页面，
          // 否则会误伤验证码并触发 B站退回系统浏览器的备用流程。
          if (navigation.isMainFrame && !isAllowedBilibiliLoginPopup(navigation.url)) {
            event?.preventDefault?.();
          }
        });
        webContents.on("did-navigate", checkLoginCookie);
        webContents.on("did-navigate-in-page", checkLoginCookie);
      };
      const loginWindow = new remote.BrowserWindow({
        title: "Lingua Study — 登录 B站",
        width: 1080,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        show: false,
        parent: remote.getCurrentWindow?.(),
        webPreferences: {
          partition: BILIBILI_SESSION_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });
      this.loginWindow = loginWindow;
      loginWindow.setMenuBarVisibility?.(false);
      type WindowOpenResponse = {
        action: "allow" | "deny";
        outlivesOpener?: boolean;
        overrideBrowserWindowOptions?: Record<string, unknown>;
        createWindow?: (options: Record<string, unknown>) => ElectronWebContentsLike;
      };
      let handleWindowOpen: (details: { url: string }) => WindowOpenResponse;
      const registerAuxiliaryWindow = (...args: unknown[]): void => {
        const auxiliary = args[0] as ElectronBrowserWindowLike | undefined;
        if (!auxiliary?.webContents || this.loginAuxiliaryWindows.has(auxiliary)) {
          return;
        }
        this.loginAuxiliaryWindows.add(auxiliary);
        auxiliary.setMenuBarVisibility?.(false);
        auxiliary.webContents.setWindowOpenHandler(handleWindowOpen);
        protectNavigation(auxiliary.webContents);
        auxiliary.webContents.on("did-create-window", registerAuxiliaryWindow);
        auxiliary.on("closed", () => {
          this.loginAuxiliaryWindows.delete(auxiliary);
          checkLoginCookie();
        });
        auxiliary.show();
      };
      handleWindowOpen = (details: { url: string }): WindowOpenResponse => {
        const response = buildBilibiliLoginWindowOpenResponse(details.url, loginWindow);
        if (response.action === "deny") {
          return response;
        }
        return {
          ...response,
          // 不再把窗口创建交给 Obsidian 的全局外链处理器。插件直接创建验证窗口，
          // 并返回它的 webContents，确保密码登录、短信验证和最终 Cookie 始终在同一分区。
          createWindow: (options: Record<string, unknown>): ElectronWebContentsLike => {
            const auxiliary = new remote.BrowserWindow(
              hardenBilibiliLoginWindowOptions(options, loginWindow)
            );
            registerAuxiliaryWindow(auxiliary);
            return auxiliary.webContents;
          }
        };
      };
      loginWindow.webContents.setWindowOpenHandler(handleWindowOpen);
      protectNavigation(loginWindow.webContents);
      loginWindow.webContents.on("did-create-window", registerAuxiliaryWindow);
      isolatedSession.cookies.on?.("changed", cookieChanged);
      loginWindow.once("ready-to-show", () => loginWindow.show());
      loginWindow.on("closed", () => {
        this.loginWindow = null;
        if (!settled) {
          finish(new Error("已关闭 B站登录窗口，本次字幕导入未继续。"));
        }
      });
      void loginWindow.loadURL(BILIBILI_LOGIN_URL).catch(() => {
        finish(new Error("无法打开 B站登录页面，请检查网络后重试。"));
      });
      pollTimer = window.setInterval(() => {
        checkLoginCookie();
      }, 1_000);
    }).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async clearLogin(): Promise<void> {
    const session = this.getSession();
    const cookies = await session.cookies.get({ domain: ".bilibili.com" });
    for (const cookie of cookies) {
      await session.cookies.remove("https://www.bilibili.com", cookie.name);
    }
    await session.clearStorageData({
      storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"]
    });
  }

  close(): void {
    for (const auxiliary of this.loginAuxiliaryWindows) {
      if (!auxiliary.isDestroyed()) {
        auxiliary.close();
      }
    }
    this.loginAuxiliaryWindows.clear();
    const current = this.loginWindow;
    this.loginWindow = null;
    if (current && !current.isDestroyed()) {
      current.close();
    }
  }

  private async extractTranscript(
    bvid: string,
    page: number,
    authenticated: boolean
  ): Promise<BilibiliSubtitleSuccessResult | BilibiliSubtitleErrorResult> {
    let video: BilibiliVideoIdentity | null = null;
    try {
      video = parseBilibiliVideoMetadata(
        await this.fetchJson(
          `${BILIBILI_API_ORIGIN}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          authenticated
        ),
        bvid,
        page
      );
      const availability = await this.loadTracks(video, authenticated);
      const selected = selectBilibiliEnglishTrack(availability.tracks);
      if (!selected) {
        if (availability.loginRequired) {
          throw new BilibiliApiError(
            "login-required",
            authenticated
              ? "B站仍未向当前账号提供该视频字幕，请确认账号已正常登录后重试。"
              : "该视频的字幕需要登录 B站后才能获取。"
          );
        }
        if (availability.tracks.length > 0) {
          throw new BilibiliApiError(
            "no-english",
            "该视频有独立字幕轨，但没有英文字幕。Lingua Study 不会把其他语言静默翻译成英文。"
          );
        }
        throw new BilibiliApiError(
          "no-tracks",
          "该视频没有独立字幕轨；画面中的字幕可能已经烧录进视频像素。"
        );
      }
      const segments = parseBilibiliSubtitleBody(await this.fetchJson(selected.url, authenticated));
      return {
        status: "success",
        video,
        subtitle: {
          language: selected.language,
          label: selected.label,
          automatic: selected.automatic,
          segments
        }
      };
    } catch (error) {
      const failure = toFailure(error);
      return {
        status: "error",
        video: { bvid: video?.bvid ?? bvid, page: video?.page ?? page },
        error: failure
      };
    }
  }

  private async loadTracks(
    video: BilibiliVideoIdentity,
    authenticated: boolean
  ): Promise<ReturnType<typeof parseBilibiliSubtitleTracks>> {
    const query = `bvid=${encodeURIComponent(video.bvid)}&cid=${video.cid}`;
    try {
      const primary = parseBilibiliSubtitleTracks(await this.fetchJson(
        `${BILIBILI_API_ORIGIN}/x/player/wbi/v2?${query}`,
        authenticated
      ));
      if (primary.tracks.length > 0 || primary.loginRequired) {
        return primary;
      }
    } catch (error) {
      if (error instanceof BilibiliApiError &&
        (error.kind === "rate-limited" || error.kind === "login-required")) {
        throw error;
      }
    }
    return parseBilibiliSubtitleTracks(await this.fetchJson(
      `${BILIBILI_API_ORIGIN}/x/player/v2?${query}`,
      authenticated
    ));
  }

  private async fetchJson(url: string, authenticated: boolean): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Referer: "https://www.bilibili.com/",
      "User-Agent": BROWSER_USER_AGENT
    };
    if (authenticated) {
      const cookie = await this.getCookieHeader(url);
      const requestHost = new URL(url).hostname.toLowerCase();
      if (cookie === "" && (requestHost === "bilibili.com" || requestHost.endsWith(".bilibili.com"))) {
        throw new BilibiliApiError("login-required", "B站登录状态已失效，请重新登录后重试。");
      }
      if (cookie !== "") {
        headers.Cookie = cookie;
      }
    }
    let response;
    try {
      response = await requestUrl({ url, method: "GET", headers, throw: false });
    } catch {
      throw new BilibiliApiError("network", "无法连接 B站，请检查网络后重试。");
    }
    if (response.status === 401 || response.status === 403) {
      throw new BilibiliApiError("login-required", "B站要求登录后才能读取该视频字幕。");
    }
    if (response.status === 412 || response.status === 429) {
      throw new BilibiliApiError("rate-limited", "B站暂时限制了字幕请求，请稍后重试。");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new BilibiliApiError("network", `B站接口请求失败（HTTP ${response.status}）。`);
    }
    if (response.arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new BilibiliApiError("invalid-response", "B站返回的数据超过 10 MB 限制。");
    }
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      throw new BilibiliApiError("invalid-response", "B站返回的数据不是有效 JSON。");
    }
  }

  private getSession(): ElectronSessionLike {
    if (!this.remote) {
      throw new Error("当前环境无法访问 Obsidian 的独立 B站登录会话。");
    }
    return this.remote.session.fromPartition(BILIBILI_SESSION_PARTITION, { cache: true });
  }

  private async hasLoginCookie(): Promise<boolean> {
    if (!this.remote) {
      return false;
    }
    // 这里只按名称查询当前隔离分区，避免部分 Electron 版本无法同时匹配
    // `.bilibili.com` 域 Cookie 与 `www.bilibili.com` URL 的问题。
    const cookies = await this.getSession().cookies.get({ name: "SESSDATA" });
    return hasBilibiliLoginCookie(cookies);
  }

  private async getCookieHeader(url: string): Promise<string> {
    const cookies = await this.getSession().cookies.get({ url });
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
}
