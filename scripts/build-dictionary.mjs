import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createInterface } from "node:readline";

const SOURCE_REVISION = "bc015ed2e24a";
const SOURCE_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf";
const FREQUENCY_LIMIT = 20_000;
const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("用法：node scripts/build-dictionary.mjs <ecdict.csv 路径>");
}

async function calculateSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

const actualSha256 = await calculateSha256(sourcePath);
if (actualSha256 !== SOURCE_SHA256) {
  throw new Error(
    `ECDICT 数据版本校验失败：期望 ${SOURCE_SHA256}，实际 ${actualSha256}`
  );
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current.replace(/\r$/u, ""));
  return fields;
}

function normalizeWord(value) {
  return value
    .normalize("NFKC")
    .replace(/[’]/gu, "'")
    .trim()
    .toLocaleLowerCase("en-US");
}

function cleanField(value) {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "")
    .trim();
}

function positiveRank(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function shardKey(word) {
  const first = word[0] ?? "";
  return /^[a-z]$/u.test(first) ? first : "other";
}

function parseExchange(value) {
  const forms = [];
  for (const part of value.split("/")) {
    const separator = part.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const code = part.slice(0, separator);
    const form = normalizeWord(part.slice(separator + 1));
    if (/^[01spdi3rt]$/u.test(code) && form !== "") {
      forms.push([code, form]);
    }
  }
  return forms;
}

const entries = new Map();
const input = createInterface({
  input: createReadStream(sourcePath, { encoding: "utf8" }),
  crlfDelay: Infinity
});

let headerSeen = false;
for await (const line of input) {
  if (!headerSeen) {
    headerSeen = true;
    continue;
  }
  const fields = parseCsvLine(line);
  if (fields.length < 13) {
    continue;
  }
  const [rawWord, phonetic, definition, translation, pos, _collins, _oxford, rawTags, bnc, frq, exchange] = fields;
  const word = cleanField(rawWord);
  const normalized = normalizeWord(word);
  const chinese = cleanField(translation);
  if (
    normalized === "" ||
    chinese === "" ||
    !/^[a-z][a-z'’.-]*(?: [a-z][a-z'’.-]*){0,3}$/iu.test(word)
  ) {
    continue;
  }

  const tags = rawTags.trim().split(/\s+/u).filter((tag) =>
    tag === "cet4" || tag === "cet6" || tag === "ielts"
  );
  const bncRank = positiveRank(bnc);
  const frequencyRank = positiveRank(frq);
  if (
    tags.length === 0 &&
    !(bncRank > 0 && bncRank <= FREQUENCY_LIMIT) &&
    !(frequencyRank > 0 && frequencyRank <= FREQUENCY_LIMIT)
  ) {
    continue;
  }

  const packed = [
    word,
    cleanField(phonetic),
    cleanField(definition),
    chinese,
    cleanField(pos),
    tags,
    bncRank,
    frequencyRank,
    cleanField(exchange)
  ];
  const existing = entries.get(normalized);
  if (!existing || JSON.stringify(packed).length > JSON.stringify(existing).length) {
    entries.set(normalized, packed);
  }
}

const shards = new Map();
for (const key of [..."abcdefghijklmnopqrstuvwxyz", "other"]) {
  shards.set(key, { entries: {}, aliases: {} });
}

for (const [normalized, entry] of entries) {
  shards.get(shardKey(normalized)).entries[normalized] = entry;
}

for (const [lemma, entry] of entries) {
  for (const [_code, form] of parseExchange(entry[8])) {
    if (form !== lemma && !entries.has(form)) {
      shards.get(shardKey(form)).aliases[form] = lemma;
    }
  }
}

const compressed = {};
let rawBytes = 0;
let gzipBytes = 0;
for (const [key, shard] of shards) {
  const json = JSON.stringify(shard);
  const zipped = gzipSync(json, { level: 9 });
  compressed[key] = zipped.toString("base64");
  rawBytes += Buffer.byteLength(json);
  gzipBytes += zipped.byteLength;
}

const source = `// 此文件由 scripts/build-dictionary.mjs 生成，请勿手工编辑。
export const DICTIONARY_SOURCE = ${JSON.stringify({
  project: "skywind3000/ECDICT",
  revision: SOURCE_REVISION,
  sha256: SOURCE_SHA256,
  frequencyLimit: FREQUENCY_LIMIT,
  entryCount: entries.size
}, null, 2)} as const;

export const DICTIONARY_SHARDS: Readonly<Record<string, string>> = ${JSON.stringify(compressed, null, 2)};
`;

await writeFile("src/dictionary-data.generated.ts", source, "utf8");
console.log(JSON.stringify({
  entries: entries.size,
  aliases: [...shards.values()].reduce((total, shard) => total + Object.keys(shard.aliases).length, 0),
  rawBytes,
  gzipBytes,
  base64Bytes: Object.values(compressed).reduce((total, value) => total + value.length, 0)
}, null, 2));
