import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchTranscriptWithYtDlp } from "../src/yt-dlp";

test("yt-dlp 运行层会先查人工字幕、再读取自动字幕并清理临时文件", async (context) => {
  if (process.platform === "win32") {
    context.skip("该固定样本使用 Unix 可执行脚本，Windows 由纯函数测试覆盖路径选择。");
    return;
  }

  const folder = await mkdtemp(join(tmpdir(), "lingua-study-fake-ytdlp-"));
  const executable = join(folder, "yt-dlp");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("2026.08.13\\n");
  process.exit(0);
}
if (process.argv.includes("--write-auto-subs")) {
  const index = process.argv.indexOf("--output");
  const output = process.argv[index + 1]
    .replace("%(id)s", "abcdefghijk")
    .replace("%(ext)s", "en.json3");
  fs.writeFileSync(output, JSON.stringify({
    events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Hello from yt-dlp" }] }]
  }));
}
`;

  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o700);
  try {
    const result = await fetchTranscriptWithYtDlp(
      "https://www.youtube.com/watch?v=abcdefghijk",
      executable
    );
    assert.deepEqual(result, {
      status: "success",
      segments: [{ start: 1, end: 3, text: "Hello from yt-dlp" }]
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
