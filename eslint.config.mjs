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
  ...obsidianmd.configs.recommended
);
