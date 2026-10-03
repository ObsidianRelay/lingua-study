import esbuild from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testOutputDirectory = join(tmpdir(), "lingua-study-test-dist");
const entryPoints = (await readdir("tests"))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => join("tests", file));

await rm(testOutputDirectory, { recursive: true, force: true });

await esbuild.build({
  entryPoints,
  alias: { obsidian: join(process.cwd(), "tests/obsidian-vault-mock.ts") },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outdir: testOutputDirectory,
  entryNames: "[name]",
  outExtension: { ".js": ".cjs" },
  logLevel: "info"
});

const testFiles = (await readdir(testOutputDirectory))
  .filter((file) => file.endsWith(".test.cjs"))
  .sort()
  .map((file) => join(testOutputDirectory, file));
if (testFiles.length !== entryPoints.length) {
  throw new Error(`测试入口数量不一致：源码 ${entryPoints.length}，构建结果 ${testFiles.length}`);
}
const testResult = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

if (testResult.error) {
  throw testResult.error;
}
if (testResult.status !== 0) {
  process.exit(testResult.status ?? 1);
}
