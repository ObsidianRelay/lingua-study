import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import JSZip from "jszip";

const sourceFolderArgument = process.argv[2];
if (!sourceFolderArgument) {
  throw new Error(
    "用法：npm run build:dictionary-release -- <已安装词典目录> [输出 ZIP 路径]"
  );
}

const sourceFolder = resolve(sourceFolderArgument);
const indexPath = join(sourceFolder, "dictionary-index.json");
const manifest = JSON.parse(await readFile(indexPath, "utf8"));
if (
  manifest.version !== 1 ||
  manifest.project !== "skywind3000/ECDICT" ||
  typeof manifest.revision !== "string" ||
  !/^[0-9a-f]{12}$/u.test(manifest.revision) ||
  typeof manifest.sourceSha256 !== "string" ||
  !/^[0-9a-f]{64}$/u.test(manifest.sourceSha256)
) {
  throw new Error("词典索引版本或数据源信息无效。");
}

const shardKeys = [..."abcdefghijklmnopqrstuvwxyz", "other"];
const fileNames = [
  "dictionary-index.json",
  ...shardKeys.map((key) => `${key}.json.gz`)
];
const outputPath = resolve(
  process.argv[3] ?? join("release", `ecdict-${manifest.revision}.zip`)
);
const archive = new JSZip();
const fixedDate = new Date("1980-01-01T00:00:00.000Z");

for (const fileName of fileNames) {
  archive.file(fileName, await readFile(join(sourceFolder, fileName)), {
    binary: true,
    compression: "STORE",
    date: fixedDate,
    createFolders: false
  });
}

const output = await archive.generateAsync({
  type: "nodebuffer",
  compression: "STORE",
  platform: "UNIX",
  streamFiles: true
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);

const sha256 = createHash("sha256").update(output).digest("hex");
console.log(`词典发布包：${outputPath}`);
console.log(`大小：${(output.byteLength / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA-256：${sha256}`);
