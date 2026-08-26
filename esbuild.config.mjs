import esbuild from "esbuild";
import { builtinModules } from "node:module";
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
  plugins: [inlineWhisperWorkerPlugin, inlinePdfWorkerPlugin],
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
