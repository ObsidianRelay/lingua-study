import { Platform } from "obsidian";
import {
  resolvePlatformCapabilities,
  type PlatformCapabilities
} from "./platform-core";

/** 只从 Obsidian 官方 Platform API 读取设备类型，不使用 process.platform。 */
export function getPlatformCapabilities(): PlatformCapabilities {
  return resolvePlatformCapabilities({
    isDesktopApp: Platform.isDesktopApp,
    isMobile: Platform.isMobile,
    isIosApp: Platform.isIosApp,
    isAndroidApp: Platform.isAndroidApp
  });
}

export type { PlatformCapabilities } from "./platform-core";
