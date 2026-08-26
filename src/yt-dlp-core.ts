import type { YouTubeImportFailure } from "./import-core";

/**
 * 生成可尝试的 yt-dlp 程序位置。
 *
 * Obsidian 从桌面图标启动时通常拿不到终端的完整 PATH，所以 macOS 还要检查
 * Homebrew 和 MacPorts 的常见安装位置。用户手工填写的路径始终优先。
 */
export function buildYtDlpCandidates(
  configuredPath: string,
  platform: NodeJS.Platform
): string[] {
  const candidates = platform === "win32"
    ? [configuredPath.trim(), "yt-dlp.exe", "yt-dlp"]
    : [
        configuredPath.trim(),
        "yt-dlp",
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
        "/opt/local/bin/yt-dlp"
      ];

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
}

/** 把 yt-dlp 的英文错误转成用户可以理解、且不会泄露本机路径的中文原因。 */
export function mapYtDlpFailure(output: string): YouTubeImportFailure {
  const normalized = output.toLowerCase();

  if (
    normalized.includes("sign in to confirm") ||
    normalized.includes("not a bot") ||
    normalized.includes("login required") ||
    normalized.includes("requires authentication")
  ) {
    return {
      code: "login-required",
      message: "本机 yt-dlp 也被 YouTube 要求登录或进行反机器人验证。"
    };
  }
  if (
    normalized.includes("private video") ||
    normalized.includes("video unavailable") ||
    normalized.includes("members-only") ||
    normalized.includes("not available in your country")
  ) {
    return {
      code: "private-or-unavailable",
      message: "本机 yt-dlp 判断该视频不可用，可能是私密、会员或地区限制。"
    };
  }
  if (
    normalized.includes("there are no subtitles") ||
    normalized.includes("no subtitles") ||
    normalized.includes("requested subtitles are not available") ||
    normalized.includes("does not have subtitles")
  ) {
    return {
      code: "no-captions",
      message: "本机 yt-dlp 没有找到可下载的英文字幕。"
    };
  }
  if (normalized.includes("429") || normalized.includes("too many requests")) {
    return {
      code: "rate-limited",
      message: "本机 yt-dlp 的请求也被 YouTube 暂时限流，请稍后再试。"
    };
  }
  if (
    normalized.includes("timed out") ||
    normalized.includes("unable to download webpage") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("connection refused") ||
    normalized.includes("temporary failure in name resolution")
  ) {
    return {
      code: "network",
      message: "本机 yt-dlp 无法连接 YouTube，请检查网络后重试。"
    };
  }

  return {
    code: "invalid-response",
    message: "本机 yt-dlp 未能生成英文字幕。可以先更新 yt-dlp，再重新尝试。"
  };
}

/** 只接受 yt-dlp 在独立临时文件夹中生成的字幕格式。 */
export function selectGeneratedSubtitleFile(fileNames: string[]): string | null {
  const supported = fileNames.filter((name) => /\.(?:json3|vtt|srt)$/iu.test(name));
  return supported.find((name) => name.toLowerCase().endsWith(".json3"))
    ?? supported.find((name) => name.toLowerCase().endsWith(".vtt"))
    ?? supported.find((name) => name.toLowerCase().endsWith(".srt"))
    ?? null;
}
