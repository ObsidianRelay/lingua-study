import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const entryPath = resolve(projectRoot, "src/main.ts");
const manifestPath = resolve(projectRoot, "manifest.json");
const visited = new Set();
const failures = [];

function runtimeImport(statement) {
  const clause = statement.importClause;
  if (!clause) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  if (clause.name) {
    return true;
  }
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    return bindings.elements.some((element) => !element.isTypeOnly);
  }
  return true;
}

async function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  if (/\.(?:png|jpe?g|gif|svg|css)$/iu.test(specifier)) {
    return null;
  }
  const base = resolve(dirname(fromPath), specifier);
  const sourceExtension = extname(base);
  const candidates = sourceExtension !== ".ts" && sourceExtension !== ".tsx"
    ? [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
    : [base];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // 继续检查其他 TypeScript 解析形式。
    }
  }
  failures.push(`${relative(projectRoot, fromPath)} 无法解析本地导入 ${specifier}`);
  return null;
}

async function visit(filePath) {
  if (visited.has(filePath)) {
    return;
  }
  visited.add(filePath);
  const source = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !runtimeImport(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (typeof specifier !== "string") {
      continue;
    }
    if (specifier.startsWith("node:")) {
      failures.push(`${relative(projectRoot, filePath)} 在移动端启动路径中导入 ${specifier}`);
      continue;
    }
    const resolved = await resolveLocalImport(filePath, specifier);
    if (resolved) {
      await visit(resolved);
    }
  }

  function inspectRequires(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      const guardedElectron =
        relative(projectRoot, filePath) === "src/bilibili-session.ts" &&
        (specifier === "electron" || specifier === "@electron/remote") &&
        source.includes("Platform.isDesktopApp ? loadElectronRemote() : null");
      if ((specifier.startsWith("node:") || specifier === "electron" || specifier === "@electron/remote") && !guardedElectron) {
        failures.push(`${relative(projectRoot, filePath)} 在移动端启动路径中调用 require(${JSON.stringify(specifier)})`);
      }
    }
    ts.forEachChild(node, inspectRequires);
  }
  inspectRequires(sourceFile);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.isDesktopOnly !== true) {
  failures.push('1.3.0 正式版仍在测试移动端，manifest.json 必须设置 "isDesktopOnly": true');
}

await visit(entryPath);

if (failures.length > 0) {
  console.error("移动端安全检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`移动端安全检查通过：${visited.size} 个启动模块未静态加载 Node.js/Electron 能力。`);
