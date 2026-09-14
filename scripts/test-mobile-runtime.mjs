import { createRequire } from "node:module";
import { resolve } from "node:path";
import Module from "node:module";

const projectRoot = resolve(import.meta.dirname, "..");
const bundlePath = resolve(projectRoot, "main.js");
const forbiddenLoads = [];

// pdf.js 在模块载入时会读取这两个浏览器原生对象；Node.js 测试环境需要最小替身。
class MockDOMMatrix {
  constructor(values = [1, 0, 0, 1, 0, 0]) {
    [this.a, this.b, this.c, this.d, this.e, this.f] = values;
  }

  translate() { return this; }
  scale() { return this; }
  invertSelf() { return this; }
  multiplySelf() { return this; }
}

class MockPath2D {
  addPath() {}
  rect() {}
}

globalThis.DOMMatrix ??= MockDOMMatrix;
globalThis.Path2D ??= MockPath2D;

class MockElement {
  constructor() {
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    };
    this.dataset = {};
    this.style = {};
    this.isConnected = true;
  }

  addClass() {}
  removeClass() {}
  setCssProps() {}
  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  empty() {}
  setText() {}
  createDiv() { return new MockElement(); }
  createEl() { return new MockElement(); }
  createSpan() { return new MockElement(); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const mockWorkspace = {
  containerEl: {
    ownerDocument: {
      body: new MockElement()
    }
  },
  on() { return { unload() {} }; },
  getActiveFile() { return null; },
  getActiveViewOfType() { return null; },
  getLeavesOfType() { return []; }
};

const mockApp = {
  workspace: mockWorkspace,
  vault: {
    getAbstractFileByPath() { return null; },
    getConfig() { return false; }
  },
  metadataCache: {},
  fileManager: {}
};

class Plugin {
  constructor() {
    this.app = mockApp;
  }

  async loadData() { return null; }
  async saveData() {}
  registerView() {}
  registerEvent() {}
  registerMarkdownCodeBlockProcessor() {}
  addSettingTab() {}
  addCommand() {}
  addRibbonIcon() { return new MockElement(); }
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = new MockElement();
  }
}

class Modal {
  constructor(app) {
    this.app = app;
    this.titleEl = new MockElement();
    this.contentEl = new MockElement();
  }

  open() {}
  close() {}
}

class ItemView {}
class MarkdownView {}
class MarkdownRenderChild {}
class TFile {}
class TFolder {}
class Notice {}
class SecretComponent {}

const obsidianMock = new Proxy({
  Plugin,
  PluginSettingTab,
  Modal,
  ItemView,
  MarkdownView,
  MarkdownRenderChild,
  TFile,
  TFolder,
  Notice,
  SecretComponent,
  Platform: {
    isDesktopApp: false,
    isMobile: true,
    isIosApp: true,
    isAndroidApp: false
  },
  addIcon() {},
  setIcon() {},
  normalizePath(path) { return path; },
  parseYaml() { return {}; },
  requestUrl() {
    throw new Error("移动端启动阶段不应发出网络请求。");
  }
}, {
  get(target, property) {
    return property in target ? target[property] : class {};
  }
});

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return obsidianMock;
  }
  if (
    request === "electron" ||
    request === "@electron/remote" ||
    request.startsWith("node:")
  ) {
    forbiddenLoads.push(request);
    throw new Error(`移动端启动错误加载了桌面模块：${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const require = createRequire(import.meta.url);
  const loaded = require(bundlePath);
  const PluginClass = loaded.default ?? loaded;
  const plugin = new PluginClass();
  await plugin.onload();

  if (!plugin.capabilities.mobile || plugin.capabilities.desktop) {
    throw new Error("构建产物没有进入移动端能力分支。");
  }
  if (
    plugin.fullDictionaryService !== null ||
    plugin.bilibiliCacheService !== null ||
    plugin.localWhisperService !== null
  ) {
    throw new Error("移动端启动后仍创建了桌面专属服务。");
  }
  const bilibiliStatus = await plugin.bilibiliSessionService.getStatus();
  if (bilibiliStatus.supported) {
    throw new Error("移动端错误启用了 Electron B 站登录能力。");
  }
  plugin.onunload();

  if (forbiddenLoads.length > 0) {
    throw new Error(`移动端启动加载了桌面模块：${forbiddenLoads.join(", ")}`);
  }
  console.log("移动端运行时冒烟测试通过：插件已完成 onload/onunload，未加载 Node.js/Electron 桌面模块。");
} finally {
  Module._load = originalLoad;
}
