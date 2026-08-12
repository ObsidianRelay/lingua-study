import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting
} from "obsidian";
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

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Lingua Study 翻译")
      .setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "只有点击某个句子的翻译按钮时，插件才会把该句英文发送给所选服务。API Key 保存在 Obsidian 安全凭据库中。"
    });

    new Setting(containerEl)
      .setName("翻译服务")
      .setDesc("第一版支持 DeepSeek 官方接口和 OpenAI Chat Completions 兼容中转站。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("disabled", "关闭翻译")
          .addOption("deepseek", "DeepSeek 官方")
          .addOption("openai-compatible", "OpenAI 兼容中转站")
          .setValue(settings.translationProvider)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              translationProvider: value as TranslationProvider
            });
            this.display();
          });
      });

    if (settings.translationProvider === "deepseek") {
      this.renderDeepSeekSettings(containerEl);
    }

    if (settings.translationProvider === "openai-compatible") {
      this.renderCustomProviderSettings(containerEl);
    }

    new Setting(containerEl)
      .setName("保存翻译缓存")
      .setDesc("开启后，翻译结果保存在字幕文件旁边的独立 JSON 中；重新打开笔记时仍默认隐藏。")
      .addToggle((toggle) => {
        toggle.setValue(settings.cacheTranslations).onChange(async (value) => {
          await this.plugin.updateSettings({ cacheTranslations: value });
        });
      });

    if (settings.translationProvider !== "disabled") {
      this.renderConnectionTest(containerEl);
    }

    containerEl.createEl("p", {
      cls: "setting-item-description evs-settings-footnote",
      text: "注意：测试连接和实际翻译都可能产生少量 API 费用。第三方中转站会收到你主动翻译的英文句子，请只使用你信任的服务。"
    });
  }

  private renderDeepSeekSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("DeepSeek 官方")
      .setHeading();

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("官方固定地址，不会保存到插件配置中。")
      .addText((text) => {
        text.setValue("https://api.deepseek.com").setDisabled(true);
      });

    new Setting(containerEl)
      .setName("模型")
      .setDesc("Flash 速度更快、成本更低；Pro 能力更强。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("deepseek-v4-flash", "DeepSeek V4 Flash")
          .addOption("deepseek-v4-pro", "DeepSeek V4 Pro")
          .setValue(this.plugin.settings.deepSeekModel)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ deepSeekModel: value as DeepSeekModel });
          });
      });

    const secretSetting = new Setting(containerEl)
      .setName("DeepSeek API Key")
      .setDesc("选择已有安全凭据，或在控件中创建一个新的凭据；插件配置只记录凭据名称。");
    new SecretComponent(this.app, secretSetting.controlEl)
      .setValue(this.plugin.settings.deepSeekSecretId)
      .onChange(async (value) => {
        await this.plugin.updateSettings({ deepSeekSecretId: value });
      });
  }

  private renderCustomProviderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("OpenAI 兼容中转站")
      .setHeading();

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("例如 https://example.com/v1；也可以填写完整的 /chat/completions 地址。")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com/v1")
          .setValue(this.plugin.settings.customBaseUrl)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ customBaseUrl: value.trim() });
          });
      });

    new Setting(containerEl)
      .setName("模型名称")
      .setDesc("填写中转站提供的准确模型 ID。")
      .addText((text) => {
        text
          .setPlaceholder("例如 deepseek-v4-flash")
          .setValue(this.plugin.settings.customModel)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ customModel: value.trim() });
          });
      });

    const secretSetting = new Setting(containerEl)
      .setName("中转站 API Key")
      .setDesc("该凭据与 DeepSeek 官方凭据分开保存，切换服务时不会互相覆盖。");
    new SecretComponent(this.app, secretSetting.controlEl)
      .setValue(this.plugin.settings.customSecretId)
      .onChange(async (value) => {
        await this.plugin.updateSettings({ customSecretId: value });
      });
  }

  private renderConnectionTest(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("发送固定短句 “Thank you for using Lingua Study.”，不会读取当前笔记。")
      .addButton((button) => {
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
}
