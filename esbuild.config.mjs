import esbuild from "esbuild";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import process from "process";

const production = process.argv[2] === "production";
const thirdPartyLicenseBanner = `/*!
YTranscript MIT License
Copyright (c) 2023 Łukasz Strzępek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/`;
const builtins = [
  ...builtinModules,
  ...builtinModules
    .filter((moduleName) => !moduleName.startsWith("node:"))
    .map((moduleName) => `node:${moduleName}`)
];

const require = createRequire(import.meta.url);
const mammothSourceEntry = require.resolve("mammoth/lib/index.js");
const jsZipSourceEntry = require.resolve("jszip/lib/index.js");
const safeSchedulerEntries = new Map([
  ["immediate", fileURLToPath(new URL("./build-shims/immediate.cjs", import.meta.url))],
  ["setimmediate", fileURLToPath(new URL("./build-shims/setimmediate.cjs", import.meta.url))]
]);

// Mammoth 与 JSZip 的预构建浏览器文件内嵌了两个面向旧版 IE 的调度器。它们会
// 动态创建 <script> 并使用 new Function，触发 Obsidian 的安全审查。改用官方
// 源码入口，再把这两个纯调度依赖替换为不执行动态代码的等价实现。
const safeMammothRuntimePlugin = {
  name: "safe-mammoth-runtime",
  setup(build) {
    build.onResolve({ filter: /^mammoth$/ }, () => ({ path: mammothSourceEntry }));
    build.onResolve({ filter: /^jszip$/ }, () => ({ path: jsZipSourceEntry }));
    build.onResolve({ filter: /^(?:immediate|setimmediate)$/ }, (args) => ({
      path: safeSchedulerEntries.get(args.path)
    }));
  }
};

const inlineWhisperWorkerPlugin = {
  name: "inline-whisper-worker",
  setup(build) {
    build.onResolve({ filter: /^virtual:whisper-worker$/ }, () => ({
      path: "whisper-worker",
      namespace: "inline-whisper-worker"
    }));
    build.onLoad(
      { filter: /^whisper-worker$/, namespace: "inline-whisper-worker" },
      async () => {
        const workerBuild = await esbuild.build({
          entryPoints: ["src/whisper-worker.ts"],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2022",
          // Obsidian/Electron 的 Worker 会暴露全局 process，Transformers 因而误判为
          // Node 环境。构建时固定为 undefined，确保选择 onnxruntime-web 的 WASM 后端。
          define: { process: "undefined" },
          minify: production,
          logLevel: "silent"
        });
        const workerSource = workerBuild.outputFiles[0]?.text;
        if (!workerSource) {
          throw new Error("Whisper worker build produced no JavaScript output.");
        }
        return {
          contents: `export default ${JSON.stringify(workerSource)};`,
          loader: "js"
        };
      }
    );
  }
};

const inlinePdfWorkerPlugin = {
  name: "inline-pdf-worker",
  setup(build) {
    build.onResolve({ filter: /^virtual:pdf-worker$/ }, () => ({
      path: "pdf-worker",
      namespace: "inline-pdf-worker"
    }));
    build.onLoad(
      { filter: /^pdf-worker$/, namespace: "inline-pdf-worker" },
      async () => {
        const workerBuild = await esbuild.build({
          entryPoints: ["node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2022",
          minify: production,
          logLevel: "silent"
        });
        const workerSource = workerBuild.outputFiles[0]?.text;
        if (!workerSource) {
          throw new Error("PDF worker build produced no JavaScript output.");
        }
        return {
          contents: `export default ${JSON.stringify(workerSource)};`,
          loader: "js"
        };
      }
    );
  }
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  banner: { js: thirdPartyLicenseBanner },
  legalComments: "inline",
  treeShaking: true,
  loader: {
    ".png": "dataurl"
  },
  plugins: [safeMammothRuntimePlugin, inlineWhisperWorkerPlugin, inlinePdfWorkerPlugin],
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
