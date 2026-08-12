import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const failures = [];

const requiredFiles = [
  "README.md",
  "LICENSE",
  "manifest.json",
  "versions.json",
  "package.json",
  "package-lock.json",
  "styles.css",
  "src/main.ts"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const versions = readJson("versions.json");

if (manifest.id !== "lingua-study") {
  failures.push("manifest.json id must be lingua-study");
}
if (manifest.name !== "Lingua Study") {
  failures.push("manifest.json name must be Lingua Study");
}
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) {
  failures.push("manifest.json version must use x.y.z format");
}
if (manifest.author !== "xiaobai") {
  failures.push("manifest.json author must be xiaobai");
}
if (manifest.authorUrl !== "https://github.com/ObsidianRelay") {
  failures.push("manifest.json authorUrl does not match the public GitHub account");
}
if (packageJson.version !== manifest.version || packageLock.version !== manifest.version) {
  failures.push("manifest, package, and lockfile versions must match");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  failures.push("versions.json must map the release version to minAppVersion");
}
if (fs.existsSync(path.join(root, "data.json"))) {
  failures.push("data.json is local configuration and must not be included");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Release metadata is consistent for Lingua Study ${manifest.version}.`);
}
