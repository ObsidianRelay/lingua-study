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
    <div class="evs-segment${index === 4 ? " is-active" : ""}">
      <button class="evs-timestamp">00:${String(index * 2).padStart(2, "0")}</button>
      <div class="evs-segment-content">
        <div class="evs-segment-text"><span class="evs-dictionary-word${index === 0 ? " is-dictionary-active" : ""}">Subtitle</span> <span class="evs-dictionary-word">row</span> ${index + 1}</div>
        ${index === 4 ? `<div class="evs-translation-text" id="extension-card">
          <div class="evs-study-section"><div class="evs-study-heading">中文译文</div><div>这是一条用于检查延伸拓展布局的中文译文。</div></div>
          <div class="evs-study-section evs-study-extensions"><div class="evs-study-heading">延伸拓展</div><div class="evs-study-extension-list">
            <div class="evs-study-extension-item"><div class="evs-study-extension-anchor">由原句中的“Subtitle”延伸</div><div class="evs-study-extension-title"><strong>subtitle track</strong>：字幕轨道</div><div class="evs-study-note">由字幕这一主题延伸出的常见媒体表达。</div><div class="evs-study-extension-example"><div lang="en">Choose the correct subtitle track before playing the video.</div><div lang="zh-CN">播放视频前请选择正确的字幕轨道。</div></div></div>
          </div></div>
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
    .theme-light { --background-primary: #fff; --background-secondary: #f4f4f4; --background-primary-alt: #eee; --background-modifier-border: #ccc; --text-normal: #222; --text-muted: #666; --text-error: #b22; --text-success: #287d3c; --text-highlight-bg: #ffe9a8; --interactive-accent: #b23b3b; --interactive-normal: #f3f3f3; --text-on-accent: #fff; --tag-background: #eee; --tag-color: #333; --shadow-s: 0 1px 3px rgba(0,0,0,.16); }
    .theme-dark { --background-primary: #202020; --background-secondary: #2b2b2b; --background-primary-alt: #303030; --background-modifier-border: #555; --text-normal: #eee; --text-muted: #aaa; --text-error: #ff7373; --text-success: #64c779; --text-highlight-bg: #66521e; --interactive-accent: #c45b5b; --interactive-normal: #333; --text-on-accent: #fff; --tag-background: #444; --tag-color: #eee; --shadow-s: 0 1px 3px rgba(0,0,0,.4); }
    ${css}
  </style></head>
  <body class="theme-light"><div id="app-layout">
    <div id="viewport"><div id="column"><div id="host"><div class="evs-root" id="root">
      <div class="evs-player-dock" id="dock">
        <div class="evs-player-stage" id="stage">
          <div class="evs-player-frame" id="player-frame"></div>
          <div class="evs-player-utilities" id="utilities">
            <button class="evs-button evs-icon-button evs-floating-toggle" id="floating-toggle" aria-label="让视频保持在当前画面中" aria-pressed="false"><svg class="svg-icon"></svg></button>
          </div>
        </div>
        <div class="evs-toolbar" id="toolbar">
          <div class="evs-primary-controls">
            <button class="evs-button evs-icon-button evs-play-button" aria-label="播放"><svg class="svg-icon"></svg></button>
            <button class="evs-button evs-icon-button evs-seek-button" aria-label="后退 5 秒"><svg class="svg-icon"></svg><span class="evs-seek-seconds">5s</span></button>
            <button class="evs-button evs-icon-button evs-seek-button" aria-label="前进 5 秒"><svg class="svg-icon"></svg><span class="evs-seek-seconds">5s</span></button>
          </div>
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
        <div class="evs-transcript" id="transcript"><div class="evs-segment-action-dock" id="segment-action-dock"><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button><button class="evs-icon-button evs-transcript-icon-button"><svg class="svg-icon"></svg></button></div>${rowMarkup}<div class="evs-transcript-end-spacer" id="spacer"></div></div>
    </div></div></div></div>
    <aside id="dictionary" class="lingua-dictionary-view">
      <div class="lingua-dictionary-header"><h3>Lingua Study</h3><span class="lingua-dictionary-source">23,596 词条</span></div>
      <div class="lingua-dictionary-tabs"><button class="is-active">查词</button><button>生词本</button><button>今日复习 12</button></div>
      <div class="lingua-dictionary-body" id="dictionary-body">
        <form class="lingua-dictionary-search"><input value="antidepressants"><button>查询</button></form>
        <div class="lingua-dictionary-profile"><label>学习目标</label><select><option>四级</option></select></div>
        <div class="lingua-dictionary-result">
          <div class="lingua-dictionary-word-row"><div><h2>antidepressant</h2><div class="lingua-dictionary-phonetic">/ˌæntidɪˈpresənt/</div></div><div class="lingua-dictionary-word-actions"><button class="lingua-dictionary-icon-button"></button><button class="lingua-dictionary-icon-button is-saved"></button></div></div>
          <div class="lingua-dictionary-tags"><span class="is-current">四级</span><span>雅思</span></div>
          <div class="lingua-dictionary-section"><div class="lingua-dictionary-section-title">中文释义</div><div>${"抗抑郁药；用于治疗抑郁症的药物。".repeat(80)}</div></div>
          <div class="lingua-dictionary-context"><div class="lingua-dictionary-section-title">所在原句</div><div>${"So when people find out that I study antidepressants, they often ask, how do they work? ".repeat(20)}</div></div>
        </div>
      </div>
    </aside></div>
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
    <script>
      (() => {
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        try {
          const viewport = document.getElementById("viewport");
          const host = document.getElementById("host");
          const root = document.getElementById("root");
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
          const rows = Array.from(list.querySelectorAll(".evs-segment"));
          const dictionary = document.getElementById("dictionary");
          const dictionaryBody = document.getElementById("dictionary-body");
          const dictionaryTabs = Array.from(dictionary.querySelectorAll(".lingua-dictionary-tabs button"));
          const importModal = document.getElementById("import-modal");

          // 复现运行代码对代码块容器执行的“铺满阅读视图”计算。
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
          const activeTabStyle = getComputedStyle(dictionaryTabs[0]);
          const inactiveTabStyle = getComputedStyle(dictionaryTabs[1]);
          check(activeTabStyle.backgroundColor !== inactiveTabStyle.backgroundColor, "当前词典页面缺少明确的实心高亮");
          check(activeTabStyle.color !== inactiveTabStyle.color, "当前词典页面的文字颜色没有形成对比");
          check(Number(activeTabStyle.fontWeight) >= 700, "当前词典页面的字重提示过弱");
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
          check(
            getComputedStyle(dictionaryTabs[0]).backgroundColor !== getComputedStyle(dictionaryTabs[1]).backgroundColor,
            "深色主题下当前词典页面高亮不明显"
          );
          document.body.classList.replace("theme-dark", "theme-light");
          dictionaryBody.innerHTML = '<div class="lingua-vocabulary-stats"><span>共 4 个生词</span><span>当前显示 4 个</span></div><div class="lingua-vocabulary-list">' + ['wisdom', 'bother', 'anything', 'focus'].map((word) => '<button class="lingua-vocabulary-list-item"><div class="lingua-vocabulary-list-heading"><strong>' + word + '</strong><span>下次 2026/8/22</span></div><div class="lingua-vocabulary-list-meaning">n. 这是一条用于验证列表不会互相覆盖的完整释义</div><div class="lingua-vocabulary-list-meta"><span>1 个语境</span><span>四级 · 六级 · 雅思</span></div></button>').join('') + '</div>';
          const vocabularyItems = Array.from(dictionaryBody.querySelectorAll(".lingua-vocabulary-list-item"));
          check(vocabularyItems.length === 4, "生词本测试卡片没有完整渲染");
          check(vocabularyItems.every((item) => item.clientHeight + 1 >= item.scrollHeight), "Obsidian 固定按钮高度仍在裁切生词卡");
          check(vocabularyItems.every((item, index) => index === 0 || item.getBoundingClientRect().top >= vocabularyItems[index - 1].getBoundingClientRect().bottom + 6), "生词卡内容仍与下一条重叠");
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
          check(segmentActionDock.querySelectorAll("button").length === 2, "字幕共用操作栏不是两个按钮");
          check(rows.every((row) => row.querySelectorAll("button:not(.evs-timestamp)").length === 0), "字幕行仍在重复显示操作按钮");
          check(extensionCard && extensionCard.offsetParent !== null, "延伸拓展知识卡没有默认展开");
          check(extensionCard.clientHeight + 1 >= extensionCard.scrollHeight, "延伸拓展知识卡内容被裁切");
          check(status.getBoundingClientRect().height === 0, "就绪状态没有完全收起");
          check(
            rows.every((row) => row.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1),
            "存在超出播放器根容器、被隐藏的字幕"
          );
          check(viewport.scrollHeight > viewport.clientHeight, "长字幕没有交给整页滚动");
          check(
            Math.abs(initialDockRect.width - Math.min(root.clientWidth, 680)) <= 1,
            "播放器没有保持统一的小尺寸：dock=" + initialDockRect.width +
              ", root=" + rootRect.width +
              ", expected=" + Math.min(root.clientWidth, 680)
          );
          check(
            Math.abs(initialDockRect.left - (rootRect.left + (rootRect.width - initialDockRect.width) / 2)) <= 1,
            "小尺寸播放器没有在页面中居中"
          );
          check(toolbar.getBoundingClientRect().height <= 43, "播放器工具栏仍然过高");
          check(
            Math.abs(playerFrame.getBoundingClientRect().width - stage.getBoundingClientRect().width) <= 1,
            "右上角按钮仍然缩小了视频画面"
          );
          const utilityStyle = getComputedStyle(utilities);
          const utilityRect = utilities.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          check(utilityStyle.position === "absolute", "视频辅助按钮没有悬浮在画面上");
          check(
            Math.abs(utilityRect.left - stageRect.right) <= 1 &&
              Math.abs(utilityRect.top - stageRect.top) <= 1,
            "视频置顶按钮没有零间距贴合视频右上角外侧"
          );
          check(floatingToggle.closest(".evs-player-utilities") === utilities, "视频置顶按钮位置异常");
          check(toolbar.contains(sourceLink), "打开原视频没有移动到播放器底栏");
          check(sourceLink.previousElementSibling === speedGroup, "打开原视频没有放在倍速滑块后面");
          check(!utilities.contains(sourceLink), "打开原视频仍在视频右上角");
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
          check(speedGroup.getBoundingClientRect().height === 34, "倍速轨道没有保持原来的高度");
          check(getComputedStyle(speedThumb).transitionDuration !== "0s", "选中滑块缺少移动动画");
          check(
            sourceLink.getBoundingClientRect().left - speedGroup.getBoundingClientRect().right >= 7,
            "打开原视频按钮仍与倍速轨道连在一起"
          );
          check(
            getComputedStyle(sourceLink).boxShadow.includes("inset") &&
              sourceLink.getBoundingClientRect().width === 32 &&
              sourceLink.getBoundingClientRect().height === 32,
            "打开原视频按钮没有使用完整四边内描边"
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

          status.classList.remove("is-collapsed");
          check(status.getBoundingClientRect().height > 0, "本地状态没有正常显示");
          check(root.getBoundingClientRect().height > initialRootHeight, "状态展开后页面没有自然增高");
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
