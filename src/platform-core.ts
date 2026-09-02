export interface PlatformSnapshot {
  isDesktopApp: boolean;
  isMobile: boolean;
  isIosApp: boolean;
  isAndroidApp: boolean;
}

export interface PlatformCapabilities {
  desktop: boolean;
  mobile: boolean;
  ios: boolean;
  android: boolean;
  ytDlp: boolean;
  bilibiliLogin: boolean;
  bilibiliVideoCache: boolean;
  localWhisper: boolean;
  fullDictionary: boolean;
  systemFolderAccess: boolean;
}

/**
 * 把 Obsidian 的平台标记收敛成插件能力。
 *
 * 移动端第一阶段只禁用依赖 Node.js/Electron 的功能，
 * 字幕阅读、在线请求、翻译、生词本和内置词典仍由共享代码提供。
 */
export function resolvePlatformCapabilities(
  platform: PlatformSnapshot
): PlatformCapabilities {
  const desktop = platform.isDesktopApp && !platform.isMobile;
  return {
    desktop,
    mobile: platform.isMobile,
    ios: platform.isIosApp,
    android: platform.isAndroidApp,
    ytDlp: desktop,
    bilibiliLogin: desktop,
    bilibiliVideoCache: desktop,
    localWhisper: desktop,
    fullDictionary: desktop,
    systemFolderAccess: desktop
  };
}
