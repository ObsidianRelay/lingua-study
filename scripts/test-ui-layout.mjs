import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const candidates = process.platform === "darwin"
  ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ]
  : process.platform === "win32"
    ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ]
    : ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];

const chrome = process.env.CHROME_BIN?.trim() || candidates[0];
const temporaryRoot = await mkdtemp(join(tmpdir(), "lingua-study-ui-layout-"));
const profilePath = join(temporaryRoot, "chrome-profile");
const fixturePath = join(temporaryRoot, "fixture.html");

try {
  const css = (await readFile("styles.css", "utf8")).replaceAll("</style>", "<\\/style>");
  const rowMarkup = Array.from({ length: 24 }, (_value, index) => `
    <div class="evs-segment${index === 4 ? " is-active" : ""}${index === 5 ? " is-dictation-result" : ""}${index === 6 ? " is-shadowing" : ""}">
      <div class="evs-segment-meta"><button class="evs-timestamp">00:${String(index * 2).padStart(2, "0")}</button><span class="evs-segment-state">正在播放</span></div>
      <div class="evs-segment-content">
        <div class="evs-segment-text"><span class="evs-dictionary-word${index === 0 ? " is-dictionary-active" : ""}">Subtitle</span> <span class="evs-dictionary-word">row</span> ${index + 1}</div>
        ${index === 4 ? `<div class="evs-translation-text" id="extension-card">
          <div class="evs-study-section"><div class="evs-study-heading">中文译文</div><div>这是一条用于检查延伸拓展布局的中文译文。</div></div>
          <div class="evs-study-section evs-study-extensions"><div class="evs-study-heading">延伸拓展</div><div class="evs-study-extension-list">
            <div class="evs-study-extension-item"><div class="evs-study-extension-anchor">由原句中的“Subtitle”延伸</div><div class="evs-study-extension-title"><strong>subtitle track</strong>：字幕轨道</div><div class="evs-study-note">由字幕这一主题延伸出的常见媒体表达。</div><div class="evs-study-extension-example"><div lang="en">Choose the correct subtitle track before playing the video.</div><div lang="zh-CN">播放视频前请选择正确的字幕轨道。</div></div></div>
          </div></div>
        </div>` : ""}
        ${index === 5 ? `<div class="evs-dictation-panel" id="dictation-panel">
          <div class="evs-dictation-summary"><span class="evs-dictation-score">75 分</span><span class="evs-dictation-score-note">共 1 处需要调整</span></div>
          <div class="evs-dictation-answer-label">你的答案</div><div class="evs-dictation-answer">This is one deliberately long answer used to verify that the dictation result wraps without covering nearby subtitles.</div>
          <div class="evs-dictation-answer-label">逐词对照</div><div class="evs-dictation-comparison"><span class="evs-dictation-token is-match"><span>This</span><span class="evs-dictation-token-label">正确</span></span><span class="evs-dictation-token is-substitution"><span>are</span><span class="evs-dictation-token-label">错写，应为 is</span></span><span class="evs-dictation-token is-deletion"><span>a</span><span class="evs-dictation-token-label">漏写</span></span><span class="evs-dictation-token is-insertion"><span>extra</span><span class="evs-dictation-token-label">多写</span></span></div>
          <div class="evs-dictation-actions"><button class="evs-button mod-cta">重新听写</button><button class="evs-button">下一句</button><button class="evs-button">退出听写</button></div>
        </div>` : ""}
        ${index === 6 ? `<div class="evs-shadowing-panel" id="shadowing-panel">
          <div class="evs-shadowing-prompt">先听原句，再录下自己的跟读</div>
          <div class="evs-shadowing-status is-recording">● 录音中 00:38</div>
          <div class="evs-shadowing-actions"><button class="evs-button mod-cta">结束录音</button><button class="evs-button">退出跟读</button></div>
        </div>` : ""}
      </div>
    </div>`).join("");

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; }
    /* Obsidian 会给普通按钮固定输入高度；插件必须为内容卡片明确解除该限制。 */
    button { height: 30px; overflow: hidden; }
    #app-layout { display: grid; grid-template-columns: minmax(320px, 1fr) 300px; height: 100vh; }
    #viewport { width: 100%; height: 100vh; overflow-y: auto; overflow-x: hidden; }
    #column { width: 65%; margin-inline: auto; }
    #host { width: 100%; }
    #dictionary { height: 100vh; border-left: 1px solid #bbb; background: var(--background-primary); }
    .theme-light { --background-primary: #fff; --background-secondary: #f4f4f4; --background-primary-alt: #eee; --background-modifier-border: #ccc; --text-normal: #222; --text-muted: #666; --text-error: #b22; --text-warning: #9a6400; --text-success: #287d3c; --color-red: #b22; --text-highlight-bg: #ffe9a8; --interactive-accent: #b23b3b; --interactive-accent-hover: #982f2f; --interactive-normal: #c26a17; --text-accent: #9b321d; --text-on-accent: #fff; --h2-color: #924e14; --h3-color: #8f5514; --button-bg-color: #c87628; --button-text-color: #1f1a14; --button-hover-bg-color: #a85c18; --button-hover-text-color: #fff; --tag-background: #eee; --tag-color: #333; --shadow-s: 0 1px 3px rgba(0,0,0,.16); }
    .theme-dark { --background-primary: #202020; --background-secondary: #2b2b2b; --background-primary-alt: #303030; --background-modifier-border: #555; --text-normal: #eee; --text-muted: #aaa; --text-error: #ff7373; --text-warning: #e7b85f; --text-success: #64c779; --color-red: #ff7373; --text-highlight-bg: #66521e; --interactive-accent: #c45b5b; --interactive-normal: #333; --text-on-accent: #fff; --tag-background: #444; --tag-color: #eee; --shadow-s: 0 1px 3px rgba(0,0,0,.4); }
    body.theme-light :is(h2, h3) { color: #9b321d; }
    body.theme-light button { background: #c26a17; color: #9b321d; }
    body.theme-light button.mod-cta { background-color: var(--button-bg-color); color: var(--button-text-color); }
    ${css}
  </style></head>
  <body class="theme-light lingua-study-theme-paper"><div id="app-layout">
    <div id="viewport"><div id="column"><div id="host"><div class="evs-root" id="root">
      <div class="evs-paper-header" id="paper-header"><div class="evs-paper-title"><h2>逐句精听</h2><div class="evs-paper-subtitle">WHY GOOD MEDICINE TAKES DECADES</div></div></div>
      <div class="evs-player-dock" id="dock">
        <div class="evs-player-resize-corner evs-player-resize-corner--nw" aria-hidden="true"></div>
        <div class="evs-player-resize-corner evs-player-resize-corner--ne" aria-hidden="true"></div>
        <div class="evs-player-resize-corner evs-player-resize-corner--sw" aria-hidden="true"></div>
        <div class="evs-player-resize-corner evs-player-resize-corner--se" aria-hidden="true"></div>
        <div class="evs-player-stage" id="stage">
          <div class="evs-player-frame" id="player-frame"></div>
          <div class="evs-player-utilities" id="utilities">
            <button class="evs-button evs-icon-button evs-floating-toggle" id="floating-toggle" aria-label="让视频保持在当前画面中" aria-pressed="false"><svg class="svg-icon"></svg></button>
          </div>
        </div>
        <div class="evs-toolbar" id="toolbar">
          <div class="evs-primary-controls">
            <button class="evs-button evs-icon-button evs-seek-button" aria-label="后退 5 秒"><svg class="svg-icon"></svg><span class="evs-seek-seconds">5s</span></button>
            <button class="evs-button evs-icon-button evs-play-button" aria-label="播放"><svg class="svg-icon"></svg></button>
            <button class="evs-button evs-icon-button evs-seek-button" aria-label="前进 5 秒"><svg class="svg-icon"></svg><span class="evs-seek-seconds">5s</span></button>
          </div>
          <button class="evs-button evs-icon-button evs-add-transcript-button" aria-label="替换字幕或导入文稿"><svg class="svg-icon"></svg></button>
          <div class="evs-speed-group" id="speed-group">
            <div class="evs-speed-slider-thumb" id="speed-thumb"></div>
            <div class="evs-speed-labels">
              <span class="evs-speed-label">0.75×</span>
              <span class="evs-speed-label is-active">1×</span>
              <span class="evs-speed-label">1.25×</span>
              <span class="evs-speed-label">1.5×</span>
              <span class="evs-speed-label">2×</span>
            </div>
            <input class="evs-speed-slider" id="speed-slider" type="range" min="0" max="4" step="1" value="1" aria-label="播放速度" aria-valuetext="1 倍速">
          </div>
          <a class="evs-button evs-icon-button evs-source-link" id="source-link" aria-label="打开原视频"><svg class="svg-icon"></svg></a>
        </div>
      </div>
        <div class="evs-status evs-local-status is-collapsed" id="status">本地缓存播放器已就绪</div>
        <div class="evs-transcript" id="transcript"><div class="evs-segment-action-dock" id="segment-action-dock"><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button></div>${rowMarkup}<div class="evs-transcript-end-spacer" id="spacer"></div></div>
    </div></div></div></div>
    <aside id="dictionary" class="lingua-dictionary-view">
      <div class="lingua-dictionary-header"><h3>Lingua Study</h3><span class="lingua-dictionary-source">23,596 词条</span></div>
      <div class="lingua-dictionary-tabs"><button class="is-active"><span class="lingua-dictionary-tab-label">查词</span></button><button><span class="lingua-dictionary-tab-label">生词本</span></button><button><span class="lingua-dictionary-tab-label">今日复习</span><span class="lingua-dictionary-tab-badge">12</span></button></div>
      <div class="lingua-dictionary-body" id="dictionary-body">
        <form class="lingua-dictionary-search"><input value="antidepressants"><button class="mod-cta">查询</button></form>
        <div class="lingua-dictionary-profile"><label>学习目标</label><select><option>四级</option></select></div>
        <div class="lingua-vocabulary-stats"><div class="lingua-vocabulary-export-actions"><button class="lingua-vocabulary-export-button" id="vocabulary-export-button"><svg class="svg-icon"></svg></button></div></div>
        <div class="lingua-dictionary-result">
          <div class="lingua-dictionary-word-row"><div><h2>antidepressant</h2><div class="lingua-dictionary-phonetic">/ˌæntidɪˈpresənt/</div></div><div class="lingua-dictionary-word-actions"><button class="lingua-dictionary-icon-button"></button><button class="lingua-dictionary-icon-button is-saved" aria-label="更新到生词本" aria-pressed="true"><svg class="svg-icon"></svg></button></div></div>
          <div class="lingua-dictionary-tags"><span class="is-current">四级</span><span>雅思</span></div>
          <div class="lingua-dictionary-definition-card"><div class="lingua-dictionary-section"><div class="lingua-dictionary-section-title">中文释义</div><div>${"抗抑郁药；用于治疗抑郁症的药物。".repeat(80)}</div></div><div class="lingua-dictionary-section"><div class="lingua-dictionary-section-title">English definition</div><div>used to prevent or treat depression</div></div></div>
          <div class="lingua-dictionary-reference-grid"><div class="lingua-dictionary-section"><div class="lingua-dictionary-section-title">词形变化</div><div>复数：antidepressants</div></div><div class="lingua-dictionary-section"><div class="lingua-dictionary-section-title">词频参考</div><div>BNC 词频 #1,068</div></div></div>
          <div class="lingua-dictionary-context"><div class="lingua-dictionary-context-header"><div class="lingua-dictionary-section-title">所在原句</div><span class="lingua-dictionary-context-timestamp">00:04</span></div><div>${"So when people find out that I study antidepressants, they often ask, how do they work? ".repeat(20)}</div><div class="lingua-dictionary-context-source">RSS articles/example.md</div></div>
        </div>
        <div class="lingua-review-card" id="review-fixture" style="position:fixed;left:-10000px;top:0"><div class="lingua-review-card-label">先回忆这个单词的含义</div><h2>depression</h2><button class="lingua-dictionary-icon-button"></button><button class="mod-cta" id="review-reveal-button">显示答案</button></div>
      </div>
    </aside></div>
    <div id="mobile-fixture" style="position:fixed;left:-10000px;top:0;width:360px;visibility:hidden">
      <div class="evs-root evs-mobile">
        <div class="evs-player-dock">
          <div class="evs-player-stage"><div class="evs-player-frame"></div></div>
          <div class="evs-toolbar" id="mobile-toolbar">
            <a class="evs-button evs-icon-button evs-source-link" id="mobile-source-link"></a>
            <button class="evs-button evs-icon-button evs-floating-toggle" id="mobile-floating-toggle"></button>
          </div>
        </div>
      </div>
    </div>
    <div id="import-modal" class="lingua-study-document-import-modal" style="position:fixed;left:-10000px;top:0">
      <div class="modal-content">
        <textarea class="lingua-study-document-paste">${"A long imported transcript sentence. ".repeat(20)}</textarea>
        <div class="lingua-study-document-preview">
          <div class="lingua-study-document-row-list">
            <div class="lingua-study-document-row">
              <span class="lingua-study-document-row-number">1</span>
              <textarea>${"This is a deliberately long English sentence used to test imported document layout. ".repeat(8)}</textarea>
              <textarea>${"这是一段用于检查文稿导入布局的长中文。".repeat(12)}</textarea>
              <div class="lingua-study-document-row-actions"><button></button><button></button><button></button><button></button></div>
            </div>
          </div>
        </div>
        <div class="lingua-study-alignment-result">
          <audio class="lingua-study-alignment-preview" controls></audio>
          <div class="lingua-study-alignment-row"><div class="lingua-study-alignment-text">Aligned sentence</div><div class="lingua-study-alignment-timing"><input><input><span>匹配 90%</span><button></button></div></div>
        </div>
      </div>
    </div>
    <div id="dictionary-empty-fixture" class="lingua-dictionary-empty" style="position:fixed;left:-10000px;top:0">双击英文字幕中的单词，释义会显示在这里。</div>
    <div id="settings-fixture" style="position:fixed;left:-10000px;top:0;width:700px">
      <div class="lingua-study-settings">
        <div class="setting-group lingua-study-settings-home-group" id="settings-home-group">
          <div class="setting-item setting-item-heading">学习与数据</div>
          <div class="setting-group-search"></div>
          <div class="setting-items" id="settings-home-items">
            <div class="setting-item" id="settings-home-item-1"><div class="setting-item-info"><div class="setting-item-name">学习与词典</div></div><div class="setting-item-control"><span class="setting-item-chevron">›</span></div></div>
            <div class="setting-item" id="settings-home-item-2"><div class="setting-item-info"><div class="setting-item-name">翻译服务</div></div><div class="setting-item-control"><span class="setting-item-chevron">›</span></div></div>
          </div>
        </div>
      </div>
      <div class="setting-page" id="settings-subpage">
        <div class="setting-page-titlebar" id="settings-titlebar"><button class="setting-page-back-button"></button><div class="setting-page-title">学习与词典</div></div>
        <div class="setting-page-content">
          <div class="setting-group lingua-study-settings-section" id="settings-section">
            <div class="setting-item setting-item-heading">学习目标</div>
            <div class="setting-group-search"></div>
            <div class="setting-items" id="settings-subitems">
              <div class="setting-item" id="settings-subitem-1"><div class="setting-item-info"><div class="setting-item-name">当前备考范围</div></div><div class="setting-item-control"><select id="settings-select"><option>雅思</option></select><div class="checkbox-container" id="settings-toggle-off"></div></div></div>
              <div class="setting-item" id="settings-subitem-2"><div class="setting-item-info"><div class="setting-item-name">词典与复习</div></div><div class="setting-item-control"><div class="checkbox-container is-enabled" id="settings-toggle-on"></div><button class="mod-warning" id="settings-warning-button">删除完整版</button><button id="settings-disabled-button" disabled>暂不可用</button></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      (() => {
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        try {
          const viewport = document.getElementById("viewport");
          const host = document.getElementById("host");
          const root = document.getElementById("root");
          const paperHeader = document.getElementById("paper-header");
          const dock = document.getElementById("dock");
          const stage = document.getElementById("stage");
          const playerFrame = document.getElementById("player-frame");
          const utilities = document.getElementById("utilities");
          const sourceLink = document.getElementById("source-link");
          const toolbar = document.getElementById("toolbar");
          const speedGroup = document.getElementById("speed-group");
          const speedThumb = document.getElementById("speed-thumb");
          const speedLabels = Array.from(speedGroup.querySelectorAll(".evs-speed-label"));
          const speedSlider = document.getElementById("speed-slider");
          const floatingToggle = document.getElementById("floating-toggle");
          const status = document.getElementById("status");
          const list = document.getElementById("transcript");
          const segmentActionDock = document.getElementById("segment-action-dock");
          const extensionCard = document.getElementById("extension-card");
          const dictationPanel = document.getElementById("dictation-panel");
          const shadowingPanel = document.getElementById("shadowing-panel");
          const rows = Array.from(list.querySelectorAll(".evs-segment"));
          const dictionary = document.getElementById("dictionary");
          const dictionaryBody = document.getElementById("dictionary-body");
          const dictionaryTabs = Array.from(dictionary.querySelectorAll(".lingua-dictionary-tabs button"));
          const dictionaryProfileSelect = dictionary.querySelector(".lingua-dictionary-profile select");
          const dictionaryBrand = dictionary.querySelector(".lingua-dictionary-header h3");
          const dictionaryWord = dictionary.querySelector(".lingua-dictionary-word-row h2");
          const vocabularyExportButton = document.getElementById("vocabulary-export-button");
          const reviewWord = document.querySelector("#review-fixture h2");
          const reviewRevealButton = document.getElementById("review-reveal-button");
          const importModal = document.getElementById("import-modal");
          const mobileFixture = document.getElementById("mobile-fixture");
          const mobileToolbar = document.getElementById("mobile-toolbar");
          const mobileSourceLink = document.getElementById("mobile-source-link");
          const mobileFloatingToggle = document.getElementById("mobile-floating-toggle");
          const dictionaryEmptyFixture = document.getElementById("dictionary-empty-fixture");
          const settingsHomeGroup = document.getElementById("settings-home-group");
          const settingsHomeItemsContainer = document.getElementById("settings-home-items");
          const settingsHomeItems = [document.getElementById("settings-home-item-1"), document.getElementById("settings-home-item-2")];
          const settingsTitlebar = document.getElementById("settings-titlebar");
          const settingsSection = document.getElementById("settings-section");
          const settingsSubitemsContainer = document.getElementById("settings-subitems");
          const settingsSubitems = [document.getElementById("settings-subitem-1"), document.getElementById("settings-subitem-2")];
          const settingsBackButton = document.querySelector(".setting-page-back-button");
          const settingsSelect = document.getElementById("settings-select");
          const settingsToggleOff = document.getElementById("settings-toggle-off");
          const settingsToggleOn = document.getElementById("settings-toggle-on");
          const settingsWarningButton = document.getElementById("settings-warning-button");
          const settingsDisabledButton = document.getElementById("settings-disabled-button");

          check(!mobileFixture.querySelector(".evs-player-utilities"), "移动端置顶按钮仍覆盖视频画面");
          check(mobileFloatingToggle.closest(".evs-toolbar") === mobileToolbar, "移动端置顶按钮没有进入控制栏");
          check(!mobileToolbar.querySelector(".evs-primary-controls"), "移动端仍显示失效的播放和跳转按钮");
          check(!mobileToolbar.querySelector(".evs-speed-select"), "移动端仍显示失效的倍速按钮");
          check(getComputedStyle(mobileToolbar).flexWrap === "nowrap", "移动端控制栏仍允许换行");
          check(getComputedStyle(mobileToolbar).justifyContent === "flex-end", "移动端保留按钮没有靠右");
          check(mobileToolbar.scrollWidth <= mobileToolbar.clientWidth + 1, "360px 移动端控制栏产生横向溢出");
          const mobileControlTops = Array.from(mobileToolbar.children).map((element) => element.getBoundingClientRect().top);
          check(Math.max(...mobileControlTops) - Math.min(...mobileControlTops) <= 1, "移动端播放操作没有保持在同一行");
          const mobileSourceRect = mobileSourceLink.getBoundingClientRect();
          const mobileFloatingRect = mobileFloatingToggle.getBoundingClientRect();
          check(mobileFloatingRect.left - mobileSourceRect.right <= 5, "原视频与置顶按钮没有保持相邻");
          check(mobileToolbar.getBoundingClientRect().right - mobileFloatingRect.right <= 9, "移动端右侧按钮组没有贴近控制栏右边");

          // 复现两套桌面主题共用的“铺满阅读视图”计算。
          const applyFullWidth = () => {
            const viewportRect = viewport.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            const currentMargin = Number.parseFloat(host.style.marginLeft) || 0;
            const naturalLeft = hostRect.left - currentMargin;
            const targetLeft = viewportRect.left + 16;
            host.style.width = Math.max(320, viewport.clientWidth - 32) + "px";
            host.style.maxWidth = "none";
            host.style.marginLeft = (targetLeft - naturalLeft) + "px";
          };
          // ResizeObserver 会在第一次扩展导致页面滚动条变化后再次校正位置。
          applyFullWidth();
          applyFullWidth();

          const rootRect = root.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          const targetLeft = viewportRect.left + 16;
          const targetWidth = viewport.clientWidth - 32;
          const initialRootHeight = rootRect.height;
          const initialDockRect = dock.getBoundingClientRect();
          const resizeCorners = Array.from(dock.querySelectorAll(".evs-player-resize-corner"));
          check(
            Math.abs(rootRect.left - targetLeft) <= 1 &&
              Math.abs(rootRect.width - targetWidth) <= 1,
            "播放器没有铺满阅读视图可用宽度：left=" + rootRect.left +
              ", targetLeft=" + targetLeft +
              ", width=" + rootRect.width +
              ", targetWidth=" + targetWidth
          );
          check(rootRect.right <= viewportRect.right + 1, "右侧词典遮挡了播放器或字幕区域");
          check(Math.abs(dictionary.getBoundingClientRect().width - 300) <= 1, "右侧词典宽度异常");
          check(dictionaryBody.scrollWidth <= dictionaryBody.clientWidth + 1, "长词典释义产生横向溢出");
          check(getComputedStyle(dictionaryBody).overflowY === "auto", "词典内容没有使用独立纵向滚动");
          check(dictionaryBody.scrollHeight > dictionaryBody.clientHeight, "长词典内容没有完整保留滚动范围");
          check(importModal.getBoundingClientRect().width <= Math.min(920, window.innerWidth - 40) + 1, "文稿向导宽度超出窗口");
          check(importModal.scrollWidth <= importModal.clientWidth + 1, "长文稿向导产生横向溢出");
          check(importModal.querySelector(".lingua-study-alignment-preview").getBoundingClientRect().height >= 38, "对齐结果缺少试听控件");
          check(dictationPanel.scrollWidth <= dictationPanel.clientWidth + 1, "长听写结果产生横向溢出");
          check(dictationPanel.querySelectorAll(".evs-dictation-token").length === 4, "听写逐词状态没有完整显示");
          check(Array.from(dictationPanel.querySelectorAll("button")).every((button) => button.clientHeight + 1 >= button.scrollHeight), "听写操作按钮被固定高度裁切");
          check(shadowingPanel.scrollWidth <= shadowingPanel.clientWidth + 1, "跟读录音面板产生横向溢出");
          check(Array.from(shadowingPanel.querySelectorAll("button")).every((button) => button.clientHeight + 1 >= button.scrollHeight), "跟读操作按钮被固定高度裁切");
          const activeTabStyle = getComputedStyle(dictionaryTabs[0]);
          const inactiveTabStyle = getComputedStyle(dictionaryTabs[1]);
          const dictionaryTabRects = dictionaryTabs.map((tab) => tab.getBoundingClientRect());
          const transcriptActionButtons = Array.from(segmentActionDock.querySelectorAll("button"));
          check(getComputedStyle(dictionaryBrand).color === "rgb(33, 30, 26)", "Obsidian 外观主题污染了 Lingua Study 品牌标题色");
          check(getComputedStyle(dictionaryWord).color === "rgb(33, 30, 26)", "Obsidian 外观主题污染了词典单词标题色");
          check(getComputedStyle(reviewWord).color === "rgb(33, 30, 26)", "Obsidian 外观主题污染了复习单词标题色");
          check(getComputedStyle(vocabularyExportButton).backgroundColor === "rgb(231, 229, 225)", "Obsidian 外观主题污染了生词导出按钮底色");
          check(getComputedStyle(reviewRevealButton).backgroundColor === "rgb(33, 30, 26)", "Obsidian 外观主题污染了显示答案按钮底色");
          check(transcriptActionButtons.every((button) => getComputedStyle(button).backgroundColor === "rgb(231, 229, 225)"), "Obsidian 外观主题污染了字幕操作按钮底色");
          check(dictionaryTabRects.every((rect) => Math.abs(rect.width - dictionaryTabRects[0].width) <= 1), "三个词典页面按钮没有保持等宽");
          check(dictionaryTabRects.every((rect) => Math.abs(rect.height - dictionaryTabRects[0].height) <= 1), "三个词典页面按钮没有保持等高");
          check(dictionaryTabs.every((tab) => parseFloat(getComputedStyle(tab).borderRadius) >= 18), "词典页面按钮缺少统一圆角");
          check(activeTabStyle.backgroundColor !== inactiveTabStyle.backgroundColor, "当前词典页面缺少明确的胶囊高亮");
          check(activeTabStyle.color !== inactiveTabStyle.color, "当前词典页面的文字颜色没有形成对比");
          check(Number(activeTabStyle.fontWeight) >= 700, "当前词典页面的字重提示过弱");
          check(dictionaryProfileSelect.getBoundingClientRect().width === 70 && dictionaryProfileSelect.getBoundingClientRect().height === 36, "生词本学习目标按钮尺寸不稳定");
          check(getComputedStyle(dictionaryProfileSelect).appearance === "none", "生词本学习目标按钮仍为系统箭头保留偏移");
          check(getComputedStyle(dictionaryProfileSelect).textAlign === "center", "生词本学习目标按钮文字没有水平居中");
          check(getComputedStyle(dictionaryProfileSelect).lineHeight === "36px", "生词本学习目标按钮文字没有垂直居中");
          check(getComputedStyle(dictionaryEmptyFixture).backgroundColor === "rgba(0, 0, 0, 0)", "词典空状态仍显示突兀的白色背景块");
          const dictionaryBookmarkButton = dictionary.querySelector('[aria-label="更新到生词本"]');
          const dictionaryBookmarkIcon = dictionaryBookmarkButton.querySelector(".svg-icon");
          check(getComputedStyle(dictionaryBookmarkButton).backgroundColor === "rgba(0, 0, 0, 0)", "已收藏按钮没有保持描边背景");
          check(getComputedStyle(dictionaryBookmarkIcon).color === getComputedStyle(dictionaryBookmarkButton).color, "已收藏书签图标仍继承不可见颜色");
          check(getComputedStyle(dictionaryBookmarkIcon).opacity === "1", "已收藏书签图标仍被降低透明度");
          check(getComputedStyle(settingsHomeGroup).borderStyle === "none", "设置首页仍把多个项目包在同一个外框里");
          check(getComputedStyle(settingsHomeItemsContainer).display === "grid" && getComputedStyle(settingsHomeItemsContainer).gap === "12px", "设置首页真实项目容器没有独立卡片间距");
          check(getComputedStyle(settingsHomeItemsContainer).backgroundColor === "rgba(0, 0, 0, 0)", "设置首页项目容器仍显示整块背景");
          check(settingsHomeItems.every((item) => getComputedStyle(item).borderStyle === "solid"), "设置首页项目缺少独立黑色边框");
          check(settingsHomeItems.every((item) => parseFloat(getComputedStyle(item).borderRadius) >= 14), "设置首页项目缺少完整圆角");
          check(settingsHomeItems[1].getBoundingClientRect().top >= settingsHomeItems[0].getBoundingClientRect().bottom + 10, "设置首页项目没有独立间距");
          check(getComputedStyle(settingsTitlebar).position === "relative", "设置子页面标题仍会吸顶并遮挡滚动内容");
          check(getComputedStyle(settingsSection).borderStyle === "none", "设置子页面仍把多个项目包在同一个外框里");
          check(getComputedStyle(settingsSubitemsContainer).display === "grid" && getComputedStyle(settingsSubitemsContainer).gap === "12px", "设置子页面真实项目容器没有独立卡片间距");
          check(getComputedStyle(settingsSubitemsContainer).backgroundColor === "rgba(0, 0, 0, 0)", "设置子页面项目容器仍显示整块背景");
          check(settingsSubitems.every((item) => getComputedStyle(item).borderStyle === "solid"), "设置子页面项目缺少独立黑色边框");
          check(settingsSubitems.every((item) => parseFloat(getComputedStyle(item).borderRadius) >= 14), "设置子页面项目缺少完整圆角");
          check(settingsSubitems[1].getBoundingClientRect().top >= settingsSubitems[0].getBoundingClientRect().bottom + 10, "设置子页面项目没有独立间距");
          check(settingsSubitems.every((item) => getComputedStyle(item).transitionDuration !== "0s"), "设置项目没有统一的悬停过渡");
          check(getComputedStyle(settingsBackButton).transitionDuration !== "0s", "设置返回按钮没有交互过渡");
          check(getComputedStyle(settingsBackButton).cursor === "pointer", "设置返回按钮没有可点击提示");
          check(getComputedStyle(settingsSelect).transitionDuration !== "0s", "设置下拉选择按钮没有交互过渡");
          check(getComputedStyle(settingsSelect).cursor === "pointer", "设置下拉选择按钮没有可点击提示");
          check(getComputedStyle(settingsSelect).appearance === "none", "设置下拉选择按钮仍为系统箭头预留偏移空间");
          check(getComputedStyle(settingsSelect).textAlign === "center", "设置下拉选择按钮文字没有水平居中");
          check(getComputedStyle(settingsWarningButton).color !== "rgb(255, 255, 255)", "危险按钮透明背景仍使用不可见白字");
          check(getComputedStyle(settingsWarningButton).borderStyle === "solid", "危险按钮缺少明确边框");
          check(getComputedStyle(settingsDisabledButton).color !== "rgb(255, 255, 255)", "禁用按钮文字不可见");
          check(parseFloat(getComputedStyle(settingsDisabledButton).opacity) < 1, "禁用按钮没有显示禁用状态");
          check(settingsToggleOff.getBoundingClientRect().width === 54 && settingsToggleOff.getBoundingClientRect().height === 30, "设置开关轨道尺寸不统一");
          check(getComputedStyle(settingsToggleOff).overflow === "hidden", "设置开关没有裁切为一体式胶囊轮廓");
          check(getComputedStyle(settingsToggleOff).borderTopWidth === "0px", "设置开关仍使用会与圆面产生夹缝的独立边框");
          check(getComputedStyle(settingsToggleOff).backgroundSize === "30px 30px", "设置开关圆面没有完整覆盖轨道高度");
          check(getComputedStyle(settingsToggleOff).backgroundImage.includes("radial-gradient"), "设置开关圆面没有与轨道合并绘制");
          check(getComputedStyle(settingsToggleOff, "::after").content === "none", "设置开关仍保留会抽动的独立伪元素滑块");
          check(getComputedStyle(settingsToggleOff).backgroundPosition === "0% 50%", "关闭状态圆面没有贴齐轨道左侧");
          check(getComputedStyle(settingsToggleOn).backgroundPosition === "100% 50%", "开启状态圆面没有贴齐轨道右侧");
          check(getComputedStyle(settingsToggleOff).transitionProperty === "background-position", "设置开关仍在动画独立滑块");
          check(getComputedStyle(settingsToggleOff).backgroundColor !== getComputedStyle(settingsToggleOn).backgroundColor, "设置开关开闭状态缺少颜色区分");
          const highlightedWord = rows[0].querySelector(".evs-dictionary-word.is-dictionary-active");
          const inactiveWord = rows[1].querySelector(".evs-dictionary-word");
          check(highlightedWord && inactiveWord, "字幕单词没有渲染为独立查词节点");
          check(rows[0].querySelector(".evs-segment-text").textContent === "Subtitle row 1", "查词节点改变了字幕原文");
          check(getComputedStyle(highlightedWord).boxShadow !== "none", "双击查词高亮缺少下边线");
          const inactiveRect = inactiveWord.getBoundingClientRect();
          inactiveWord.classList.add("is-dictionary-active");
          const highlightedRect = inactiveWord.getBoundingClientRect();
          check(
            Math.abs(inactiveRect.width - highlightedRect.width) <= 0.1 &&
              Math.abs(inactiveRect.height - highlightedRect.height) <= 0.1,
            "查词高亮改变了字幕排版"
          );
          const lightDictionaryColor = getComputedStyle(dictionary).backgroundColor;
          document.body.classList.replace("theme-light", "theme-dark");
          const darkDictionaryColor = getComputedStyle(dictionary).backgroundColor;
          check(lightDictionaryColor !== darkDictionaryColor, "词典没有跟随深浅主题变量");
          check(getComputedStyle(dictionaryTabs[0]).backgroundColor !== getComputedStyle(dictionaryTabs[1]).backgroundColor, "深色主题下当前词典页面高亮不明显");
          document.body.classList.replace("theme-dark", "theme-light");
          dictionaryBody.innerHTML = '<div class="lingua-vocabulary-controls"><input type="search" placeholder="搜索生词或释义"><select aria-label="筛选生词"><option value="all">全部</option><option value="due">今日到期</option></select></div><div class="lingua-vocabulary-stats"><div class="lingua-vocabulary-stats-counts"><span>共 4 个生词</span><span>当前显示 4 个</span></div><div class="lingua-vocabulary-export-actions"><button class="lingua-vocabulary-export-button" aria-label="导出生词本到笔记"><span class="lingua-vocabulary-export-icon"></span></button><button class="lingua-vocabulary-export-button lingua-vocabulary-image-export-button" aria-label="将全部生词导出为长图"><span class="lingua-vocabulary-export-icon"></span></button></div></div><div class="lingua-vocabulary-list">' + ['wisdom', 'bother', 'anything', 'focus'].map((word) => '<button class="lingua-vocabulary-list-item"><div class="lingua-vocabulary-list-heading"><strong>' + word + '</strong><span>下次 2026/8/22</span></div><div class="lingua-vocabulary-list-meaning">n. 这是一条用于验证列表不会互相覆盖的完整释义</div><div class="lingua-vocabulary-list-meta"><span>1 个语境</span><span>四级 · 六级 · 雅思</span></div></button>').join('') + '</div>';
          const vocabularyControls = dictionaryBody.querySelector(".lingua-vocabulary-controls");
          const vocabularyFilter = vocabularyControls.querySelector("select");
          check(vocabularyControls.scrollWidth <= vocabularyControls.clientWidth + 1, "生词搜索和筛选控件溢出侧栏");
          check(Math.abs(vocabularyFilter.getBoundingClientRect().width - 92) <= 1, "生词筛选框宽度不稳定");
          check(Math.abs(vocabularyFilter.getBoundingClientRect().height - 32) <= 1, "生词筛选框高度不统一");
          check(getComputedStyle(vocabularyFilter).textAlign === "center", "生词筛选文字没有水平居中");
          check(getComputedStyle(vocabularyFilter).paddingTop === "0px" && getComputedStyle(vocabularyFilter).paddingBottom === "0px", "生词筛选文字没有垂直居中");
          check(getComputedStyle(vocabularyFilter).backgroundImage.includes("linear-gradient"), "生词筛选框缺少下拉标识");
          vocabularyFilter.value = "due";
          check(vocabularyFilter.value === "due" && vocabularyFilter.selectedOptions[0].textContent === "今日到期", "最长的生词筛选标签没有完整保留");
          vocabularyFilter.focus();
          check(getComputedStyle(vocabularyFilter).outlineStyle === "none", "生词筛选框点击后仍保留粗焦点轮廓");
          check(getComputedStyle(vocabularyFilter).boxShadow === "none", "生词筛选框点击后仍保留焦点阴影");
          const vocabularyStats = dictionaryBody.querySelector(".lingua-vocabulary-stats");
          const vocabularyExportActions = dictionaryBody.querySelector(".lingua-vocabulary-export-actions");
          const vocabularyExportButtons = Array.from(dictionaryBody.querySelectorAll(".lingua-vocabulary-export-button"));
          const vocabularyExportButton = vocabularyExportButtons[0];
          check(vocabularyExportButton !== null, "生词本缺少导出笔记按钮");
          check(vocabularyExportButtons.length === 2, "生词本没有同时显示笔记和长图导出按钮");
          check(vocabularyExportButtons.every((button) => button.textContent.trim() === ""), "生词导出按钮仍显示文字");
          check(vocabularyExportButtons.every((button) => button.getBoundingClientRect().width === 32), "纯图标导出按钮宽度不是 32px");
          check(vocabularyStats.scrollWidth <= vocabularyStats.clientWidth + 1, "生词统计和导出按钮产生横向溢出");
          check(vocabularyExportActions.scrollWidth <= vocabularyExportActions.clientWidth + 1, "生词导出按钮组产生横向溢出");
          check(vocabularyExportButtons.every((button) => button.clientHeight + 1 >= button.scrollHeight), "生词导出按钮被固定高度裁切");
          const vocabularyItems = Array.from(dictionaryBody.querySelectorAll(".lingua-vocabulary-list-item"));
          check(vocabularyItems.length === 4, "生词本测试卡片没有完整渲染");
          check(vocabularyItems.every((item) => item.clientHeight + 1 >= item.scrollHeight), "Obsidian 固定按钮高度仍在裁切生词卡");
          check(vocabularyItems.every((item, index) => index === 0 || item.getBoundingClientRect().top >= vocabularyItems[index - 1].getBoundingClientRect().bottom + 6), "生词卡内容仍与下一条重叠");
          const vocabularyStatus = vocabularyItems[0].querySelector(".lingua-vocabulary-list-heading span");
          const neutralColorProbe = document.createElement("span");
          neutralColorProbe.style.color = "var(--lingua-paper-secondary-text)";
          vocabularyItems[0].appendChild(neutralColorProbe);
          check(getComputedStyle(vocabularyStatus).color === getComputedStyle(neutralColorProbe).color, "生词复习日期仍显示为强调色");
          neutralColorProbe.remove();
          vocabularyItems[0].focus();
          check(getComputedStyle(vocabularyItems[0]).backgroundColor !== activeTabStyle.backgroundColor, "生词卡获得焦点时仍整块变为强调色");
          check(getComputedStyle(vocabularyItems[0]).color === getComputedStyle(vocabularyItems[1]).color, "生词卡获得焦点时仍把正文改为反白色");
          vocabularyItems[0].blur();
          const exportedNote = document.createElement("div");
          exportedNote.className = "lingua-vocabulary-export-note";
          exportedNote.innerHTML = '<div class="callout" data-callout="lingua-word"><div class="callout-title"><div class="callout-title-inner">development</div></div><div class="callout-content"><ul><li><strong>音标</strong>：/dɪˈveləpmənt/</li><li><strong>中文释义</strong>：发展；展开</li><li><strong>English definition</strong>：' + 'a deliberately long definition used to verify card wrapping '.repeat(8) + '</li></ul><p><strong>视频语境</strong></p><ol><li>This is a long subtitle context for the exported vocabulary card.</li></ol></div></div>';
          dictionaryBody.appendChild(exportedNote);
          const exportedCard = exportedNote.querySelector('.callout[data-callout="lingua-word"]');
          check(exportedCard.scrollWidth <= exportedCard.clientWidth + 1, "导出生词卡片的长内容产生横向溢出");
          check(parseFloat(getComputedStyle(exportedCard).borderRadius) >= 10, "导出生词没有显示为圆角卡片");
          check(getComputedStyle(exportedCard).backgroundColor !== "rgba(0, 0, 0, 0)", "导出生词卡片缺少独立背景");
          dictionaryBody.innerHTML = '<div class="lingua-review-summary"><strong>今日待复习 12</strong><div>学习中 2 · 到期 6 · 新词 4</div></div><div class="lingua-review-card"><div class="lingua-review-card-label">先回忆这个单词的含义</div><h2>antidepressant</h2><button class="lingua-dictionary-icon-button"></button><div class="lingua-review-answer"><div class="lingua-review-meaning">' + '用于测试窄侧栏长释义自然换行。'.repeat(30) + '</div><div class="lingua-review-context">' + 'This is a deliberately long subtitle context used to verify that the review card remains fully readable in a narrow Obsidian sidebar. '.repeat(10) + '<div class="lingua-review-context-actions"><button>回到视频原句</button></div></div><div class="lingua-review-ratings"><button><span>忘记</span><small>10 分钟</small></button><button><span>困难</span><small>1 天</small></button><button><span>记得</span><small>3 天</small></button><button><span>熟练</span><small>7 天</small></button></div></div></div>';
          check(dictionaryBody.scrollWidth <= dictionaryBody.clientWidth + 1, "长复习卡产生横向溢出");
          check(dictionaryBody.scrollHeight > dictionaryBody.clientHeight, "长复习卡内容被侧栏裁切");
          check(dictionaryBody.querySelectorAll(".lingua-review-ratings button").length === 4, "四档复习评分没有完整显示");
          const reviewButtons = Array.from(dictionaryBody.querySelectorAll(".lingua-review-ratings button"));
          check(reviewButtons.every((button) => button.clientHeight + 1 >= button.scrollHeight), "Obsidian 固定按钮高度仍在裁切复习评分");
          check(getComputedStyle(dictionaryBody.querySelector(".lingua-review-ratings")).gridTemplateColumns.split(" ").length === 2, "窄侧栏下复习评分没有改为两列");
          check(dictionaryBody.querySelectorAll(".lingua-review-context-actions button").length === 1, "复习原句操作区应只保留回到视频原句按钮");
          dictionaryBody.scrollTop = dictionaryBody.scrollHeight;
          check(reviewButtons.at(-1).getBoundingClientRect().bottom <= dictionaryBody.getBoundingClientRect().bottom + 1, "复习评分按钮仍被侧栏底部裁切");
          check(
            getComputedStyle(list).overflowY === "visible",
            "字幕列表仍在使用内部滚动窗口"
          );
          check(list.scrollHeight <= list.clientHeight + 1, "字幕内容仍被内部高度裁切");
          check(list.scrollTop === 0, "展开式字幕列表不应产生内部滚动位置");
          check(getComputedStyle(segmentActionDock).position === "sticky", "字幕共用操作栏没有固定在右侧");
          check(segmentActionDock.querySelectorAll("button").length === 4, "字幕共用操作栏不是四个按钮");
          check(rows.every((row) => row.querySelectorAll(".evs-transcript-icon-button").length === 0), "字幕行仍在重复显示操作按钮");
          check(extensionCard && extensionCard.offsetParent !== null, "延伸拓展知识卡没有默认展开");
          check(extensionCard.clientHeight + 1 >= extensionCard.scrollHeight, "延伸拓展知识卡内容被裁切");
          check(status.getBoundingClientRect().height === 0, "就绪状态没有完全收起");
          check(
            rows.every((row) => row.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1),
            "存在超出播放器根容器、被隐藏的字幕"
          );
          check(viewport.scrollHeight > viewport.clientHeight, "长字幕没有交给整页滚动");
          const expectedPaperDockWidth = Math.min(root.clientWidth - 48, 860);
          check(
            Math.abs(initialDockRect.width - expectedPaperDockWidth) <= 1,
            "纸张播放器没有保持 24px 对称留白：dock=" + initialDockRect.width +
              ", root=" + rootRect.width +
              ", expected=" + expectedPaperDockWidth
          );
          check(
            Math.abs(initialDockRect.left - (rootRect.left + (rootRect.width - initialDockRect.width) / 2)) <= 1,
            "小尺寸播放器没有在页面中居中"
          );
          check(resizeCorners.length === 4, "播放器没有完整的四角隐形拖动区");
          check(resizeCorners.every((corner) => corner.tagName === "DIV" && corner.textContent === ""), "播放器缩放被错误实现为可见按钮");
          check(resizeCorners.every((corner) => getComputedStyle(corner).backgroundColor === "rgba(0, 0, 0, 0)"), "四角拖动区不是完全透明");
          check(getComputedStyle(resizeCorners[0]).cursor === "nwse-resize", "左上角没有显示斜向缩放光标");
          check(getComputedStyle(resizeCorners[1]).cursor === "nesw-resize", "右上角没有显示斜向缩放光标");
          check(resizeCorners.every((corner) => corner.getBoundingClientRect().width === 18 && corner.getBoundingClientRect().height === 18), "四角拖动区命中范围不一致");
          const northWestRect = resizeCorners[0].getBoundingClientRect();
          check(
            document.elementFromPoint(northWestRect.left + northWestRect.width / 2, northWestRect.top + northWestRect.height / 2) === resizeCorners[0],
            "播放器左上角无法命中拖动区"
          );
          const toolbarHeight = toolbar.getBoundingClientRect().height;
          const expectedToolbarHeight = Math.min(
            70,
            Math.max(52, 29.263 + initialDockRect.width * 0.04737)
          );
          check(
            Math.abs(toolbarHeight - expectedToolbarHeight) <= 2,
            "纸张播放器工具栏没有按播放器宽度同步调整高度"
          );
          check(
            Math.abs(playerFrame.getBoundingClientRect().width - stage.getBoundingClientRect().width) <= 3,
            "右上角按钮仍然缩小了视频画面"
          );
          const utilityStyle = getComputedStyle(utilities);
          const utilityRect = utilities.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          check(utilityStyle.position === "absolute", "视频辅助按钮没有悬浮在画面上");
          check(
            utilityRect.left >= stageRect.right - 1 &&
              Math.abs(utilityRect.left - stageRect.right) <= 1 &&
              Math.abs(utilityRect.top - stageRect.top) <= 1,
            "视频置顶按钮没有放在画面外侧并与视频顶部齐平"
          );
          check(floatingToggle.closest(".evs-player-utilities") === utilities, "视频置顶按钮位置异常");
          check(toolbar.contains(sourceLink), "打开原视频没有移动到播放器底栏");
          check(sourceLink.previousElementSibling === speedGroup, "打开原视频没有放在倍速滑块后面");
          check(!utilities.contains(sourceLink), "打开原视频仍在视频右上角");
          check(
            toolbar.querySelector(".evs-primary-controls").children[0].getAttribute("aria-label") === "后退 5 秒" &&
              toolbar.querySelector(".evs-primary-controls").children[1].classList.contains("evs-play-button") &&
              toolbar.querySelector(".evs-primary-controls").children[2].getAttribute("aria-label") === "前进 5 秒",
            "播放器按钮顺序不是后退 5 秒、播放、前进 5 秒"
          );
          check(toolbar.querySelectorAll(".evs-seek-seconds").length === 2, "前后跳转没有显示秒数");
          check(
            Array.from(toolbar.querySelectorAll(".evs-seek-seconds")).every((label) => label.textContent === "5s"),
            "前后跳转显示的秒数不正确"
          );
          check(
            toolbar.querySelector(".evs-play-button").textContent.trim() === "",
            "播放图标仍显示了文字"
          );
          check(speedSlider.type === "range", "倍速控制不是真正的 range 滑块");
          check(speedSlider.min === "0" && speedSlider.max === "4" && speedSlider.step === "1", "倍速滑块档位范围错误");
          check(getComputedStyle(speedGroup).cursor === "grab", "可见倍速轨道没有可拖动反馈");
          check(getComputedStyle(speedSlider).pointerEvents === "none", "透明 range 仍在拦截鼠标命中");
          check(speedLabels.length === 5, "五档倍速数字没有全部保留");
          check(speedLabels.every((label) => speedGroup.contains(label)), "倍速数字没有放在轨道内部");
          const expectedSpeedHeight = Math.min(
            40,
            Math.max(32, 21.895 + initialDockRect.width * 0.02105)
          );
          check(
            Math.abs(speedGroup.getBoundingClientRect().height - expectedSpeedHeight) <= 1,
            "倍速轨道没有按播放器宽度同步调整高度"
          );
          check(getComputedStyle(speedLabels[1]).color === "rgb(255, 255, 255)", "当前倍速没有显示白色文字");
          check(getComputedStyle(speedThumb).backgroundColor === "rgb(33, 30, 26)", "当前倍速没有显示黑色背景");
          check(getComputedStyle(speedThumb).transitionDuration !== "0s", "选中滑块缺少移动动画");
          const expectedToolbarGap = Math.min(
            12,
            Math.max(5, -3.842 + initialDockRect.width * 0.01842)
          );
          check(
            sourceLink.getBoundingClientRect().left - speedGroup.getBoundingClientRect().right >= expectedToolbarGap - 1,
            "打开原视频按钮仍与倍速轨道连在一起"
          );
          const expectedSourceSize = Math.min(
            46,
            Math.max(34, 18.842 + initialDockRect.width * 0.03158)
          );
          check(
            getComputedStyle(sourceLink).borderStyle !== "none" &&
              Math.abs(sourceLink.getBoundingClientRect().width - expectedSourceSize) <= 1 &&
              Math.abs(sourceLink.getBoundingClientRect().height - expectedSourceSize) <= 1,
            "打开原视频按钮没有按播放器宽度同步调整圆形描边尺寸"
          );
          let speedSelections = 0;
          let pointerDragging = false;
          const updatePointerPreview = (clientX) => {
            const rect = speedGroup.getBoundingClientRect();
            const ratio = Math.min(0.999999, Math.max(0, (clientX - rect.left) / rect.width));
            const index = Math.min(4, Math.floor(ratio * 5));
            speedSlider.value = String(index);
            speedLabels.forEach((label, labelIndex) => label.classList.toggle("is-active", labelIndex === index));
            speedGroup.style.setProperty("--evs-speed-offset", (index * 100) + "%");
          };
          speedGroup.addEventListener("pointerdown", (event) => {
            pointerDragging = true;
            updatePointerPreview(event.clientX);
          });
          speedGroup.addEventListener("pointermove", (event) => {
            if (pointerDragging) updatePointerPreview(event.clientX);
          });
          speedGroup.addEventListener("pointerup", (event) => {
            if (!pointerDragging) return;
            updatePointerPreview(event.clientX);
            pointerDragging = false;
            speedSelections += 1;
          });
          const speedRect = speedGroup.getBoundingClientRect();
          check(
            document.elementFromPoint(speedRect.left + speedRect.width / 2, speedRect.top + speedRect.height / 2) === speedGroup,
            "鼠标命中层不是可见倍速轨道"
          );
          speedGroup.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: speedRect.left + speedRect.width * 0.3 }));
          speedGroup.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: speedRect.left + speedRect.width * 0.7 }));
          check(speedLabels[3].classList.contains("is-active"), "拖动时没有即时切换轨道内的速度数字");
          check(
            speedGroup.style.getPropertyValue("--evs-speed-offset") === "300%",
            "拖动时红色选中滑块没有跟随"
          );
          check(speedSelections === 0, "拖动过程中提前提交了倍速命令");
          speedGroup.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0, clientX: speedRect.left + speedRect.width * 0.7 }));
          check(speedSelections === 1, "松开滑块后没有只提交一次倍速命令");

          floatingToggle.addEventListener("click", () => {
            const floating = !dock.classList.contains("is-floating");
            dock.classList.toggle("is-floating", floating);
            if (floating) {
              segmentActionDock.style.setProperty(
                "--evs-segment-action-top",
                (Math.ceil(dock.getBoundingClientRect().height) + 16) + "px"
              );
            } else {
              segmentActionDock.style.removeProperty("--evs-segment-action-top");
            }
            floatingToggle.setAttribute("aria-label", floating ? "取消视频悬浮" : "让视频保持在当前画面中");
            floatingToggle.setAttribute("aria-pressed", String(floating));
          });

          viewport.scrollTop = Math.min(
            initialDockRect.height + 80,
            viewport.scrollHeight - viewport.clientHeight
          );
          check(
            dock.getBoundingClientRect().top < viewport.getBoundingClientRect().top,
            "默认状态下播放器错误地保持悬浮"
          );

          floatingToggle.click();
          check(dock.classList.contains("is-floating"), "悬浮按钮没有开启播放器悬浮");
          check(floatingToggle.getAttribute("aria-pressed") === "true", "悬浮按钮状态没有同步");
          check(
            segmentActionDock.getBoundingClientRect().top >= dock.getBoundingClientRect().bottom + 7,
            "字幕操作栏仍被悬浮播放器或控制栏遮挡"
          );
          check(
            Math.abs(dock.getBoundingClientRect().width - initialDockRect.width) <= 1,
            "开启悬浮后播放器尺寸发生变化"
          );

          check(
            Math.abs(dock.getBoundingClientRect().top - (viewport.getBoundingClientRect().top + 8)) <= 1,
            "开启悬浮后播放器没有吸附在阅读视图顶部"
          );
          check(dock.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top, "吸顶播放器不可见");

          const followedRow = rows[6];
          const followedRect = followedRow.getBoundingClientRect();
          const visibleTop = dock.getBoundingClientRect().bottom + 8;
          if (followedRect.top < visibleTop) {
            viewport.scrollBy({ top: followedRect.top - visibleTop, behavior: "auto" });
          }
          check(
            followedRow.getBoundingClientRect().top >= dock.getBoundingClientRect().bottom + 7,
            "当前字幕被吸顶播放器遮挡"
          );

          floatingToggle.click();
          check(!dock.classList.contains("is-floating"), "悬浮按钮没有取消播放器悬浮");
          check(floatingToggle.getAttribute("aria-pressed") === "false", "取消悬浮后按钮状态没有同步");
          check(segmentActionDock.style.getPropertyValue("--evs-segment-action-top") === "", "取消悬浮后字幕操作栏没有恢复默认位置");

          dock.style.setProperty("--evs-player-width", "480px");
          const compactToolbarRect = toolbar.getBoundingClientRect();
          const compactControls = Array.from(toolbar.children);
          check(Math.abs(dock.getBoundingClientRect().width - 480) <= 1, "播放器无法缩到允许的最小宽度");
          check(toolbar.scrollWidth <= toolbar.clientWidth + 1, "最小播放器的控制栏产生横向溢出");
          check(
            compactControls.every((control) => control.getBoundingClientRect().right <= compactToolbarRect.right + 1),
            "最小播放器仍有按钮跑出控制栏右边界"
          );
          check(
            toolbar.querySelector(".evs-play-button").getBoundingClientRect().width <= 38 &&
              sourceLink.getBoundingClientRect().width <= 34 &&
              speedGroup.getBoundingClientRect().height <= 32,
            "播放器缩小时按钮和倍速控制器没有同步收紧"
          );
          dock.style.setProperty("--evs-player-width", initialDockRect.width + "px");

          status.classList.remove("is-collapsed");
          check(status.getBoundingClientRect().height > 0, "本地状态没有正常显示");
          check(Math.abs(root.getBoundingClientRect().height - initialRootHeight) <= 1, "标题区状态胶囊引起页面布局跳动");
          check(
            status.getBoundingClientRect().top >= paperHeader.getBoundingClientRect().top &&
              status.getBoundingClientRect().bottom <= paperHeader.getBoundingClientRect().bottom,
            "标题区状态胶囊越出标题区域"
          );
          status.classList.add("is-collapsed");

          const beforeTranslationHeight = root.getBoundingClientRect().height;
          const translation = document.createElement("div");
          translation.className = "evs-translation-text";
          translation.innerHTML = '<div class="evs-study-section"><div class="evs-study-heading">中文译文</div><div class="evs-translation-copy">' + '这是一段会改变行高的长翻译内容。'.repeat(8) + '</div></div><div class="evs-study-section"><div class="evs-study-heading">重点词汇与搭配</div><ul class="evs-study-list"><li><strong>study antidepressants</strong><div class="evs-study-note">重点表达说明</div></li></ul></div><div class="evs-study-section evs-study-exam-tip"><div class="evs-study-heading">备考提示</div><div>四级备考提示</div></div>';
          rows[2].querySelector(".evs-segment-content").append(translation);
          check(
            root.getBoundingClientRect().height > beforeTranslationHeight,
            "翻译展开后根页面没有随内容增高"
          );
          check(list.scrollHeight <= list.clientHeight + 1, "翻译展开后又形成了内部滚动");

          const beforeTallRowHeight = root.getBoundingClientRect().height;
          rows[4].querySelector(".evs-segment-content").style.minHeight = (window.innerHeight + 80) + "px";
          check(
            root.getBoundingClientRect().height > beforeTallRowHeight,
            "超长字幕没有继续向下展开"
          );
          check(
            rows.at(-1).getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1,
            "超长字幕导致后续内容被根容器隐藏"
          );
          viewport.scrollTop = viewport.scrollHeight;
          check(
            rows.at(-1).getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 1,
            "整页滚动无法看到最后一句字幕"
          );
          check(
            segmentActionDock.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1,
            "字幕共用操作栏越过字幕区域漂到页面空白处"
          );
          const paperSettingsBackground = getComputedStyle(document.querySelector(".lingua-study-settings")).backgroundColor;
          const paperSettingsCardBackground = getComputedStyle(settingsHomeItems[0]).backgroundColor;
          const settingsCardRectBeforeThemeChange = settingsHomeItems[0].getBoundingClientRect();
          const playerActionCountBeforeThemeChange = root.querySelectorAll("button, a, input").length;
          [...settingsHomeItems, ...settingsSubitems].forEach((item) => { item.style.transition = "none"; });
          document.body.classList.remove("lingua-study-theme-paper");
          document.body.getBoundingClientRect();
          const classicRootRect = root.getBoundingClientRect();
          const classicSettingsBackground = getComputedStyle(document.querySelector(".lingua-study-settings")).backgroundColor;
          const classicSettingsCardBackground = getComputedStyle(settingsHomeItems[0]).backgroundColor;
          check(getComputedStyle(paperHeader).display === "none", "经典主题仍显示 Lingua Paper 专属标题");
          check(
            Math.abs(classicRootRect.left - rootRect.left) <= 1 &&
              Math.abs(classicRootRect.width - rootRect.width) <= 1,
            "切换到经典主题后内容区域没有保持 Lingua Paper 的宽度"
          );
          check(classicSettingsBackground === "rgb(255, 255, 255)", "经典主题没有恢复 Obsidian 的设置页背景色：" + classicSettingsBackground);
          check(classicSettingsCardBackground === "rgb(255, 255, 255)", "经典主题的设置卡片仍使用纸张色：" + classicSettingsCardBackground);
          check(classicSettingsBackground !== paperSettingsBackground, "经典主题与 Lingua Paper 的设置页背景色没有区分");
          check(classicSettingsCardBackground !== paperSettingsCardBackground, "经典主题与 Lingua Paper 的设置卡片颜色没有区分");
          check(getComputedStyle(settingsHomeGroup).borderStyle === "none", "切回经典主题后设置首页布局发生变化");
          check(settingsHomeItems.every((item) => getComputedStyle(item).borderStyle === "solid"), "切回经典主题后设置卡片边框消失");
          check(getComputedStyle(settingsSection).borderStyle === "none", "切回经典主题后设置子页面布局发生变化");
          check(settingsSubitems.every((item) => getComputedStyle(item).borderStyle === "solid"), "切回经典主题后设置子页面卡片边框消失");
          check(root.querySelectorAll("button, a, input").length === playerActionCountBeforeThemeChange, "切换主题后播放器或字幕操作数量发生变化");
          viewport.scrollTop = 0;
          dock.style.setProperty("--evs-player-width", "480px");
          const classicDockRect = dock.getBoundingClientRect();
          const classicToolbarRect = toolbar.getBoundingClientRect();
          const classicControls = Array.from(toolbar.children);
          check(Math.abs(classicDockRect.width - 480) <= 1, "经典主题没有应用播放器拖拽后的宽度");
          check(resizeCorners.every((corner) => {
            const style = getComputedStyle(corner);
            const rect = corner.getBoundingClientRect();
            return style.position === "absolute" && rect.width === 18 && rect.height === 18 && style.touchAction === "none";
          }), "经典主题的四角拖拽区没有完整启用");
          check(getComputedStyle(resizeCorners[0]).cursor === "nwse-resize" && getComputedStyle(resizeCorners[1]).cursor === "nesw-resize", "经典主题四角没有显示缩放光标");
          const classicNorthWestRect = resizeCorners[0].getBoundingClientRect();
          check(
            document.elementFromPoint(classicNorthWestRect.left + classicNorthWestRect.width / 2, classicNorthWestRect.top + classicNorthWestRect.height / 2) === resizeCorners[0],
            "经典主题播放器左上角无法命中拖拽区"
          );
          check(toolbar.scrollWidth <= toolbar.clientWidth + 1, "经典主题最小播放器的控制栏产生横向溢出");
          check(
            classicControls.every((control) => control.getBoundingClientRect().right <= classicToolbarRect.right + 1),
            "经典主题最小播放器仍有按钮跑出控制栏右边界"
          );
          check(
            toolbar.querySelector(".evs-play-button").getBoundingClientRect().width <= 38 &&
              sourceLink.getBoundingClientRect().width <= 34 &&
              speedGroup.getBoundingClientRect().height <= 32,
            "经典主题播放器缩小时控制器没有同步收紧"
          );
          dock.style.setProperty("--evs-player-width", initialDockRect.width + "px");
          const settingsCardRectAfterThemeChange = settingsHomeItems[0].getBoundingClientRect();
          check(
            Math.abs(settingsCardRectBeforeThemeChange.width - settingsCardRectAfterThemeChange.width) <= 1 &&
              Math.abs(settingsCardRectBeforeThemeChange.height - settingsCardRectAfterThemeChange.height) <= 1,
            "切换主题后设置卡片排版尺寸发生变化"
          );
          document.body.dataset.rootHeight = String(root.getBoundingClientRect().height);
          document.body.dataset.uiTest = "pass";
        } catch (error) {
          document.body.dataset.uiTest = "fail";
          document.body.dataset.uiMessage = error instanceof Error ? error.message : String(error);
        }
      })();
    </script>
  </body></html>`;
  await writeFile(fixturePath, html, "utf8");

  const measuredRootHeights = [];
  for (const [viewportWidth, viewportHeight] of [[900, 1_000], [1_200, 1_400]]) {
    const { stdout, stderr } = await execFileAsync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--allow-file-access-from-files",
      `--user-data-dir=${profilePath}-${viewportWidth}-${viewportHeight}`,
      `--window-size=${viewportWidth},${viewportHeight}`,
      "--dump-dom",
      pathToFileURL(fixturePath).href
    ], { maxBuffer: 20 * 1024 * 1024, timeout: 20_000 });

    if (!stdout.includes('data-ui-test="pass"')) {
      const message = stdout.match(/data-ui-message="([^"]*)"/u)?.[1] ?? stderr.trim();
      throw new Error(
        `真实浏览器布局检查失败（窗口 ${viewportWidth}×${viewportHeight}px）：${message || "页面没有返回测试结果"}`
      );
    }
    measuredRootHeights.push(Number(stdout.match(/data-root-height="([^"]*)"/u)?.[1]));
  }
  if (!measuredRootHeights.every((height) => Number.isFinite(height) && height > 0)) {
    throw new Error("真实浏览器布局检查失败：无法测量展开式页面高度");
  }
  console.log("真实 Chrome DOM 固定小尺寸与可选悬浮布局检查通过。");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
