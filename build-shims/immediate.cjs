"use strict";

// `immediate` 只负责异步执行一个回调。Promise 微任务在 Obsidian 支持的
// Electron 环境中稳定可用，并且不需要注入 <script>。
module.exports = function immediate(callback) {
  Promise.resolve().then(callback);
};
