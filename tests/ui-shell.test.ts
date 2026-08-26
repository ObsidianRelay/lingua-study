import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("YouTube 独立移动端回退不打包固定 InnerTube key", async () => {
  const source = await readFile("src/youtube-import.ts", "utf8");
  assert.match(source, /requestKeylessMobilePlayer/u);
  assert.match(source, /youtubei\/v1\/player\?prettyPrint=false/u);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/u);
  assert.doesNotMatch(source, /YTRANSCRIPT_INNERTUBE_API_KEY/u);
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

test("设置首页使用六个原生分类并保留全部设置项", async () => {
  const source = await readFile("src/settings.ts", "utf8");
  const pageDefinitions = source.match(/type: "page"/gu) ?? [];
  assert.equal(pageDefinitions.length, 6);
  assert.match(
    source,
    /return \[\s*this\.youtubePage\(\),\s*this\.bilibiliPage\(\),\s*this\.learningPage\(\),\s*this\.documentAlignmentPage\(\),\s*this\.translationPage\(\),\s*this\.generalPage\(\)\s*\];/u
  );

  for (const pageName of [
    "YouTube 字幕",
    "B站视频与登录",
    "学习与词典",
    "文稿导入与对齐",
    "翻译服务",
    "通用选项"
  ]) {
    assert.match(source, new RegExp(`name: "${pageName}"`, "u"));
  }

  for (const settingKey of [
    "transcriptFolder",
    "ytDlpPath",
    "studyProfile",
    "dailyNewWordLimit",
    "translationProvider",
    "translateWholeTranscript",
    "deepSeekModel",
    "kimiModel",
    "customBaseUrl",
    "customModel",
    "autoImportPastedVideoLinks",
    "cacheTranslations"
  ]) {
    assert.match(source, new RegExp(`key: "${settingKey}"`, "u"));
  }

  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "deepseek"/u);
  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "kimi"/u);
  assert.match(source, /visible: \(\) => this\.plugin\.settings\.translationProvider === "openai-compatible"/u);
  assert.match(source, /kimi: "Kimi 官方（国内）"/u);
  assert.match(source, /this\.plugin\.settings\.kimiSecretId/u);
  assert.match(source, /Whisper Base English 模型/u);
  assert.match(source, /只负责把用户手动粘贴或上传的文稿与视频时间轴对齐/u);
  assert.match(source, /options: STUDY_PROFILE_LONG_LABELS/u);
  assert.match(source, /isStudyProfile\(value\)/u);
  assert.match(source, /refreshBilibiliStatusIndicators/u);
  assert.match(source, /name: "ECDICT 完整版"/u);
  assert.match(source, /text: "下载完整版"/u);
  assert.match(source, /installFullDictionary/u);
  assert.match(source, /ClearFullDictionaryModal/u);
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
  assert.match(settings, /默认关闭：粘贴链接后点击左侧 Lingua Study Logo 手动创建/u);
  assert.match(settings, /key: "autoImportPastedVideoLinks"/u);
  assert.match(css, /\.side-dock-ribbon-action\.lingua-study-ribbon-action:hover/u);
  assert.match(css, /mask-image: var\(--lingua-study-logo-mask\)/u);
  assert.match(css, /\.lingua-study-manual-video-choice/u);
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

test("播放器铺满阅读视图并完整释放观察器", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const youtubeImport = await readFile("src/youtube-import.ts", "utf8");
  const bilibiliImport = await readFile("src/bilibili-import.ts", "utf8");
  assert.match(source, /calculateAlignedScrollTop/u);
  assert.equal(source.match(/createRoot\(/gu)?.length, 5);
  assert.ok((source.match(/fullWidthObserver\?\.disconnect\(\)/gu)?.length ?? 0) >= 3);
  assert.match(source, /viewportWidth - 32/u);
  assert.match(source, /restoreContainerLayout\(\)/u);
  assert.match(source, /list\.scrollHeight <= list\.clientHeight \+ 1/u);
  assert.equal(source.match(/this\.createPlayerDock\(root\)/gu)?.length, 3);
  assert.equal(source.match(/this\.createPlayerStage\(playerDock\)/gu)?.length, 3);
  assert.equal(source.match(/this\.createFloatingToggle\(/gu)?.length, 1);
  assert.match(source, /utilities\.setAttribute\("aria-label", "视频置顶操作"\)/u);
  assert.doesNotMatch(source, /this\.createSourceLink\(utilities,/u);
  assert.equal(source.match(/this\.createSourceLink\(toolbar, sourceUrl\)/gu)?.length, 2);
  assert.equal(source.match(/this\.createTranscriptImportButton\(/gu)?.length, 2);
  assert.match(source, /this\.setControlIcon\(button, "captions", "添加字幕或导入博主文稿"\)/u);
  assert.match(source, /cleanupLegacyBilibiliSourceLink/u);
  assert.match(source, /button\.createSpan\(\{ cls: "evs-seek-seconds", text: "5s" \}\)/u);
  assert.match(source, /private createSpeedControls/u);
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
  assert.doesNotMatch(source, /createSpeedSelector|speedToggleButton|aria-haspopup/u);
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
  assert.match(css, /\.evs-player-dock \{[\s\S]*?position: relative;[\s\S]*?width: min\(100%, 680px\);/u);
  assert.match(css, /\.evs-player-dock\.is-floating \{[\s\S]*?position: sticky;[\s\S]*?top: 8px;/u);
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
  assert.match(css, /\.lingua-review-ratings button \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 48px;/u);
  assert.match(css, /\.lingua-dictionary-view button:not\(:disabled\):hover[\s\S]*?background: var\(--interactive-accent\) !important;/u);
  assert.match(css, /\.lingua-dictionary-profile select:hover[\s\S]*?background-color: var\(--interactive-accent\) !important;/u);
  assert.match(css, /\.lingua-vocabulary-controls select:hover/u);
  assert.match(css, /\.lingua-dictionary-profile select:focus-visible/u);
  assert.match(css, /\.setting-page:has\(\.lingua-study-settings-section\)[^}]*button:not\(:disabled\):not\(\.mod-warning\):not\(\.mod-destructive\):hover/u);
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
  assert.match(source, /activateDictionaryHighlight/u);
  assert.match(source, /clearDictionaryHighlight/u);
  assert.match(dictionaryView, /class LinguaDictionaryView extends ItemView/u);
  assert.match(dictionaryView, /"查词"/u);
  assert.match(dictionaryView, /"生词本"/u);
  assert.match(dictionaryView, /`今日复习 \$\{summary\.total\}`/u);
  assert.match(dictionaryView, /bookmark-check/u);
  assert.match(dictionaryView, /回到视频原句/u);
  assert.match(dictionaryView, /for \(const profile of STUDY_PROFILES\)/u);
  assert.match(dictionaryView, /isStudyProfile\(profile\)/u);
  assert.match(dictionaryView, /STUDY_PROFILES\.map\(/u);
  assert.doesNotMatch(source, /detachLeavesOfType\(DICTIONARY_VIEW_TYPE\)/u);
});

test("生词本使用独立串行存储并注册两个入口命令", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const store = await readFile("src/vocabulary-store.ts", "utf8");
  const core = await readFile("src/vocabulary-core.ts", "utf8");
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
  const dictionaryView = await readFile("src/dictionary-view.ts", "utf8");
  assert.match(dictionaryView, /openVocabularyContext/u);
  assert.doesNotMatch(dictionaryView, /playVocabularyContext|播放本句|播放这一句/u);
  assert.match(store, /private readonly writeQueue = new AsyncKeyedQueue/u);
  assert.match(store, /this\.app\.vault\.process/u);
  assert.match(core, /Lingua Study\/Vocabulary\/wordbook\.json/u);
  assert.match(core, /10 \* 60 \* 1_000/u);
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

test("字幕编辑与翻译共用右侧固定操作栏", async () => {
  const source = await readFile("src/main.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(source, /primary\.createDiv\(\{ cls: "evs-segment-text" \}\)/u);
  assert.match(source, /transcriptList\.createDiv\(\{ cls: "evs-segment-action-dock" \}\)/u);
  assert.match(source, /this\.selectSegmentForActions\(index, true\)/u);
  assert.match(source, /dock\.appendChild\(view\.primaryButton\)/u);
  assert.doesNotMatch(source, /createDiv\(\{ cls: "evs-translation-actions" \}\)/u);
  assert.match(source, /"pencil", "请先选择字幕"/u);
  assert.match(source, /"languages",[\s\S]*?entry \? "显示翻译" : "翻译"/u);
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
  assert.match(source, /requestWholeTranscriptTranslation\(pendingIndices\)/u);
  assert.match(source, /for \(const index of pendingIndices\)/u);
  assert.match(source, /已有结果会自动跳过/u);
  assert.match(source, /this\.requestTranslation\(index, "retranslate"\)/u);
  assert.match(source, /this\.requestTranslation\(index, "supplement"\)/u);
  assert.doesNotMatch(source, /segmentRestoreButtons|text: "恢复原文"/u);

  assert.match(css, /\.evs-segment-action-dock \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(50vh - 36px\);[\s\S]*?flex-direction: column;/u);
  assert.match(css, /\.evs-segment-action-dock \+ \.evs-segment \{[\s\S]*?margin-top: -70px;/u);
  assert.doesNotMatch(css, /margin:\s*0 8px -72px auto/u);
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

test("暂停视频时不会在五秒后强制恢复字幕跟随", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.match(source, /if \(!this\.isPlaybackActivelyPlaying\(\)\) \{[\s\S]*?return;[\s\S]*?\}/u);
  assert.match(source, /this\.destroyed \|\| !this\.isPlaybackActivelyPlaying\(\)/u);
  assert.match(source, /state === PLAYER_STATE_PLAYING[\s\S]*?resumeTranscriptAutoFollow\(true\)/u);
  assert.match(source, /else \{[\s\S]*?this\.cancelTranscriptAutoFollowResume\(\);/u);
});
