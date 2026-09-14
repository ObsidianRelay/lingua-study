import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSettings } from "../src/settings-core";

test("升级时删除旧 Whisper 模型选项并保留其他设置", () => {
  const settings = sanitizeSettings({
    transcriptFolder: " Study/Transcripts ",
    ytDlpPath: " /opt/homebrew/bin/yt-dlp ",
    whisperModel: "small.en",
    translationProvider: "disabled",
    cacheTranslations: false
  });
  assert.equal("whisperModel" in settings, false);
  assert.equal(settings.transcriptFolder, "Study/Transcripts");
  assert.equal(settings.ytDlpPath, "/opt/homebrew/bin/yt-dlp");
  assert.equal(settings.autoImportPastedVideoLinks, false);
  assert.equal(settings.translateWholeTranscript, false);
  assert.equal(settings.cacheTranslations, false);
  assert.equal(settings.studyProfile, "cet4");
  assert.equal(settings.dailyNewWordLimit, 10);
  assert.equal(settings.fsrsRequestRetention, 0.9);
  assert.equal(settings.desktopPlayerWidth, 860);
  assert.equal(settings.interfaceTheme, "classic");
  assert.equal(settings.enableDoubleClickLookup, true);
  assert.equal(settings.enableSelectionTranslation, true);
  assert.equal("speechCloudBaseUrl" in settings, false);
  assert.equal("speechCloudModel" in settings, false);
  assert.equal("speechCloudSecretId" in settings, false);
});

test("双击查词开关兼容旧设置", () => {
  assert.equal(sanitizeSettings({ enableDoubleClickLookup: false }).enableDoubleClickLookup, false);
  assert.equal(sanitizeSettings({ enableDoubleClickLookup: "false" }).enableDoubleClickLookup, true);
});

test("划词翻译开关默认开启并保留用户选择", () => {
  assert.equal(sanitizeSettings({}).enableSelectionTranslation, true);
  assert.equal(
    sanitizeSettings({ enableSelectionTranslation: false }).enableSelectionTranslation,
    false
  );
  assert.equal(
    sanitizeSettings({ enableSelectionTranslation: "false" }).enableSelectionTranslation,
    true
  );
});

test("界面主题默认保留经典样式并只接受受支持的选项", () => {
  assert.equal(sanitizeSettings({}).interfaceTheme, "classic");
  assert.equal(sanitizeSettings({ interfaceTheme: "classic" }).interfaceTheme, "classic");
  assert.equal(sanitizeSettings({ interfaceTheme: "paper" }).interfaceTheme, "paper");
  assert.equal(sanitizeSettings({ interfaceTheme: "unknown" }).interfaceTheme, "classic");
});

test("整篇文稿翻译默认关闭并保留用户选择", () => {
  assert.equal(sanitizeSettings({}).translateWholeTranscript, false);
  assert.equal(
    sanitizeSettings({ translateWholeTranscript: true }).translateWholeTranscript,
    true
  );
  assert.equal(
    sanitizeSettings({ translateWholeTranscript: "true" }).translateWholeTranscript,
    false
  );
});

test("Kimi 使用独立模型与安全凭据并兼容旧设置", () => {
  const defaults = sanitizeSettings({ translationProvider: "kimi" });
  assert.equal(defaults.translationProvider, "kimi");
  assert.equal(defaults.kimiModel, "kimi-k2.6");
  assert.equal(defaults.kimiSecretId, "");

  const configured = sanitizeSettings({
    translationProvider: "kimi",
    kimiModel: "kimi-k2.6",
    kimiSecretId: "evs-kimi",
    deepSeekSecretId: "evs-deepseek"
  });
  assert.equal(configured.kimiSecretId, "evs-kimi");
  assert.equal(configured.deepSeekSecretId, "evs-deepseek");
  assert.equal(sanitizeSettings({ kimiModel: "unknown" }).kimiModel, "kimi-k2.6");
});

test("百度翻译使用独立 AppID 与安全凭据并兼容旧设置", () => {
  const defaults = sanitizeSettings({ translationProvider: "baidu" });
  assert.equal(defaults.translationProvider, "baidu");
  assert.equal(defaults.baiduAppId, "");
  assert.equal(defaults.baiduSecretId, "");

  const configured = sanitizeSettings({
    translationProvider: "baidu",
    baiduAppId: " 123456 ",
    baiduSecretId: "evs-baidu"
  });
  assert.equal(configured.baiduAppId, "123456");
  assert.equal(configured.baiduSecretId, "evs-baidu");
});

test("每日新词数量固定限制在 1 到 50", () => {
  assert.equal(sanitizeSettings({ dailyNewWordLimit: 20 }).dailyNewWordLimit, 20);
  assert.equal(sanitizeSettings({ dailyNewWordLimit: 0 }).dailyNewWordLimit, 1);
  assert.equal(sanitizeSettings({ dailyNewWordLimit: 200 }).dailyNewWordLimit, 50);
  assert.equal(sanitizeSettings({ dailyNewWordLimit: 9.6 }).dailyNewWordLimit, 10);
  assert.equal(sanitizeSettings({ dailyNewWordLimit: "20" }).dailyNewWordLimit, 10);
});

test("FSRS-6 目标留存率限制在 0.70 到 0.99", () => {
  assert.equal(sanitizeSettings({ fsrsRequestRetention: 0.86 }).fsrsRequestRetention, 0.86);
  assert.equal(sanitizeSettings({ fsrsRequestRetention: 0.2 }).fsrsRequestRetention, 0.7);
  assert.equal(sanitizeSettings({ fsrsRequestRetention: 2 }).fsrsRequestRetention, 0.99);
  assert.equal(sanitizeSettings({ fsrsRequestRetention: 0.904 }).fsrsRequestRetention, 0.9);
  assert.equal(sanitizeSettings({ fsrsRequestRetention: "0.95" }).fsrsRequestRetention, 0.9);
});

test("桌面播放器宽度保留用户选择并限制安全范围", () => {
  assert.equal(sanitizeSettings({}).desktopPlayerWidth, 860);
  assert.equal(sanitizeSettings({ desktopPlayerWidth: 720.4 }).desktopPlayerWidth, 720);
  assert.equal(sanitizeSettings({ desktopPlayerWidth: 200 }).desktopPlayerWidth, 480);
  assert.equal(sanitizeSettings({ desktopPlayerWidth: 1800 }).desktopPlayerWidth, 1200);
  assert.equal(sanitizeSettings({ desktopPlayerWidth: "720" }).desktopPlayerWidth, 860);
});

test("学习目标默认四级并保留全部八种备考选择", () => {
  assert.equal(sanitizeSettings({}).studyProfile, "cet4");
  for (const profile of ["zk", "gk", "cet4", "cet6", "tem4", "tem8", "ielts", "toefl"] as const) {
    assert.equal(sanitizeSettings({ studyProfile: profile }).studyProfile, profile);
  }
  assert.equal(sanitizeSettings({ studyProfile: "gre" }).studyProfile, "cet4");
});

test("粘贴自动导入默认关闭且会保留用户的明确选择", () => {
  assert.equal(sanitizeSettings({}).autoImportPastedVideoLinks, false);
  assert.equal(
    sanitizeSettings({ autoImportPastedVideoLinks: false }).autoImportPastedVideoLinks,
    false
  );
  assert.equal(
    sanitizeSettings({ autoImportPastedVideoLinks: true }).autoImportPastedVideoLinks,
    true
  );
});
