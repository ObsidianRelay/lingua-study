"use strict";

// JSZip 通过副作用导入 `setimmediate`。这里提供相同的全局接口，同时保留
// clearImmediate 取消能力，避免旧实现动态创建 <script> 或执行字符串代码。
const root = globalThis;

if (typeof root.setImmediate !== "function") {
  let nextHandle = 1;
  const pending = new Map();

  root.setImmediate = (callback, ...args) => {
    if (typeof callback !== "function") {
      throw new TypeError("setImmediate callback must be a function");
    }
    const handle = nextHandle;
    nextHandle += 1;
    pending.set(handle, true);
    Promise.resolve().then(() => {
      if (!pending.delete(handle)) {
        return;
      }
      callback(...args);
    });
    return handle;
  };

  root.clearImmediate = (handle) => {
    pending.delete(handle);
  };
}
