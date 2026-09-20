import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("正式版保持桌面限定且移动端测试框架只按需加载电脑专用服务", async () => {
  const [manifestText, main, dictionary, youtubeImport, bilibiliSession, settings] = await Promise.all([
    readFile("manifest.json", "utf8"),
    readFile("src/main.ts", "utf8"),
    readFile("src/dictionary-core.ts", "utf8"),
    readFile("src/youtube-import.ts", "utf8"),
    readFile("src/bilibili-session.ts", "utf8"),
    readFile("src/settings.ts", "utf8")
  ]);
  const manifest = JSON.parse(manifestText) as { isDesktopOnly?: unknown };
  assert.equal(manifest.isDesktopOnly, true);
  assert.match(main, /readonly capabilities: PlatformCapabilities = getPlatformCapabilities\(\)/u);
  assert.match(main, /if \(this\.capabilities\.desktop\) \{/u);
  assert.match(main, /rootClasses\.push\("evs-mobile"\)/u);
  assert.match(main, /await MarkdownRenderer\.render\(/u);
  assert.match(main, /!\[\]\(https:\/\/www\.youtube\.com\/watch\?v=/u);
  assert.match(main, /playerFrame\.replaceChildren\(nativeIframe\)/u);
  assert.match(main, /buildMobileYouTubeStartUrl\(this\.iframeEl\.src, seconds\)/u);
  assert.match(main, /移动端请使用视频内控件播放、暂停和调整倍速/u);
  assert.match(main, /Obsidian 移动端未能创建 YouTube 播放器/u);
  assert.doesNotMatch(main, /widget_referrer/u);
  for (const moduleName of [
    "full-dictionary",
    "bilibili-cache",
    "bilibili-cache-settings",
    "local-whisper",
    "podcast-cache",
    "podcast-import",
    "legacy-whisper-cleanup",
    "yt-dlp"
  ]) {
    assert.match(main, new RegExp(`import\\(\"\\./${moduleName}\"\\)`, "u"));
  }
  assert.doesNotMatch(dictionary, /from "node:|require\("node:/u);
  assert.doesNotMatch(youtubeImport, /from "\.\/yt-dlp"/u);
  assert.match(bilibiliSession, /Platform\.isDesktopApp \? loadElectronRemote\(\) : null/u);
  assert.match(settings, /visible: \(\) => this\.plugin\.capabilities\.ytDlp/u);
  assert.match(settings, /visible: \(\) => this\.plugin\.capabilities\.mobile/u);
  assert.match(settings, /name: mobile \? "B站视频与字幕" : "B站视频与登录"/u);
  assert.match(settings, /displayValue: mobile \? "在线播放 · 匿名字幕" : "匿名优先 · 需要时登录"/u);
  assert.match(settings, /移动端支持在线播放和匿名字幕；登录、缓存与自动对齐仅限电脑端/u);
  assert.match(settings, /移动端优先在线获取，失败时可导入 SRT\/VTT/u);
});

test("YouTube 独立移动端回退不打包固定 InnerTube key", async () => {
  const source = await readFile("src/youtube-import.ts", "utf8");
  assert.match(source, /requestKeylessMobilePlayer/u);
  assert.match(source, /youtubei\/v1\/player\?prettyPrint=false/u);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/u);
  assert.doesNotMatch(source, /YTRANSCRIPT_INNERTUBE_API_KEY/u);
});

test("Podcast RSS 命令创建桌面本地播放器与字幕学习块", async () => {
  const [main, importer] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/podcast-import.ts", "utf8")
  ]);
  assert.match(main, /id: "import-podcast-rss"/u);
  assert.match(main, /name: "从 podcast RSS 创建学习内容"/u);
  assert.match(main, /id: "import-podcast-rss"[\s\S]*?checkCallback:/u);
  assert.match(main, /if \(config\.kind === "podcast"\)/u);
  assert.match(main, /this\.renderPodcastPlayer\(cached, transcriptData\)/u);
  assert.match(importer, /selectEnglishPodcastTranscript/u);
  assert.match(importer, /this\.localWhisper\.transcribe/u);
  assert.match(importer, /extractPodcastSourceIdsFromStudyBlocks/u);
});

test("文稿行操作重绘后保留列表与弹窗滚动位置", async () => {
  const source = await readFile("src/document-transcript-import.ts", "utf8");
  assert.match(source, /const listScrollTop = previousList\?\.scrollTop \?\? this\.previewListScrollTop/u);
  assert.match(source, /const modalScrollTop = this\.contentEl\.scrollTop/u);
  assert.match(source, /list\.scrollTop = Math\.min\(listScrollTop/u);
  assert.match(source, /this\.contentEl\.scrollTop = Math\.min\(/u);
});

test("对齐结果使用统一总时间轴和逐句人工校准", async () => {
  const source = await readFile("src/document-transcript-import.ts", "utf8");
  const core = await readFile("src/document-transcript-core.ts", "utf8");
  const css = await readFile("styles.css", "utf8");
  assert.match(source, /text: "−0\.5 秒"/u);
  assert.match(source, /text: "\+0\.5 秒"/u);
  assert.match(source, /"设当前时间为开始"/u);
  assert.match(source, /"设当前时间为结束"/u);
  assert.match(source, /"校准此句"/u);
  assert.match(source, /"跳到下一条无效句"/u);
  assert.match(source, /commitManualTime/u);
  assert.match(source, /setCalibrationFeedback/u);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "nearest" \}\)/u);
  assert.match(source, /this\.previewTargetEnd = null/u);
  assert.match(source, /this\.getSegmentOffset\(nextIndex\)/u);
  assert.match(source, /findAlignmentTimingIssues/u);
  assert.match(source, /this\.applyAlignmentButton\.disabled = issueIndexes\.length > 0/u);
  assert.match(source, /lingua-study-alignment-time-input/u);
  assert.match(source, /type: "text"/u);
  assert.match(core, /formatAlignmentTime/u);
  assert.match(core, /validateAlignmentBoundary/u);
  assert.match(css, /\.lingua-study-alignment-seek/u);
  assert.match(css, /\.lingua-study-alignment-row\.is-active-calibration/u);
  assert.match(css, /\.lingua-study-alignment-time-input\.is-invalid/u);
  assert.match(css, /\.lingua-study-calibration-feedback\.is-error/u);
});

test("字幕导入会话保留草稿并避免同一视频重复启动", async () => {
  const modal = await readFile("src/document-transcript-import.ts", "utf8");
  const controller = await readFile("src/bilibili-import.ts", "utf8");
  const draft = await readFile("src/document-import-draft.ts", "utf8");
  assert.match(modal, /openOrFocus\(\)/u);
  assert.match(modal, /flushDraftSave\(\)/u);
  assert.match(modal, /this\.phase = "aligning"/u);
  assert.match(modal, /await this\.options\.clearDraft\(\)/u);
  assert.match(controller, /documentImportModals/u);
  assert.match(controller, /documentImportOpening/u);
  assert.match(draft, /document-import-drafts\.json/u);
  assert.match(draft, /phase === "aligning" \? "preview"/u);
});

test("设置首页固定使用卡片布局并提供可选界面主题", async () => {
  const source = await readFile("src/settings.ts", "utf8");
  const pageDefinitions = source.match(/type: "page"/gu) ?? [];
  assert.equal(pageDefinitions.length, 7);
  assert.match(source, /setting\.settingEl\.addClass\("lingua-study-settings-profile"\)/u);
  assert.match(source, /text: "LS"/u);
  assert.match(source, /已收录生词/u);
  assert.match(source, /heading: "学习与数据"[\s\S]*?items: \[this\.learningPage\(\), this\.translationPage\(\), this\.generalPage\(\)\]/u);
  assert.match(source, /heading: "内容导入"[\s\S]*?items: \[this\.youtubePage\(\), this\.bilibiliPage\(\), this\.documentAlignmentPage\(\)\]/u);
  assert.match(source, /heading: "外观"[\s\S]*?items: \[this\.appearancePage\(\)\]/u);
  assert.ok(source.indexOf('heading: "外观"') > source.indexOf('heading: "内容导入"'));
  assert.match(
    source,
    /private appearancePage\(\): SettingDefinitionPage \{[\s\S]*?name: "外观"[\s\S]*?desc: "切换 Lingua Study 插件外观。"[\s\S]*?heading: "选择主题"[\s\S]*?lingua-study-settings-page-appearance/u
  );
  assert.doesNotMatch(source, /切换逐句精听、词典和生词本的外观/u);
  assert.match(source, /render: \(setting\) => this\.renderInterfaceThemePicker\(setting\)/u);
  assert.match(source, /value: "classic",[\s\S]*?label: "经典主题"/u);
  assert.match(source, /value: "paper",[\s\S]*?label: "Lingua Paper"/u);
  assert.match(source, /cls: `lingua-study-settings-theme-preview is-\$\{theme\.value\}`/u);
  assert.match(source, /choice\.setAttribute\("aria-pressed", String\(selected\)\)/u);
  assert.match(source, /text: "✓ 已选择"/u);
  assert.match(source, /this\.plugin\.updateSettings\(\{ interfaceTheme: theme\.value \}\)/u);
  assert.match(source, /this\.plugin\.checkForAvailableUpdate\(\)/u);
  assert.match(source, /text: `发现新版本 v\$\{update\.latestVersion\}`/u);
  assert.match(source, /text: "前往更新"/u);
  assert.match(source, /window\.open\(update\.updatePageUrl, "_blank", "noopener,noreferrer"\)/u);
  assert.doesNotMatch(source, /community\.obsidian\.md\/plugins\/lingua-study/u);
  assert.doesNotMatch(source, /installPlugin|updatePlugin|\.obsidian\/plugins\/lingua-study/u);

  for (const pageName of [
    "YouTube 字幕",
    "学习与词典",
    "文稿导入与对齐",
    "翻译服务",
    "通用选项",
    "外观"
  ]) {
    assert.match(source, new RegExp(`name: "${pageName}"`, "u"));
  }

  for (const settingKey of [
    "transcriptFolder",
    "ytDlpPath",
    "studyProfile",
    "dailyNewWordLimit",
    "fsrsRequestRetention",
    "translationProvider",
    "translateWholeTranscript",
    "baiduAppId",
    "deepSeekModel",
    "kimiModel",
    "customBaseUrl",
    "customModel",
    "autoImportPastedVideoLinks",
    "enableDoubleClickLookup",
    "enableSelectionTranslation",
    "cacheTranslations"
  ]) {
    assert.match(source, new RegExp(`key: "${settingKey}"`, "u"));
  }

  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "deepseek"/u);
  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "baidu"/u);
  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "kimi"/u);
  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "openai-compatible"/u);
  assert.match(source, /kimi: "Kimi 官方（国内）"/u);
  assert.match(source, /baidu: "百度翻译 API"/u);
  assert.match(source, /this\.plugin\.settings\.baiduSecretId/u);
  assert.match(source, /this\.plugin\.settings\.kimiSecretId/u);
  assert.match(source, /Whisper Base English 模型/u);
  assert.match(source, /管理手动文稿的本地时间轴对齐/u);
  assert.match(source, /options: STUDY_PROFILE_LONG_LABELS/u);
  assert.match(source, /isStudyProfile\(value\)/u);
  assert.match(source, /refreshBilibiliStatusIndicators/u);
  assert.match(source, /name: "ECDICT 完整版"/u);
  assert.match(source, /text: "下载完整版"/u);
  assert.match(source, /"更新完整版"/u);
  assert.match(source, /FullDictionaryUpdateModal/u);
  assert.match(source, /检测到 ECDICT 完整词典有新版本/u);
  assert.match(source, /text: "立即更新"/u);
  assert.match(source, /text: "稍后再说"/u);
  assert.match(source, /current\.updateAvailable && !this\.dictionaryUpdatePromptHandled/u);
  assert.match(source, /installFullDictionary/u);
  assert.doesNotMatch(source, /从本地文件安装|installFullDictionaryFromLocalFile/u);
  assert.match(source, /name: "导入自定义词典（CSV \/ TSV \/ JSON）"/u);
  assert.match(source, /text: "选择词典文件"/u);
  assert.match(source, /text: "CSV 模板"/u);
  assert.match(source, /const tsvTemplateLabel = "TSV 模板"/u);
  assert.match(source, /text: "JSON 模板"/u);
  assert.match(source, /lingua-study-custom-dictionary-primary/u);
  assert.match(source, /lingua-study-custom-dictionary-templates/u);
  assert.match(source, /installCustomDictionaryFromFile/u);
  assert.match(source, /文件仅在本机处理/u);
  assert.match(source, /ClearCustomDictionaryModal/u);
  assert.match(source, /下载后离线使用/u);
  assert.match(source, /ClearFullDictionaryModal/u);
  assert.match(source, /文件保存在系统缓存，不参与 Obsidian Sync/u);
  assert.doesNotMatch(source, /从本地文件安装|installFullDictionaryFromLocalFile/u);
  assert.doesNotMatch(source, /this\.display\(\)/u);
});

test("B站账号验证码窗口复用隔离会话并立即监听登录 Cookie", async () => {
  const source = await readFile("src/bilibili-session.ts", "utf8");
  assert.match(source, /buildBilibiliLoginWindowOpenResponse\(details\.url, loginWindow\)/u);
  assert.match(source, /createWindow: \(options: Record<string, unknown>\)/u);
  assert.match(source, /hardenBilibiliLoginWindowOptions\(options, loginWindow\)/u);
  assert.match(source, /navigation\.isMainFrame && !isAllowedBilibiliLoginPopup/u);
  assert.match(source, /webContents\.on\("did-create-window", registerAuxiliaryWindow\)/u);
  assert.match(source, /isolatedSession\.cookies\.on\?\.\("changed", cookieChanged\)/u);
  assert.match(source, /removeListener\?\.\("changed", cookieChanged\)/u);
  assert.match(source, /webContents\.on\("did-navigate", checkLoginCookie\)/u);
  assert.doesNotMatch(source, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/u);
});

test("左侧 Logo 提供手动视频创建入口并保留可选自动化", async () => {
  const [source, settings, css] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/settings.ts", "utf8"),
    readFile("styles.css", "utf8")
  ]);
  assert.match(source, /addIcon\(LINGUA_STUDY_RIBBON_ICON_ID, LINGUA_STUDY_RIBBON_ICON_SVG\)/u);
  assert.match(source, /this\.addRibbonIcon\(/u);
  assert.match(source, /LINGUA_STUDY_RIBBON_ICON_ID,\s*"Lingua Study"/u);
  assert.match(source, /ribbonLogoMaskUrl/u);
  assert.match(source, /--lingua-study-logo-mask/u);
  assert.match(source, /findSupportedVideoLinksByPriority/u);
  assert.match(source, /import-video-from-current-note/u);
  assert.match(source, /setAttribute\("aria-label", "Lingua Study"\)/u);
  assert.doesNotMatch(source, /从当前笔记的视频链接创建语言学习内容/u);
  assert.match(settings, /开启后，粘贴单个完整的 B站或 YouTube 链接会自动导入/u);
  assert.match(settings, /key: "autoImportPastedVideoLinks"/u);
  assert.match(css, /\.side-dock-ribbon-action\.lingua-study-ribbon-action:hover/u);
  assert.match(css, /mask-image: var\(--lingua-study-logo-mask\)/u);
  assert.match(css, /\.lingua-study-manual-video-choice/u);
});

test("电脑端可选择本地 MP4 与同名字幕并在路径失效后重新关联", async () => {
  const [main, importer, cache] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/local-video-import.ts", "utf8"),
    readFile("src/bilibili-cache.ts", "utf8")
  ]);
  assert.match(main, /import\("\.\/local-video-import"\)/u);
  assert.match(main, /id: "import-local-video"/u);
  assert.doesNotMatch(main, /this\.addRibbonIcon\("file-video", "导入本地视频"/u);
  assert.match(main, /links\.length === 0[\s\S]*this\.openLocalVideoImport\(view\)/u);
  assert.match(main, /config\.kind === "local"/u);
  assert.match(main, /text: "重新选择视频"/u);
  assert.match(importer, /findMatchingLocalSubtitleNames/u);
  assert.match(importer, /properties: \["openDirectory"\]/u);
  assert.match(importer, /text: "批量生成学习资料"/u);
  assert.match(importer, /text: "生成学习资料"/u);
  assert.match(importer, /replaceLocalVideoPathInStudyBlock/u);
  assert.match(cache, /exposeExternalMp4/u);
});

test("B站视频缓存支持本机自定义路径与旧目录回退", async () => {
  const [main, settings, cache, deviceSettings, deviceSettingsCore] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/settings.ts", "utf8"),
    readFile("src/bilibili-cache.ts", "utf8"),
    readFile("src/bilibili-cache-settings.ts", "utf8"),
    readFile("src/bilibili-cache-settings-core.ts", "utf8")
  ]);
  assert.match(main, /fallbackFolders: this\.configuredBilibiliCacheFolder \? \[defaultCacheFolder\] : \[\]/u);
  assert.match(main, /chooseBilibiliCacheFolder/u);
  assert.match(main, /restoreDefaultBilibiliCacheFolder/u);
  assert.match(settings, /setButtonText\("选择缓存目录"\)/u);
  assert.match(settings, /setButtonText\("恢复默认路径"\)/u);
  assert.match(settings, /重新加载 Obsidian 后生效/u);
  assert.match(cache, /readCachedBilibiliFiles\(/u);
  assert.match(cache, /readCachedBilibiliFilesFromFolder\(this\.cacheFolder/u);
  assert.match(cache, /B站自定义缓存目录当前不可用/u);
  assert.match(deviceSettingsCore, /device-settings\.json/u);
  assert.doesNotMatch(deviceSettings, /saveData|loadData/u);
});

test("设置页样式统一导航卡片、状态和窄窗口布局", async () => {
  const css = await readFile("styles.css", "utf8");
  assert.match(css, /\.lingua-study-settings \.setting-item:has\(\.setting-item-chevron\)/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-section\) \.setting-page-title/u);
  assert.match(css, /font-family: var\(--font-interface\);/u);
  assert.match(css, /\.lingua-study-settings-status \{[\s\S]*?white-space: nowrap;/u);
  assert.match(css, /\.lingua-study-settings-section \.setting-item-description \{[\s\S]*?overflow-wrap: anywhere;/u);
  assert.match(css, /background: var\(--interactive-hover\);/u);
  assert.match(css, /\.lingua-study-settings-section \.setting-item-control \{[\s\S]*?flex-wrap: wrap;/u);
  assert.match(css, /\.setting-item-control\.lingua-study-custom-dictionary-controls \{[\s\S]*?flex-direction: column;/u);
  assert.match(css, /\.lingua-study-custom-dictionary-templates \{[\s\S]*?justify-content: flex-end;/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-section\)\) \[hidden\] \{[\s\S]*?display: none !important;/u);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?flex-direction: column;/u);
});

test("云端语音识别入口、配置和实现已完整移除", async () => {
  const files = await Promise.all([
    "src/settings-core.ts",
    "src/settings.ts",
    "src/document-transcript-import.ts",
    "src/bilibili-import.ts",
    "src/main.ts"
  ].map((path) => readFile(path, "utf8")));
  const source = files.join("\n");
  assert.doesNotMatch(source, /speechCloud|CloudSpeech|云端自动对齐|audio\/transcriptions/u);
});

test("Whisper Worker 构建时固定使用 Web ONNX 后端", async () => {
  const source = await readFile("src/whisper-worker.ts", "utf8");
  const build = await readFile("esbuild.config.mjs", "utf8");
  assert.match(source, /import \{ env, pipeline \} from "@huggingface\/transformers"/u);
  assert.match(
    source,
    /Object\.defineProperty\(self, "process", \{[\s\S]*?value: undefined,[\s\S]*?configurable: true/u
  );
  assert.doesNotMatch(source, /Symbol\.for\("onnxruntime"\)|loadTransformersWeb/u);
  assert.match(build, /entryPoints: \["src\/whisper-worker\.ts"\][\s\S]*?define: \{ process: "undefined" \}/u);
});

test("DOCX 运行时不再注入动态脚本或执行字符串代码", async () => {
  const build = await readFile("esbuild.config.mjs", "utf8");
  const immediate = await readFile("build-shims/immediate.cjs", "utf8");
  const setImmediate = await readFile("build-shims/setimmediate.cjs", "utf8");
  assert.match(build, /safeMammothRuntimePlugin/u);
  assert.match(build, /require\.resolve\("mammoth\/lib\/index\.js"\)/u);
  assert.match(build, /require\.resolve\("jszip\/lib\/index\.js"\)/u);
  assert.doesNotMatch(`${immediate}\n${setImmediate}`, /createElement|new Function|\beval\s*\(/u);
});

test("播放器铺满阅读视图并完整释放观察器", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const youtubeImport = await readFile("src/youtube-import.ts", "utf8");
  const bilibiliImport = await readFile("src/bilibili-import.ts", "utf8");
  assert.match(source, /calculateAlignedScrollTop/u);
  assert.match(source, /calculateViewportAlignedScrollDelta/u);
  assert.match(source, /const viewport = this\.fullWidthScrollEl \?\? this\.viewViewportEl/u);
  assert.match(source, /viewport\.scrollBy\(\{ top: delta, behavior: "smooth" \}\)/u);
  assert.match(source, /const TRANSCRIPT_SMOOTH_SCROLL_GUARD_MS = 900;/u);
  assert.match(
    source,
    /this\.transcriptProgrammaticScrollUntil = Date\.now\(\) \+ TRANSCRIPT_SMOOTH_SCROLL_GUARD_MS/u
  );
  assert.equal(source.match(/createRoot\(/gu)?.length, 9);
  assert.ok((source.match(/fullWidthObserver\?\.disconnect\(\)/gu)?.length ?? 0) >= 3);
  assert.match(
    source,
    /const viewport = this\.containerEl\.closest<HTMLElement>\("\.view-content"\)[\s\S]*?\.markdown-preview-view, \.markdown-source-view/u
  );
  assert.match(source, /viewportWidth - 32/u);
  const fullWidthMethod = source.slice(
    source.indexOf("const updateFullWidth"),
    source.indexOf("this.interfaceThemeLayoutRefresh = updateFullWidth")
  );
  assert.doesNotMatch(fullWidthMethod, /interfaceTheme/u);
  assert.match(fullWidthMethod, /if \(this\.plugin\.capabilities\.mobile\)/u);
  assert.match(source, /restoreContainerLayout\(\)/u);
  assert.match(source, /list\.scrollHeight <= list\.clientHeight \+ 1/u);
  assert.equal(source.match(/this\.createPlayerDock\(root\)/gu)?.length, 5);
  assert.equal(source.match(/this\.createPlayerStage\(playerDock\)/gu)?.length, 5);
  assert.equal(source.match(/this\.createFloatingToggle\(/gu)?.length, 2);
  assert.equal(source.match(/this\.createMobileFloatingToggle\(/gu)?.length, 3);
  const createPlayerDockMethod = source.slice(
    source.indexOf("private createPlayerDock"),
    source.indexOf("private createPlayerResizeCorners")
  );
  assert.match(createPlayerDockMethod, /if \(!this\.plugin\.capabilities\.mobile\) \{[\s\S]*?this\.createPlayerResizeCorners\(dock, root\);/u);
  assert.doesNotMatch(createPlayerDockMethod, /interfaceTheme/u);
  assert.match(source, /const corners: readonly PlayerResizeCorner\[\] = \["nw", "ne", "sw", "se"\]/u);
  assert.match(source, /cls: `evs-player-resize-corner evs-player-resize-corner--\$\{corner\}`/u);
  assert.match(source, /handle\.setPointerCapture\(event\.pointerId\)/u);
  assert.match(source, /calculatePlayerResizeWidth\(/u);
  assert.match(source, /scheduleDesktopPlayerWidthSave\(latestWidth, true\)/u);
  assert.match(source, /scheduleDesktopPlayerWidthSave\(nextWidth, false\)/u);
  assert.match(source, /updateSettings\(\{ desktopPlayerWidth: pendingWidth \}\)/u);
  assert.match(source, /scheduleTranscriptLayout\(!this\.playerDockEl\?\.classList\.contains\("is-resizing"\)\)/u);
  assert.match(source, /if \(!this\.plugin\.capabilities\.mobile\) \{[\s\S]*?cls: "evs-player-utilities"/u);
  assert.match(source, /utilities\.setAttribute\("aria-label", "视频置顶操作"\)/u);
  assert.doesNotMatch(source, /this\.createSourceLink\(utilities,/u);
  assert.equal(source.match(/this\.createSourceLink\(toolbar, sourceUrl\)/gu)?.length, 2);
  assert.equal(source.match(/this\.createTranscriptImportButton\(/gu)?.length, 2);
  assert.match(source, /this\.createTranscriptImportButton\(toolbar, config, transcriptData !== null\);\s*this\.createSpeedControls\(toolbar\);\s*this\.createSourceLink\(toolbar, sourceUrl\);/u);
  assert.match(
    source,
    /this\.createSeekButton\(primaryControls, "后退 5 秒"[\s\S]*?this\.playPauseButton = this\.createControlButton[\s\S]*?this\.createSeekButton\(primaryControls, "前进 5 秒"/u
  );
  assert.doesNotMatch(source, /if \(!transcriptData\) \{\s*this\.createTranscriptImportButton/u);
  assert.match(source, /hasTranscript \? "替换字幕或导入文稿" : "添加字幕或导入博主文稿"/u);
  assert.match(source, /cleanupLegacyBilibiliSourceLink/u);
  assert.match(source, /button\.createSpan\(\{ cls: "evs-seek-seconds", text: "5s" \}\)/u);
  assert.match(source, /private createSpeedControls/u);
  assert.doesNotMatch(source, /createMobileSpeedSelector|evs-speed-select/u);
  assert.match(source, /cls: "evs-speed-slider"/u);
  assert.match(source, /type: "range"/u);
  assert.match(source, /slider\.addEventListener\("input"/u);
  assert.match(source, /slider\.addEventListener\("change"/u);
  assert.match(source, /speedGroup\.addEventListener\("pointerdown"/u);
  assert.match(source, /speedGroup\.addEventListener\("pointermove"/u);
  assert.match(source, /speedGroup\.addEventListener\("pointerup"/u);
  assert.match(source, /speedGroup\.setPointerCapture\(event\.pointerId\)/u);
  assert.match(source, /cls: "evs-speed-slider-thumb"/u);
  assert.match(source, /cls: rate === 1 \? "evs-speed-label is-active" : "evs-speed-label"/u);
  assert.match(source, /"--evs-speed-offset": `\$\{displayedIndex \* 100\}%`/u);
  assert.doesNotMatch(source, /evs-speed-button|evs-speed-value/u);
  assert.doesNotMatch(source, /speedToggleButton|aria-haspopup/u);
  assert.match(source, /setIcon,/u);
  assert.match(source, /this\.setControlIcon\(button, "pin", "让视频保持在当前画面中"\)/u);
  assert.match(source, /floating \? "pin-off" : "pin"/u);
  assert.doesNotMatch(source, /text: "悬浮视频"/u);
  assert.doesNotMatch(source, /playPauseButton.*setText/u);
  assert.match(source, /Math\.max\(viewportRect\.top \+ 8, dockBottom \+ 8\)/u);
  assert.doesNotMatch(source, /DESIGN_CANVAS|calculateAdaptiveCanvasHeight|scale\(\$\{scale\}\)/u);
  assert.doesNotMatch(source, /rootSizeObserver|SIMPLE_ROOT_MIN_HEIGHT/u);
  assert.match(source, /scrollEl\.addEventListener\("scroll", this\.fullWidthScrollHandler, \{ passive: true \}\)/u);
  assert.match(source, /scrollEl\.addEventListener\("wheel", this\.fullWidthManualScrollHandler, \{ passive: true \}\)/u);
  assert.match(source, /scrollEl\.addEventListener\("touchstart", this\.fullWidthManualScrollHandler, \{ passive: true \}\)/u);
  assert.match(source, /const nextScrollLeft = scrollEl\.scrollLeft/u);
  assert.match(source, /Math\.abs\(nextScrollLeft - this\.fullWidthScrollLeft\) < 1/u);
  assert.match(source, /if \(layoutChanged \|\| recenterTranscript\)/u);
  assert.match(source, /updateFullWidth\(false\)/u);
  assert.match(source, /this\.suspendTranscriptAutoFollow\(true\)/u);
  assert.match(source, /this\.transcriptAutoFollowEnabled/u);
  assert.match(source, /this\.resumeTranscriptAutoFollow\(true\)/u);
  assert.match(source, /const TRANSCRIPT_AUTO_FOLLOW_RESUME_DELAY_MS = 5_000;/u);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?this\.transcriptAutoFollowEnabled = true;[\s\S]*?TRANSCRIPT_AUTO_FOLLOW_RESUME_DELAY_MS/u);
  assert.match(source, /host\.classList\.add\("lingua-study-full-width-host"\)/u);
  assert.match(source, /host\.classList\.remove\("lingua-study-full-width-host"\)/u);
  assert.match(source, /this\.overrideLivePreviewHostStyle\(host, "contain", "none"\)/u);
  assert.match(source, /this\.overrideLivePreviewHostStyle\(host, "overflow", "visible"\)/u);
  assert.match(source, /host\.style\.setProperty\(property, value, "important"\)/u);
  assert.match(source, /host\.style\.getPropertyValue\("contain"\)/u);
  assert.match(source, /host\.style\.getPropertyValue\("overflow"\)/u);
  assert.match(source, /this\.livePreviewHostMutationObserver\.observe\(host, \{/u);
  assert.match(source, /attributeFilter: \["style"\]/u);
  assert.match(source, /this\.livePreviewHostMutationObserver\?\.disconnect\(\)/u);
  assert.match(source, /this\.detachFullWidthScrollHandler\(\)/u);
  assert.match(source, /this\.restoreLivePreviewHostStyle\(\)/u);
  assert.doesNotMatch(source, /AI 校对|proofreadTranscript|evs-transcript-tools/u);
  assert.match(source, /const PLAYER_COMMAND_TIMEOUT_MS = 3_000;/u);
  assert.match(source, /const LOCAL_MEDIA_LOAD_TIMEOUT_MS = 8_000;/u);
  assert.match(source, /shouldAdvancePlaybackClock/u);
  assert.match(source, /waitForMediaMetadata/u);
  assert.match(source, /private readonly transcriptWriteQueue = new AsyncKeyedQueue\(\);/u);
  assert.doesNotMatch(source, /LIVE_PREVIEW_REVEAL_OBSERVER_TIMEOUT_MS|studyBlockRevealCleanupTimer/u);
  assert.match(source, /this\.app\.workspace\.on\("file-open"/u);
  assert.match(source, /containsStudyBlock\(lines\)/u);
  assert.match(source, /getStudyBlockCursorRecovery\(lines, editor\.getCursor\(\)\.line\)/u);
  assert.match(source, /editor\.replaceRange\("\\n"/u);
  assert.match(source, /editor\.setCursor\(\{ line: recovery\.exitLine, ch: 0 \}\)/u);
  assert.match(source, /new MutationObserverConstructor\(requestReveal\)/u);
  assert.match(source, /this\.studyBlockRevealObserver\.observe\(view\.containerEl/u);
  assert.match(source, /addEventListener\("focusin", handleEditorState, true\)/u);
  assert.match(source, /addEventListener\("selectionchange", handleEditorState\)/u);
  assert.match(source, /removeEventListener\("selectionchange", handleEditorState\)/u);
  assert.match(source, /window\.requestAnimationFrame\(prepare\)/u);
  assert.match(source, /activeFile\.path !== file\.path/u);
  assert.match(source, /editor\.blur\(\)/u);
  assert.match(youtubeImport, /addStudyBlockExitLine\(buildStudyBlock\(transcriptPath\)\)/u);
  assert.match(bilibiliImport, /addStudyBlockExitLine\(buildBilibiliStudyBlock\(link, transcriptPath\)\)/u);
  assert.match(source, /this\.renderLoadingShell\(\)/u);
  assert.match(source, /new VersionedAsyncCache<TranscriptFingerprintData>\(8\)/u);
});

test("简洁样式铺开全部字幕并移除内部滚动窗口", async () => {
  const css = await readFile("styles.css", "utf8");
  assert.match(css, /width: 100%;/u);
  assert.match(css, /height: auto;/u);
  assert.match(css, /aspect-ratio: 16 \/ 9;/u);
  assert.match(css, /background: var\(--background-primary\);/u);
  assert.match(css, /\.evs-local-status\.is-collapsed/u);
  assert.match(css, /\.evs-transcript \{[\s\S]*?overflow: visible;/u);
  assert.match(css, /\.evs-player-dock \{[\s\S]*?position: relative;[\s\S]*?container-name: evs-player-dock;[\s\S]*?container-type: inline-size;[\s\S]*?width: min\(calc\(100% - 48px\), var\(--evs-player-width, 860px\)\);/u);
  assert.match(css, /\.evs-player-dock\.is-floating \{[\s\S]*?position: sticky;[\s\S]*?top: 8px;/u);
  assert.match(css, /body:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-player-resize-corner \{[\s\S]*?width: 18px;[\s\S]*?height: 18px;[\s\S]*?touch-action: none;[\s\S]*?background: transparent;/u);
  assert.match(css, /body:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-player-resize-corner--nw \{[\s\S]*?cursor: nwse-resize;/u);
  assert.match(css, /body:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-player-resize-corner--ne \{[\s\S]*?cursor: nesw-resize;/u);
  assert.match(css, /body:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-player-dock\.is-resizing :is\(iframe, video\) \{[\s\S]*?pointer-events: none;/u);
  assert.doesNotMatch(css, /body\.lingua-study-theme-paper[^\n]*\.evs-player-resize-corner/u);
  assert.match(css, /body:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-toolbar \{[\s\S]*?min-height: clamp\(52px,[\s\S]*?overflow: hidden;/u);
  assert.match(css, /\.cm-preview-code-block\.cm-lang-lingua-study/u);
  assert.match(css, /\.cm-preview-code-block\.cm-lang-english-video-study/u);
  assert.match(css, /\.cm-embed-block\.cm-lang-lingua-study/u);
  assert.match(css, /\.lingua-study-full-width-host[\s\S]*?contain: none !important;[\s\S]*?overflow: visible !important;/u);
  assert.doesNotMatch(css, /:has\(\.evs-root\)/u);
  assert.match(css, /\.evs-player-stage \{[\s\S]*?position: relative;/u);
  assert.match(css, /\.evs-loading-player \{[\s\S]*?aspect-ratio: 16 \/ 9;/u);
  assert.match(css, /@keyframes evs-loading-shimmer/u);
  assert.match(css, /\.evs-player-utilities \{[\s\S]*?position: absolute;[\s\S]*?top: 0;[\s\S]*?right: -32px;/u);
  assert.match(css, /\.evs-player-utilities \.evs-icon-button \{[\s\S]*?border-left: 0;[\s\S]*?border-radius: 0 7px 7px 0;/u);
  assert.match(css, /\.evs-root\.evs-mobile \.evs-toolbar \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?justify-content: flex-end;[\s\S]*?gap: 4px;/u);
  assert.doesNotMatch(css, /\.evs-speed-select/u);
  assert.match(css, /\.evs-root\.evs-mobile \.evs-toolbar > \.evs-floating-toggle/u);
  assert.match(css, /\.evs-runtime-error,[\s\S]*?color-mix\(in srgb, var\(--text-error\) 12%, var\(--background-primary\)\)/u);
  assert.doesNotMatch(css, /grid-template-columns: minmax\(0, 1fr\) 40px;/u);
  assert.match(css, /\.evs-toolbar \{[\s\S]*?min-height: 41px;[\s\S]*?padding: 4px 8px;/u);
  assert.match(css, /\.evs-icon-button \{[\s\S]*?width: 32px;[\s\S]*?background: transparent;/u);
  assert.match(css, /\.evs-seek-seconds \{[\s\S]*?font-size: 8px;/u);
  assert.match(css, /\.evs-play-button \{[\s\S]*?border-radius: 50%;[\s\S]*?background: var\(--interactive-accent\);/u);
  assert.match(css, /\.evs-speed-group \{[\s\S]*?min-width: 220px;[\s\S]*?max-width: 320px;[\s\S]*?height: 34px;/u);
  assert.match(css, /\.evs-speed-group \{[\s\S]*?cursor: grab;[\s\S]*?touch-action: none;/u);
  assert.match(css, /\.evs-speed-slider \{[\s\S]*?appearance: none;[\s\S]*?pointer-events: none;/u);
  assert.match(css, /\.evs-speed-slider::-webkit-slider-runnable-track/u);
  assert.match(css, /\.evs-speed-slider-thumb \{[\s\S]*?transform: translateX\(var\(--evs-speed-offset\)\);[\s\S]*?transition: transform 150ms/u);
  assert.match(css, /\.evs-speed-labels \{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.evs-toolbar > \.evs-source-link \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border: 0;[\s\S]*?border-radius: 7px;[\s\S]*?box-shadow: inset 0 0 0 1px var\(--background-modifier-border\);/u);
  assert.match(css, /\.evs-toolbar > \.evs-add-transcript-button/u);
  assert.match(css, /\.lingua-study-document-import-modal/u);
  assert.doesNotMatch(css, /\.evs-speed-group \+ \.evs-source-link|\.evs-speed-group:has\(\+ \.evs-source-link\)/u);
  assert.doesNotMatch(css, /\.evs-speed-button|\.evs-speed-value|--evs-speed-progress/u);
  assert.doesNotMatch(css, /\.evs-speed-options|\.evs-speed-toggle|\.evs-floating-toolbar/u);
  assert.doesNotMatch(css, /is-compact|evs-player-dock-sentinel/u);
  assert.doesNotMatch(css, /\.evs-transcript \{[^}]*overflow-y: auto;/u);
  assert.doesNotMatch(css, /min-height: (?:280|300|580|640)px;/u);
  assert.doesNotMatch(css, /\.evs-transcript-tools/u);
  assert.doesNotMatch(css, /data:image|--evs-cork|paper-texture/u);
  assert.doesNotMatch(css, /width: 995px|height: 1581px|\.evs-scale-stage/u);
  assert.doesNotMatch(css, /\.evs-root::before|\.evs-segment\.is-active::before/u);
  assert.doesNotMatch(css, /\.evs-translation-button\.is-expanded/u);
  assert.doesNotMatch(css, /\.evs-translation-text::after/u);
  assert.match(css, /\.lingua-dictionary-body \{[\s\S]*?overflow-y: auto;/u);
  assert.match(css, /\.evs-segment\.is-vocabulary-target/u);
  assert.match(css, /\.lingua-review-context-actions/u);
  assert.match(css, /\.lingua-vocabulary-list-item \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 72px;/u);
  assert.match(
    css,
    /\.lingua-dictionary-word-actions \.lingua-dictionary-icon-button:is\(\[aria-label="加入生词本"\], \[aria-label="更新到生词本"\]\) \{[\s\S]*?background-color: transparent !important;[\s\S]*?color: var\(--text-normal\) !important;/u
  );
  assert.match(
    css,
    /\.lingua-dictionary-word-actions > \.lingua-dictionary-icon-button:last-child \.svg-icon \{[\s\S]*?opacity: 1 !important;[\s\S]*?stroke: currentColor !important;/u
  );
  assert.match(
    css,
    /\.lingua-dictionary-view \.lingua-vocabulary-list-item:is\(:hover, :focus, :focus-visible\) \{[\s\S]*?background: color-mix\([\s\S]*?var\(--lingua-paper-card\) 90%[\s\S]*?var\(--text-normal\) 10%[\s\S]*?\) !important;[\s\S]*?color: var\(--text-normal\) !important;/u
  );
  assert.match(css, /--lingua-paper-secondary-text: color-mix\(in srgb, var\(--text-normal\) 58%, transparent\);/u);
  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.lingua-vocabulary-list-heading span \{[\s\S]*?color: var\(--lingua-paper-secondary-text\);/u);
  assert.match(css, /\.lingua-dictionary-view \.lingua-vocabulary-list-item \.lingua-vocabulary-list-heading span \{[\s\S]*?color: var\(--lingua-paper-secondary-text\) !important;/u);
  assert.match(css, /\.lingua-vocabulary-list-item:is\(:hover, :focus, :focus-visible\) \.lingua-vocabulary-list-heading span \{[\s\S]*?color: var\(--lingua-paper-secondary-text\) !important;/u);
  assert.match(
    css,
    /body:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\) \.lingua-dictionary-view \.lingua-vocabulary-list-item:is\(:hover, :focus, :focus-visible\) \{[\s\S]*?background: color-mix\(in srgb, var\(--background-primary\) 90%, var\(--text-normal\) 10%\) !important;[\s\S]*?color: var\(--text-normal\) !important;/u
  );
  assert.match(
    css,
    /body\.theme-light:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\) \.lingua-dictionary-view \.lingua-vocabulary-list-item \{[\s\S]*?--button-bg-color: #fff !important;[\s\S]*?background: #fff !important;[\s\S]*?color: var\(--text-normal\) !important;/u
  );
  assert.match(
    css,
    /body\.theme-dark:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\) \.lingua-dictionary-view \.lingua-vocabulary-list-item \{[\s\S]*?background: var\(--background-primary\) !important;/u
  );
  assert.match(
    css,
    /body:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\) \.lingua-dictionary-view :is\([\s\S]*?\.lingua-dictionary-profile,[\s\S]*?\.lingua-vocabulary-controls[\s\S]*?\) select \{[\s\S]*?height: 34px !important;[\s\S]*?padding: 0 12px !important;[\s\S]*?line-height: 1 !important;[\s\S]*?text-align: center !important;[\s\S]*?text-align-last: center !important;[\s\S]*?appearance: none !important;[\s\S]*?background-image: none !important;/u
  );
  assert.match(css, /\.lingua-centered-select > select \{[\s\S]*?color: transparent !important;[\s\S]*?-webkit-text-fill-color: transparent !important;/u);
  assert.match(css, /\.lingua-centered-select-text \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?display: grid;[\s\S]*?place-items: center;/u);
  assert.match(
    css,
    /body:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\) \.lingua-dictionary-view \.lingua-vocabulary-list-item:is\(:hover, :focus, :focus-visible\) \.lingua-vocabulary-list-meta \{[\s\S]*?color: var\(--text-muted\) !important;/u
  );
  assert.match(css, /\.lingua-review-ratings button \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 48px;/u);
  assert.match(css, /\.lingua-dictionary-view button:not\(:disabled\):hover[\s\S]*?background: var\(--interactive-accent\) !important;/u);
  assert.match(css, /\.lingua-dictionary-profile select:hover[\s\S]*?background-color: var\(--interactive-accent\) !important;/u);
  assert.match(css, /\.lingua-dictionary-profile select \{[\s\S]*?width: 70px;[\s\S]*?height: 36px;[\s\S]*?padding: 0 14px;[\s\S]*?line-height: 36px;[\s\S]*?text-align: center;[\s\S]*?text-align-last: center;[\s\S]*?appearance: none;/u);
  assert.match(css, /\.lingua-vocabulary-controls select:hover/u);
  assert.match(
    css,
    /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.lingua-vocabulary-controls \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 92px;[\s\S]*?gap: 12px;/u
  );
  assert.match(
    css,
    /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.lingua-vocabulary-controls select \{[\s\S]*?width: 92px;[\s\S]*?height: 32px !important;[\s\S]*?padding: 0 16px;[\s\S]*?appearance: none;[\s\S]*?font-size: 13px;[\s\S]*?text-align: center;[\s\S]*?text-align-last: center;/u
  );
  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.lingua-vocabulary-controls select:is\(:focus, :focus-visible\) \{[\s\S]*?outline: none !important;[\s\S]*?box-shadow: none !important;/u);
  assert.match(css, /\.lingua-dictionary-profile select:focus-visible/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-section\)[^}]*button:not\(:disabled\):not\(\.mod-warning\):not\(\.mod-destructive\):hover/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-section\)\) \[hidden\] \{[\s\S]*?display: none !important;/u);
  assert.match(css, /\.lingua-dictionary-tabs button\.is-active \{[\s\S]*?background: var\(--interactive-accent\);/u);
  assert.match(css, /\.lingua-dictionary-tabs button\.is-active \{[\s\S]*?color: var\(--text-on-accent\);/u);
  assert.match(css, /\.lingua-dictionary-tabs button\.is-active \{[\s\S]*?font-weight: 700;/u);
  assert.match(css, /\.lingua-dictionary-tabs button:focus-visible/u);
  assert.match(css, /\.evs-study-heading/u);
});

test("离线词典使用右侧独立视图且双击只绑定英文字幕正文", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const dictionaryView = await readFile("src/dictionary-view.ts", "utf8");
  assert.match(source, /registerView\([\s\S]*?DICTIONARY_VIEW_TYPE/u);
  assert.match(source, /ensureSideLeaf\([\s\S]*?"right"/u);
  assert.match(source, /\{ active: true, split: false, reveal: true \}/u);
  assert.doesNotMatch(source, /\{ active: true, split: true, reveal: true \}/u);
  assert.match(source, /dictionaryTabPlacementPrepared/u);
  assert.match(source, /existingLeaf\.detach\(\)/u);
  assert.match(source, /tokenizeDictionaryText\(text\)/u);
  assert.match(source, /wordEl\.addEventListener\("dblclick"/u);
  assert.match(source, /if \(!this\.plugin\.settings\.enableDoubleClickLookup\)/u);
  assert.match(source, /renderer\.refreshDictionaryLookupSetting\(\)/u);
  assert.match(source, /activateDictionaryHighlight/u);
  assert.match(source, /clearDictionaryHighlight/u);
  assert.match(dictionaryView, /class LinguaDictionaryView extends ItemView/u);
  assert.match(dictionaryView, /"查词"/u);
  assert.match(dictionaryView, /"生词本"/u);
  assert.match(dictionaryView, /this\.createTabButton\(tabs, "review", "今日复习", summary\.total\)/u);
  assert.match(dictionaryView, /lingua-dictionary-tab-badge/u);
  assert.match(dictionaryView, /lingua-dictionary-definition-card/u);
  assert.match(dictionaryView, /lingua-dictionary-reference-grid/u);
  assert.match(dictionaryView, /lingua-dictionary-context-timestamp/u);
  assert.match(dictionaryView, /bookmark-check/u);
  assert.match(dictionaryView, /回到视频原句/u);
  assert.match(dictionaryView, /for \(const profile of STUDY_PROFILES\)/u);
  assert.match(dictionaryView, /isStudyProfile\(profile\)/u);
  assert.match(dictionaryView, /STUDY_PROFILES\.map\(/u);
  assert.match(dictionaryView, /createDiv\(\{ cls: "lingua-centered-select" \}\)[\s\S]*?createSpan\(\{[\s\S]*?cls: "lingua-centered-select-text",[\s\S]*?"aria-hidden": "true"[\s\S]*?selectedOptions\[0\]\?\.textContent/u);
  assert.doesNotMatch(source, /detachLeavesOfType\(DICTIONARY_VIEW_TYPE\)/u);
});

test("生词本使用独立串行存储、导出笔记与长图并注册两个入口命令", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const store = await readFile("src/vocabulary-store.ts", "utf8");
  const core = await readFile("src/vocabulary-core.ts", "utf8");
  const exportCore = await readFile("src/vocabulary-export-core.ts", "utf8");
  const imageExportCore = await readFile("src/vocabulary-image-export-core.ts", "utf8");
  const imageExport = await readFile("src/vocabulary-image-export.ts", "utf8");
  const dictionaryView = await readFile("src/dictionary-view.ts", "utf8");
  const css = await readFile("styles.css", "utf8");
  assert.match(source, /id: "open-vocabulary-book"/u);
  assert.match(source, /id: "start-vocabulary-review"/u);
  assert.match(source, /private vocabularyStore: VocabularyStore/u);
  assert.match(source, /registerStudyRenderer/u);
  assert.match(source, /navigateToVocabularyContext/u);
  assert.match(source, /mode: "preview"/u);
  assert.match(source, /targetLeaf: WorkspaceLeaf/u);
  assert.match(source, /getMostRecentLeaf\(this\.app\.workspace\.rootSplit\)/u);
  assert.match(source, /isVisibleVocabularyContextTarget/u);
  assert.match(source, /selectNewestEligibleRenderer/u);
  assert.match(source, /this\.vocabularyNavigationIndex !== null/u);
  assert.match(source, /已定位到生词所在原句；视频没有自动播放/u);
  assert.doesNotMatch(source, /playVocabularyContext|playBilibiliVocabularyContext/u);
  assert.doesNotMatch(source, /vocabularyPlaybackStopAt|shouldStopVocabularyPlayback/u);
  assert.match(dictionaryView, /openVocabularyContext/u);
  assert.match(dictionaryView, /"导出生词本到笔记"/u);
  assert.match(dictionaryView, /"download"/u);
  assert.match(dictionaryView, /this\.vocabularyExporting/u);
  assert.match(dictionaryView, /this\.plugin\.exportVocabularyBookToNote\(\)/u);
  assert.match(dictionaryView, /"将全部生词导出为长图"/u);
  assert.match(dictionaryView, /"正在生成生词本长图"/u);
  assert.match(dictionaryView, /"loader-circle"/u);
  assert.doesNotMatch(dictionaryView, /text:\s*this\.vocabularyImageExporting/u);
  assert.match(dictionaryView, /移动端暂不支持生词本长图导出/u);
  assert.match(dictionaryView, /this\.plugin\.exportVocabularyBookToImages\(\)/u);
  assert.match(dictionaryView, /!this\.plugin\.capabilities\.desktop/u);
  assert.doesNotMatch(dictionaryView, /playVocabularyContext|播放本句|播放这一句/u);
  assert.match(dictionaryView, /class VocabularyEditModal extends Modal/u);
  assert.match(dictionaryView, /"编辑生词"/u);
  assert.match(dictionaryView, /this\.plugin\.updateVocabularyEntry\(previousId, input\)/u);
  assert.match(store, /private readonly writeQueue = new AsyncKeyedQueue/u);
  assert.match(store, /this\.app\.vault\.process/u);
  assert.match(store, /async update\(id: string, input: VocabularyEditInput\)/u);
  assert.match(core, /Lingua Study\/Vocabulary\/wordbook\.json/u);
  assert.match(core, /export function updateVocabularyEntry\(/u);
  assert.match(core, /delete entries\[id\]/u);
  assert.match(core, /FSRS_ALGORITHM_VERSION = "FSRS-6"/u);
  assert.match(core, /default_w\.length !== 21/u);
  assert.match(core, /serializeFsrsReviewLog/u);
  assert.match(dictionaryView, /previewVocabularyRating/u);
  assert.match(exportCore, /Lingua Study\/Vocabulary\/生词本\.md/u);
  assert.match(exportCore, /lingua-study-vocabulary-export/u);
  assert.match(exportCore, /\[!lingua-word\]/u);
  assert.match(exportCore, /lingua-vocabulary-export-note/u);
  assert.match(exportCore, /已有普通笔记，已停止覆盖/u);
  assert.match(source, /async exportVocabularyBookToNote\(\)/u);
  assert.match(source, /async exportVocabularyBookToImages\(\)/u);
  assert.match(source, /this\.app\.vault\.createBinary/u);
  assert.match(source, /this\.app\.vault\.modifyBinary/u);
  assert.match(source, /this\.app\.fileManager\.trashFile\(node\)/u);
  assert.match(imageExportCore, /VOCABULARY_IMAGE_WIDTH = 1_080/u);
  assert.match(imageExportCore, /VOCABULARY_IMAGE_MAX_HEIGHT = 12_000/u);
  assert.match(imageExportCore, /Lingua Study\/Vocabulary\/生词本长图/u);
  assert.match(imageExportCore, /lingua-study-vocabulary-image-export/u);
  assert.match(imageExportCore, /非 Lingua Study 管理的图片，已停止覆盖/u);
  assert.match(imageExport, /context\.fillStyle = "#f7fafb"/u);
  assert.match(imageExport, /context\.fillText\("Lingua Study 生词本"/u);
  assert.match(imageExport, /roundedRectPath/u);
  assert.match(imageExport, /canvas\.toBlob/u);
  assert.doesNotMatch(imageExport, /foreignObject/u);
  assert.doesNotMatch(imageExport, /html2canvas|html-to-image/u);
  assert.match(source, /file\.extension === "md" \? "markdown" : "image"/u);
  assert.match(source, /this\.app\.workspace\.getLeavesOfType\(viewType\)/u);
  assert.match(source, /view\.file\?\.path === file\.path/u);
  assert.match(source, /this\.app\.workspace\.getLeaf\("tab"\)/u);
  assert.match(css, /\.lingua-vocabulary-export-button \{[\s\S]*?width: 32px;[\s\S]*?height: 32px !important;/u);
  assert.match(css, /\.lingua-vocabulary-export-actions \{[\s\S]*?flex-wrap: wrap;/u);
  assert.match(css, /\.lingua-vocabulary-export-button\.is-loading[\s\S]*?animation: lingua-vocabulary-export-spin/u);
  assert.match(css, /\.lingua-vocabulary-export-note \.callout\[data-callout="lingua-word"\] \{/u);
  assert.match(css, /--callout-icon: lucide-book-open;/u);
  assert.match(css, /\.callout\[data-callout="lingua-word"\] > \.callout-content/u);
  assert.match(css, /\.lingua-vocabulary-edit-form \{/u);
  assert.match(css, /\.lingua-vocabulary-edit-tags \{/u);
});

test("知识卡保留旧译文并且只有用户点击才请求分析", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.match(source, /"lightbulb", "补充知识点"/u);
  assert.match(source, /this\.plugin\.analyzeSentence\(segment\.text, profile\)/u);
  assert.match(source, /this\.plugin\.saveTranslationCache/u);
  assert.match(source, /this\.plugin\.saveStudyCache/u);
  assert.match(source, /text: result\.translation/u);
  assert.match(source, /const generatedStudyEntry/u);
  assert.match(source, /const studyEntry = generatedStudyEntry \?\? previousStudyEntry/u);
  assert.match(source, /const translation = view\.entry\?\.text \?\? studyEntry\?\.analysis\.translation/u);
  assert.match(source, /view\.errorMessage = !result\.analysis && previousStudyEntry/u);
  assert.match(source, /result\.analysis \? "warning" : "error"/u);
  assert.doesNotMatch(source, /void this\.plugin\.analyzeSentence[^;]*initialize/u);
});

test("字幕编辑、翻译、听写与跟读共用右侧固定操作栏", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /primary\.createDiv\(\{ cls: "evs-segment-text" \}\)/u);
  assert.match(source, /transcriptList\.createDiv\(\{ cls: "evs-segment-action-dock" \}\)/u);
  assert.match(source, /this\.selectSegmentForActions\(index, true\)/u);
  assert.match(source, /dock\.appendChild\(view\.primaryButton\)/u);
  assert.match(source, /dock\.appendChild\(dictationButton\)/u);
  assert.match(source, /dock\.appendChild\(shadowingButton\)/u);
  assert.doesNotMatch(source, /row\.querySelector<HTMLElement>\("\.evs-segment-content"\)\?\.appendChild\(dock\)/u);
  assert.match(source, /meta\.createSpan\(\{ cls: "evs-segment-state", text: "正在播放" \}\)/u);
  assert.doesNotMatch(source, /createDiv\(\{ cls: "evs-translation-actions" \}\)/u);
  assert.match(source, /"pencil", "请先选择字幕"/u);
  assert.match(source, /"languages",[\s\S]*?entry \? "显示翻译" : "翻译"/u);
  assert.match(source, /"headphones", "听写功能正在准备"/u);
  assert.match(source, /"mic", "跟读功能正在准备"/u);
  assert.match(source, /"refresh-cw", "重新翻译"/u);
  assert.match(source, /"lightbulb", "补充知识点"/u);
  assert.match(source, /setIcon\(button, iconName\)/u);
  assert.match(source, /view\.outputEl\.appendChild\(view\.retranslateButton\)/u);
  assert.match(source, /legacyRow\.appendChild\(view\.supplementButton\)/u);
  assert.match(source, /text: "延伸拓展"/u);
  assert.match(source, /studyEntry\.analysis\.extensions \?\? \[\]/u);
  assert.match(source, /由原句中的“\$\{extension\.anchor\}”延伸/u);
  assert.match(source, /this\.handlePrimaryTranslationAction\(index\)/u);
  assert.match(source, /this\.plugin\.settings\.translateWholeTranscript/u);
  assert.match(source, /this\.plugin\.settings\.translationProvider === "baidu"[\s\S]*?this\.plugin\.translateSentence\(segment\.text\)/u);
  assert.match(source, /百度翻译只生成中文译文/u);
  assert.match(source, /requestWholeTranscriptTranslation\(pendingIndices\)/u);
  assert.match(source, /for \(const index of pendingIndices\)/u);
  assert.match(source, /已有结果会自动跳过/u);
  assert.match(source, /this\.requestTranslation\(index, "retranslate"\)/u);
  assert.match(source, /this\.requestTranslation\(index, "supplement"\)/u);
  assert.doesNotMatch(source, /segmentRestoreButtons|text: "恢复原文"/u);

  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-segment-action-dock \{[\s\S]*?position: sticky;[\s\S]*?top: var\(--evs-segment-action-top, calc\(50vh - 71px\)\);[\s\S]*?width: 38px;[\s\S]*?flex-direction: column;/u);
  assert.match(source, /this\.transcriptResizeObserver\.observe\(this\.playerDockEl\)/u);
  assert.match(source, /updateSegmentActionDockInset\(\)[\s\S]*?playerHeight \+ 16/u);
  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.evs-root:not\(\.evs-mobile\) \.evs-segment \{[\s\S]*?border: 1px solid var\(--lingua-paper-line\);[\s\S]*?border-radius: 12px;/u);
  assert.doesNotMatch(css, /\.evs-translation-actions \{/u);
  assert.doesNotMatch(css, /\.evs-segment-primary \{[^}]*grid-template-columns:/u);
  assert.match(css, /\.evs-segment\.is-action-target:not\(\.is-active\)/u);
  assert.match(css, /\.evs-transcript-icon-button \{[\s\S]*?width: 32px;[\s\S]*?border: 0;[\s\S]*?background: transparent;/u);
  assert.match(css, /\.evs-transcript-icon-button \.svg-icon \{[\s\S]*?width: 19px;[\s\S]*?stroke-width: 1\.5;/u);
  assert.match(css, /\.evs-retranslate-action \{[\s\S]*?top: 5px;[\s\S]*?right: 5px;/u);
  assert.match(css, /\.evs-study-legacy-row \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 32px;/u);
  assert.match(css, /\.evs-study-extension-list \{[\s\S]*?display: grid;/u);
  assert.doesNotMatch(css, /\.evs-study-extensions[^}]*display:\s*none/u);
});

test("Markdown 选中文本可通过命令调用当前翻译服务", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /id: "translate-selected-text"/u);
  assert.match(source, /name: "翻译选中的英文文本"/u);
  assert.match(source, /editor\.getSelection\(\)\.trim\(\)/u);
  assert.match(source, /new SelectionTranslationModal/u);
  assert.match(source, /this\.openSelectionTranslation\(sourceText\)/u);
  assert.match(source, /this\.app\.workspace\.on\("editor-menu"/u);
  assert.match(source, /使用 Lingua Study 翻译选中文本/u);
  assert.match(source, /\(\) => this\.translateSentence\(sourceText\)/u);
  assert.match(source, /navigator\.clipboard\.writeText\(result\.text\)/u);
  assert.match(css, /\.lingua-study-selection-translation-text \{/u);
});

test("字幕多词选区直接显示悬浮翻译且不会误触第一个单词查词", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /textEl\.onpointerup =/u);
  assert.match(source, /if \(!this\.plugin\.settings\.enableSelectionTranslation\)/u);
  assert.match(source, /textEl\.onpointerup = null/u);
  assert.match(source, /if \(\/\\s\/u\.test\(selectedText\)\)/u);
  assert.match(source, /this\.showSelectionTranslationPopover\(textEl\)/u);
  assert.doesNotMatch(source, /text: "翻译选中句子"/u);
  assert.match(source, /this\.openSelectionTranslationPopover\(sourceText, rangeRect, viewDocument, viewWindow\)/u);
  assert.match(source, /class SelectionTranslationModal extends Modal/u);
  assert.match(source, /"aria-label": "选中文本翻译"/u);
  assert.match(source, /this\.plugin\.translateSentence\(sourceText\)/u);
  assert.match(source, /this\.hideSelectionTranslationPopover\(\)/u);
  assert.match(source, /header\.addEventListener\("pointerdown"/u);
  assert.match(source, /viewDocument\.addEventListener\("pointermove", movePopover\)/u);
  assert.doesNotMatch(css, /\.lingua-study-selection-translate-action \{/u);
  assert.match(css, /\.lingua-study-selection-translation-popover \{/u);
  assert.match(css, /cursor: move;/u);
});

test("纸张 UI 统一圆角按钮、外置置顶入口和独立设置卡片", async () => {
  const [source, css] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("styles.css", "utf8")
  ]);

  assert.match(css, /--lingua-paper-accent: #211e1a;/u);
  assert.match(css, /Lingua Study 的交互强调色独立于 Obsidian 外观主题/u);
  assert.match(css, /--interactive-normal: var\(--lingua-paper-control\);/u);
  assert.match(css, /--text-accent: var\(--lingua-paper-accent\);/u);
  assert.match(css, /--h2-color: var\(--lingua-paper-accent\) !important;/u);
  assert.match(css, /--h3-color: var\(--lingua-paper-accent\) !important;/u);
  assert.match(css, /--button-bg-color: var\(--lingua-paper-accent\) !important;/u);
  assert.match(css, /--button-text-color: var\(--lingua-paper-on-accent\) !important;/u);
  assert.match(css, /\.lingua-dictionary-header h3,[\s\S]*?\.lingua-review-card h2[\s\S]*?color: var\(--lingua-paper-accent\) !important;/u);
  assert.match(css, /\.evs-segment-action-dock \.evs-transcript-icon-button,[\s\S]*?\.lingua-vocabulary-export-button[\s\S]*?background: var\(--lingua-paper-control\) !important;/u);
  assert.match(css, /\.lingua-review-card > button\.mod-cta,[\s\S]*?background: var\(--lingua-paper-accent\) !important;/u);
  assert.match(css, /经典主题只借用设置页的卡片排版/u);
  assert.match(css, /body:not\(\.is-mobile\) :is\(\.lingua-study-settings,[\s\S]*?--lingua-paper-bg: var\(--background-primary\);[\s\S]*?--lingua-paper-card: var\(--background-primary\);/u);
  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) :is\([^}]*?\.lingua-study-settings[^}]*?\) \{/u);
  assert.match(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.evs-root/u);
  assert.match(css, /body:not\(\.is-mobile\) \.lingua-study-settings-home-group/u);
  assert.match(css, /body:not\(\.is-mobile\):not\(\.lingua-study-theme-paper\)[\s\S]*?\.evs-paper-header/u);
  assert.doesNotMatch(css, /body\.lingua-study-theme-paper:not\(\.is-mobile\) \.lingua-study-settings-home-group/u);
  assert.match(css, /--interactive-accent: var\(--lingua-paper-accent\);/u);
  assert.match(css, /\.evs-speed-label\.is-active \{[\s\S]*?color: #fff !important;/u);
  assert.match(css, /\.evs-player-utilities \{[\s\S]*?top: 0;[\s\S]*?right: -40px;/u);
  assert.match(css, /\.evs-player-frame \{[\s\S]*?overflow: hidden;[\s\S]*?border-radius: inherit;/u);
  assert.match(css, /\.lingua-dictionary-tabs \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.lingua-dictionary-tabs button\.is-active \{[\s\S]*?border-radius: 999px;/u);
  assert.match(css, /\.lingua-dictionary-empty,[\s\S]*?\.lingua-dictionary-missing \{[\s\S]*?background: transparent;/u);
  assert.match(css, /\.lingua-study-settings-home-group \{[\s\S]*?display: block;[\s\S]*?border: 0;/u);
  assert.match(css, /\.lingua-study-settings-home-group > \.setting-items \{[\s\S]*?display: grid;[\s\S]*?gap: 12px;[\s\S]*?background: transparent;/u);
  assert.match(css, /\.lingua-study-settings-home-group > \.setting-items > \.setting-item:not\(\.setting-item-heading\),[\s\S]*?border: 1px solid var\(--lingua-paper-line\);[\s\S]*?border-radius: 14px !important;/u);
  assert.match(css, /\.lingua-study-settings-theme-picker \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.lingua-study-settings-theme-choice\.is-selected \{[\s\S]*?border-color: var\(--lingua-theme-picker-ink\) !important;/u);
  assert.match(css, /\.lingua-study-settings-theme-preview\.is-classic \{[\s\S]*?background: #f6f6f6;/u);
  assert.match(css, /\.lingua-study-settings-theme-preview\.is-paper \{[\s\S]*?background: #f3eee4;/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-page-appearance\)::before \{[\s\S]*?content: "APPEARANCE";/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-page-appearance\) \.lingua-study-settings-theme-setting > \.setting-item-info \{[\s\S]*?display: none;/u);
  assert.match(css, /> \.setting-page-titlebar \{[\s\S]*?position: relative !important;[\s\S]*?top: auto !important;/u);
  assert.match(css, /\.lingua-study-settings-section \{[\s\S]*?display: block;[\s\S]*?border: 0;/u);
  assert.match(css, /\.lingua-study-settings-section > \.setting-items \{[\s\S]*?display: grid;[\s\S]*?gap: 12px;[\s\S]*?background: transparent;/u);
  assert.match(css, /\.lingua-study-settings-section > \.setting-items > \.setting-item:not\(\.setting-item-heading\) \{[\s\S]*?border: 1px solid var\(--lingua-paper-line\);[\s\S]*?border-radius: 14px !important;/u);
  assert.match(css, /\.lingua-study-settings-section > \.setting-items > \.setting-item:not\(\.setting-item-heading\):hover \{[\s\S]*?border-color: var\(--lingua-paper-accent\);[\s\S]*?box-shadow:/u);
  assert.match(css, /button:is\(\.mod-warning, \.mod-destructive\) \{[\s\S]*?color: var\(--lingua-paper-danger\) !important;/u);
  assert.match(css, /\.setting-item-control button:disabled \{[\s\S]*?color: var\(--text-muted\) !important;[\s\S]*?opacity: 0\.62;/u);
  assert.match(css, /\.setting-page-back-button,[\s\S]*?\.setting-item-control select \{[\s\S]*?appearance: none;[\s\S]*?text-align: center;[\s\S]*?text-align-last: center;[\s\S]*?cursor: pointer;[\s\S]*?transition:/u);
  assert.match(css, /\.setting-page-back-button,[\s\S]*?:hover \{[\s\S]*?background: var\(--lingua-paper-accent\);[\s\S]*?transform: translateY\(-1px\);/u);
  assert.match(css, /\.setting-item-control select:hover \{[\s\S]*?border-color: var\(--lingua-paper-accent\);[\s\S]*?box-shadow:/u);
  assert.match(css, /\.setting-item-control select:focus-visible \{[\s\S]*?outline: 2px solid var\(--lingua-paper-accent\);/u);
  assert.match(css, /\.checkbox-container \{[\s\S]*?overflow: hidden;[\s\S]*?width: 54px;[\s\S]*?height: 30px;[\s\S]*?border: 0;[\s\S]*?background-image: radial-gradient\(circle 15px at center, var\(--lingua-paper-accent\) 0 100%, transparent 100%\);[\s\S]*?background-position: left center;[\s\S]*?background-size: 30px 30px;[\s\S]*?box-shadow: inset 0 0 0 1px var\(--lingua-paper-accent\);/u);
  assert.match(css, /\.checkbox-container::after \{[\s\S]*?content: none;[\s\S]*?display: none;/u);
  assert.match(css, /\.checkbox-container\.is-enabled \{[\s\S]*?background-image: radial-gradient\(circle 15px at center, var\(--lingua-paper-card\) 0 100%, transparent 100%\);[\s\S]*?background-position: right center;/u);
  assert.doesNotMatch(source, /播放器未确认操作/u);
  assert.match(source, /`播放器已就绪 · \$\{segmentCount\} 条英文字幕`/u);
  assert.match(source, /classList\.toggle\([\s\S]*?"lingua-study-theme-paper"[\s\S]*?this\.settings\.interfaceTheme === "paper"/u);
  assert.match(source, /renderer\.applyInterfaceTheme\(\)/u);
});

test("单句跟读按播放状态自动同步并使用紧凑播放器布局", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /private startShadowing\(index: number\)/u);
  assert.match(source, /session\.syncSourceDuringRecording = this\.isPracticeSourcePlaying\(\)/u);
  assert.match(source, /"原句播放中 · 现在录音将同步跟读"/u);
  assert.match(source, /"原句已暂停 · 现在录音将只录人声"/u);
  assert.match(source, /"rotate-ccw"/u);
  assert.match(source, /"rotate-cw"/u);
  assert.match(source, /text: "2s"/u);
  assert.match(source, /sourcePlaying \? "pause" : "play"/u);
  assert.match(source, /if \(session\.syncSourceDuringRecording\)/u);
  assert.match(source, /const sourceControlsLocked = !canAdjustShadowingSource\(session\.phase\)/u);
  assert.match(source, /\{ disabled: sourceControlsLocked, play: true \}/u);
  assert.doesNotMatch(source, /sourceControlsLocked \|\| session\.phase === "paused"/u);
  assert.doesNotMatch(source, /!canAdjustShadowingSource\(session\.phase\) \|\| session\.phase === "paused"/u);
  assert.match(source, /session\.phase === "recording" \|\| session\.phase === "paused"/u);
  assert.match(source, /else if \(session\?\.phase === "paused"\) \{[\s\S]*?session\.sourceEnded = true;/u);
  assert.match(source, /session\.phase === "recording"[\s\S]*?session\.syncSourceDuringRecording = true/u);
  assert.match(source, /session\.phase === "recording"[\s\S]*?session\.syncSourceDuringRecording = false/u);
  assert.match(source, /const liveSampleCapacity = getShadowingWaveformTargetSampleCount\([\s\S]*?SHADOWING_MAX_RECORDING_MS/u);
  assert.match(source, /getShadowingLiveWaveformLayout\([\s\S]*?peaks\.length,[\s\S]*?liveSampleCapacity/u);
  assert.match(source, /getShadowingRecordingProgress\([\s\S]*?this\.getShadowingRecordingElapsed\(session\)/u);
  assert.match(source, /liveLayout\.startSlot \+ index \* samplesPerBar/u);
  assert.match(source, /const barHeight = peak \* \(height - 12\);[\s\S]*?if \(barHeight < 2\)/u);
  assert.doesNotMatch(source, /Math\.max\(3, peak \* \(height - 12\)\)/u);
  assert.match(source, /const samplesPerBar = isLiveWaveform[\s\S]*?getShadowingWaveformBinSize\(barWidth\)/u);
  assert.match(source, /peak = Math\.max\(peak, peaks\[peakIndex\] \?\? 0\)/u);
  assert.match(source, /getShadowingWaveformTargetSampleCount\(elapsedMs\)/u);
  assert.match(source, /missingSampleCount = targetSampleCount - session\.waveformPeaks\.length/u);
  assert.match(source, /previousPeak \+ \(nextPeak - previousPeak\) \* progress/u);
  assert.match(source, /Math\.max\(56, Math\.floor\(canvas\.clientHeight \|\| 56\)\)/u);
  assert.match(source, /formatShadowingElapsed\(\(current - segment\.start\) \* 1_000\)/u);
  assert.match(source, /"开始录音"/u);
  assert.match(source, /"暂停录音"/u);
  assert.match(source, /"继续录音"/u);
  assert.match(source, /"结束录音"/u);
  assert.match(source, /"播放录音"/u);
  assert.match(source, /"重新录制"/u);
  assert.match(source, /addButton\("重新录制", \(\) => this\.restartShadowingRecording\(\)\)/u);
  assert.match(source, /private restartShadowingRecording\(\): void \{[\s\S]*?void this\.startShadowingRecording\(\);/u);
  assert.match(source, /formatShadowingRecordingElapsed\(this\.getShadowingRecordingElapsed\(session\)\)/u);
  assert.match(source, /formatShadowingRecordingElapsed\(session\.recordingAccumulatedMs\)/u);
  assert.match(source, /private startShadowingUiTimer\(session: ShadowingSession\): void \{[\s\S]*?\}, 50\);/u);
  assert.match(source, /mediaDevices\.getUserMedia/u);
  assert.match(source, /echoCancellation: true/u);
  assert.match(source, /noiseSuppression: true/u);
  assert.match(source, /autoGainControl: true/u);
  assert.match(source, /SHADOWING_MAX_RECORDING_MS/u);
  assert.match(source, /recorder\.pause\(\)/u);
  assert.match(source, /recorder\.resume\(\)/u);
  assert.match(source, /createMediaStreamSource\(stream\)/u);
  assert.match(source, /getByteTimeDomainData\(session\.waveformSamples\)/u);
  assert.match(source, /cancelAnimationFrame\(session\.waveformFrame\)/u);
  assert.match(source, /audioContext\.close\(\)/u);
  assert.match(source, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/u);
  assert.match(source, /revokeObjectURL\(session\.recordingUrl\)/u);
  assert.match(source, /audio\.preload = "auto"/u);
  assert.match(source, /getShadowingPlaybackProgress\(/u);
  assert.match(source, /audio\.addEventListener\("playing"/u);
  assert.match(source, /audio\.addEventListener\("waiting"/u);
  assert.match(source, /private getShadowingPlaybackDisplayTime\(session: ShadowingSession\)/u);
  assert.match(source, /getShadowingSmoothedPlaybackTime\(/u);
  assert.match(source, /this\.closeShadowing\(false\)/u);
  assert.match(source, /"跟读录音暂时只支持电脑端"/u);
  assert.match(source, /"当前在线播放器无法逐句跟读，请先缓存视频"/u);
  assert.match(css, /\.evs-shadowing-panel \{/u);
  assert.match(css, /width: min\(100%, 680px\);/u);
  assert.match(css, /\.evs-shadowing-source-player/u);
  assert.match(css, /\.evs-shadowing-footer/u);
  assert.match(css, /\.evs-shadowing-waveform-canvas/u);
  assert.match(css, /height: 56px;/u);
  assert.match(css, /\.evs-shadowing-status\.is-recording/u);
  assert.match(css, /\.evs-shadowing-status\.is-paused/u);
  assert.match(css, /\.evs-shadowing-actions \.evs-button/u);
  assert.doesNotMatch(source, /ShadowingMode|addModeButton|setShadowingMode/u);
  assert.doesNotMatch(css, /\.evs-shadowing-mode/u);
  assert.doesNotMatch(css, /\.evs-shadowing-source-time \{[^}]*margin-left: auto;/u);
  assert.doesNotMatch(source, /evs-shadowing[^\n]*createEl\("input"/u);
  assert.doesNotMatch(css, /\.evs-segment\.is-shadowing \.evs-segment-text[\s\S]*?display: none/u);
});

test("单句听写原位隐藏、评分并在句尾停止播放", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /private startDictation\(index: number\)/u);
  assert.match(source, /text: "请听音频并输入完整句子"/u);
  assert.match(source, /"当前听写句后退 2 秒"/u);
  assert.match(source, /"当前听写句前进 2 秒"/u);
  assert.match(source, /private toggleDictationSourcePlayback\(\)/u);
  assert.match(source, /private seekDictationSource\(deltaSeconds: number\)/u);
  assert.match(source, /private updateDictationSourceUi\(session: DictationSession\)/u);
  assert.match(source, /evs-shadowing-source-player/u);
  assert.match(source, /evs-shadowing-source-time/u);
  assert.doesNotMatch(source, /text: "再听一次"/u);
  assert.match(source, /text: "提交听写"/u);
  assert.match(source, /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/u);
  assert.match(source, /compareDictation\(segment\.text, answer\)/u);
  assert.match(source, /text: "重新听写"/u);
  assert.match(source, /text: "下一句"/u);
  assert.match(source, /shouldStopDictationPlayback\(this\.getEstimatedCurrentTime\(\), stopAt\)/u);
  assert.match(source, /this\.sendCommand\("pauseVideo"\)/u);
  assert.match(source, /this\.localVideoEl\.pause\(\)/u);
  assert.match(source, /"听写暂时只支持桌面端"/u);
  assert.match(source, /"当前在线播放器无法逐句听写，请先缓存视频"/u);

  assert.match(css, /\.evs-segment\.is-dictating \.evs-segment-text[\s\S]*?display: none !important;/u);
  assert.match(css, /\.evs-dictation-panel \{/u);
  assert.match(css, /\.evs-dictation-token\.is-match/u);
  assert.match(css, /\.evs-dictation-token\.is-substitution/u);
  assert.match(css, /\.evs-dictation-token\.is-deletion/u);
  assert.match(css, /\.evs-dictation-token\.is-insertion/u);
});

test("暂停视频时不会在五秒后强制恢复字幕跟随", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.match(source, /if \(!this\.isPlaybackActivelyPlaying\(\)\) \{[\s\S]*?return;[\s\S]*?\}/u);
  assert.match(source, /this\.destroyed \|\| !this\.isPlaybackActivelyPlaying\(\)/u);
  assert.match(source, /state === PLAYER_STATE_PLAYING[\s\S]*?resumeTranscriptAutoFollow\(true\)/u);
  assert.match(source, /else \{[\s\S]*?this\.cancelTranscriptAutoFollowResume\(\);/u);
});
