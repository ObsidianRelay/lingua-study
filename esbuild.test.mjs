import esbuild from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testOutputDirectory = join(tmpdir(), "lingua-study-test-dist");

await rm(testOutputDirectory, { recursive: true, force: true });

await esbuild.build({
  entryPoints: [
    "tests/bilibili-api-core.test.ts",
    "tests/bilibili-cache-core.test.ts",
    "tests/bilibili-session-core.test.ts",
    "tests/async-keyed-queue.test.ts",
    "tests/document-transcript-core.test.ts",
    "tests/document-import-draft.test.ts",
    "tests/ui-shell.test.ts",
    "tests/ui-layout-core.test.ts",
    "tests/settings-core.test.ts",
    "tests/legacy-whisper-cleanup.test.ts",
    "tests/local-whisper-core.test.ts",
    "tests/live-preview-core.test.ts",
    "tests/player-control-core.test.ts",
    "tests/translation-core.test.ts",
    "tests/study-core.test.ts",
    "tests/study-cache-core.test.ts",
    "tests/dictionary-core.test.ts",
    "tests/full-dictionary.test.ts",
    "tests/vocabulary-core.test.ts",
    "tests/transcript-core.test.ts",
    "tests/versioned-async-cache.test.ts",
    "tests/import-core.test.ts",
    "tests/yt-dlp-core.test.ts",
    "tests/yt-dlp-runtime.test.ts"
  ],
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
const testResult = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

if (testResult.error) {
  throw testResult.error;
}
if (testResult.status !== 0) {
  process.exit(testResult.status ?? 1);
}
