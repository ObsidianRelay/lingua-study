import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * 与 Obsidian 官方插件模板一致的源码检查配置。
 * 构建产物和工具脚本不属于插件运行时源码，因此不参与此项检查。
 */
export default defineConfig(
  globalIgnores([
    "node_modules",
    ".test-dist",
    "main.js",
    "src/vendor",
    "esbuild.config.mjs",
    "esbuild.test.mjs",
    "scripts",
    "package.json",
    "package-lock.json",
    "versions.json"
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "manifest.json"]
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"]
      }
    }
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Electron 模块在不同 Obsidian 桌面版本中的可用位置不同，必须运行时逐一探测。
      "@typescript-eslint/no-require-imports": [
        "error",
        { allow: ["^electron$", "^@electron/remote$"] }
      ],
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          // 保留插件名和第三方项目的正式大小写。
          ignoreRegex: ["B站|Chrome|Lingua Study|Whisper|ECDICT"],
          enforceCamelCaseLower: true
        }
      ]
    }
  }
);
