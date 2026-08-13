import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "process";

const production = process.argv[2] === "production";
const builtins = [
  ...builtinModules,
  ...builtinModules
    .filter((moduleName) => !moduleName.startsWith("node:"))
    .map((moduleName) => `node:${moduleName}`)
];

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
