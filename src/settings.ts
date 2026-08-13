import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type LinguaStudyPlugin from "./main";
import type { DeepSeekModel, TranslationProvider } from "./translation-core";

export interface LinguaStudySettings {
  translationProvider: TranslationProvider;
  deepSeekModel: DeepSeekModel;
  deepSeekSecretId: string;
  customBaseUrl: string;
  customModel: string;
  customSecretId: string;
  cacheTranslations: boolean;
}

export const DEFAULT_SETTINGS: LinguaStudySettings = {
  translationProvider: "disabled",
  deepSeekModel: "deepseek-v4-flash",
  deepSeekSecretId: "",
  customBaseUrl: "",
  customModel: "",
  customSecretId: "",
  cacheTranslations: true
};

/** 读取旧配置或手工修改过的配置时，只接受插件明确支持的字段和值。 */
export function sanitizeSettings(value: unknown): LinguaStudySettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const data = value as Record<string, unknown>;
  const provider = data.translationProvider;
  const model = data.deepSeekModel;

  return {
    translationProvider:
      provider === "deepseek" || provider === "openai-compatible" || provider === "disabled"
        ? provider
        : DEFAULT_SETTINGS.translationProvider,
    deepSeekModel:
      model === "deepseek-v4-flash" || model === "deepseek-v4-pro"
        ? model
        : DEFAULT_SETTINGS.deepSeekModel,
    deepSeekSecretId: typeof data.deepSeekSecretId === "string" ? data.deepSeekSecretId : "",
    customBaseUrl: typeof data.customBaseUrl === "string" ? data.customBaseUrl : "",
    customModel: typeof data.customModel === "string" ? data.customModel : "",
    customSecretId: typeof data.customSecretId === "string" ? data.customSecretId : "",
    cacheTranslations:
      typeof data.cacheTranslations === "boolean"
        ? data.cacheTranslations
        : DEFAULT_SETTINGS.cacheTranslations
  };
}

export class LinguaStudySettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LinguaStudyPlugin) {
    super(app, plugin);
  }

  /**
   * Obsidian 1.13+ 的声明式设置接口。
   * 设置由 Obsidian 统一渲染和建立搜索索引，条件项会随翻译服务切换显示。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "翻译",
        items: [
          {
            name: "翻译服务",
            desc: "只有点击句子的翻译按钮时，才会把该句英文发送给所选服务。",
            control: {
              type: "dropdown",
              key: "translationProvider",
              defaultValue: DEFAULT_SETTINGS.translationProvider,
              options: {
                disabled: "关闭翻译",
                deepseek: "DeepSeek 官方",
                "openai-compatible": "OpenAI 兼容中转站"
              }
            }
          }
        ]
      },
      {
        type: "group",
        heading: "DeepSeek 官方",
        visible: () => this.plugin.settings.translationProvider === "deepseek",
        items: [
          {
            name: "API 地址",
            desc: "官方固定地址，不会保存到插件配置中。",
            render: (setting) => {
              setting.addText((text) => {
                text.setValue("https://api.deepseek.com").setDisabled(true);
              });
            }
          },
          {
            name: "模型",
            desc: "Flash 速度更快、成本更低；Pro 能力更强。",
            control: {
              type: "dropdown",
              key: "deepSeekModel",
              defaultValue: DEFAULT_SETTINGS.deepSeekModel,
              options: {
                "deepseek-v4-flash": "DeepSeek V4 Flash",
                "deepseek-v4-pro": "DeepSeek V4 Pro"
              }
            }
          },
          {
            name: "DeepSeek API Key",
            desc: "选择已有安全凭据，或在控件中创建新凭据；插件配置只记录凭据名称。",
            render: (setting) => {
              new SecretComponent(this.app, setting.controlEl)
                .setValue(this.plugin.settings.deepSeekSecretId)
                .onChange(async (value) => {
                  await this.plugin.updateSettings({ deepSeekSecretId: value });
                });
            }
          }
        ]
      },
      {
        type: "group",
        heading: "OpenAI 兼容中转站",
        visible: () => this.plugin.settings.translationProvider === "openai-compatible",
        items: [
          {
            name: "API 地址",
            desc: "例如 https://example.com/v1；也可以填写完整的 /chat/completions 地址。",
            control: {
              type: "text",
              key: "customBaseUrl",
              placeholder: "https://example.com/v1"
            }
          },
          {
            name: "模型名称",
            desc: "填写中转站提供的准确模型 ID。",
            control: {
              type: "text",
              key: "customModel",
              placeholder: "例如 deepseek-v4-flash"
            }
          },
          {
            name: "中转站 API Key",
            desc: "该凭据与 DeepSeek 官方凭据分开保存，切换服务时不会互相覆盖。",
            render: (setting) => {
              new SecretComponent(this.app, setting.controlEl)
                .setValue(this.plugin.settings.customSecretId)
                .onChange(async (value) => {
                  await this.plugin.updateSettings({ customSecretId: value });
                });
            }
          }
        ]
      },
      {
        type: "group",
        heading: "通用选项",
        items: [
          {
            name: "保存翻译缓存",
            desc: "开启后，翻译结果保存在字幕文件旁边的独立 JSON 中；重新打开笔记时仍默认隐藏。",
            control: {
              type: "toggle",
              key: "cacheTranslations",
              defaultValue: DEFAULT_SETTINGS.cacheTranslations
            }
          },
          {
            name: "测试连接",
            desc: "发送固定短句 “Thank you for using Lingua Study.”，不会读取当前笔记。",
            visible: () => this.plugin.settings.translationProvider !== "disabled",
            render: (setting) => {
              setting.addButton((button) => {
                button.setButtonText("测试连接").onClick(async () => {
                  button.setDisabled(true).setButtonText("测试中…");
                  try {
                    const result = await this.plugin.testTranslationConnection();
                    new Notice(`连接成功：${result}`);
                  } catch (error) {
                    const message = error instanceof Error ? error.message : "测试连接失败。";
                    new Notice(message, 6_000);
                  } finally {
                    button.setDisabled(false).setButtonText("测试连接");
                  }
                });
              });
            }
          },
          {
            name: "隐私与费用提醒",
            desc: "API Key 保存在 Obsidian 安全凭据库中。测试连接和实际翻译可能产生少量费用；第三方中转站会收到你主动翻译的英文句子，请只使用可信服务。"
          }
        ]
      }
    ];
  }

  /** 明确读取插件自己的设置，避免把值误写到 Obsidian 的全局配置。 */
  getControlValue(key: string): unknown {
    if (key in this.plugin.settings) {
      return this.plugin.settings[key as keyof LinguaStudySettings];
    }
    return undefined;
  }

  /** 对声明式控件的值做类型校验、清理并保存。 */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (
      key === "translationProvider" &&
      (value === "disabled" || value === "deepseek" || value === "openai-compatible")
    ) {
      await this.plugin.updateSettings({ translationProvider: value });
      this.refreshDomState();
      return;
    }

    if (
      key === "deepSeekModel" &&
      (value === "deepseek-v4-flash" || value === "deepseek-v4-pro")
    ) {
      await this.plugin.updateSettings({ deepSeekModel: value });
      return;
    }

    if (key === "customBaseUrl" && typeof value === "string") {
      await this.plugin.updateSettings({ customBaseUrl: value.trim() });
      return;
    }

    if (key === "customModel" && typeof value === "string") {
      await this.plugin.updateSettings({ customModel: value.trim() });
      return;
    }

    if (key === "cacheTranslations" && typeof value === "boolean") {
      await this.plugin.updateSettings({ cacheTranslations: value });
    }
  }
}
