import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  SecretComponent,
  type Setting
} from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import type LinguaStudyPlugin from "./main";
import { DEFAULT_TRANSCRIPT_FOLDER, sanitizeTranscriptFolder } from "./import-core";
import {
  DEFAULT_SETTINGS,
  type InterfaceTheme,
  type LinguaStudySettings
} from "./settings-core";
import {
  isStudyProfile,
  STUDY_PROFILE_LONG_LABELS
} from "./study-core";
import { DICTIONARY_SOURCE } from "./dictionary-core";
import {
  CUSTOM_DICTIONARY_JSON_TEMPLATE,
  CUSTOM_DICTIONARY_TEMPLATE,
  CUSTOM_DICTIONARY_TSV_TEMPLATE
} from "./custom-dictionary-core";
import {
  MAX_FSRS_REQUEST_RETENTION,
  MIN_FSRS_REQUEST_RETENTION,
  getDailyReviewSummary
} from "./vocabulary-core";

export {
  DEFAULT_DESKTOP_PLAYER_WIDTH,
  DEFAULT_SETTINGS,
  MAX_DESKTOP_PLAYER_WIDTH,
  MIN_DESKTOP_PLAYER_WIDTH,
  sanitizeSettings,
  type LinguaStudySettings
} from "./settings-core";

class ClearWhisperAlignmentCacheModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("清除本地 Whisper 对齐缓存？");
    this.contentEl.createEl("p", {
      text: "这只会删除本地语音模型和运行文件，不会删除视频、字幕、翻译或笔记。下次使用本地自动对齐时需要重新下载。"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const confirm = actions.createEl("button", { cls: "mod-warning", text: "确认清除" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    confirm.addEventListener("click", () => {
      confirm.disabled = true;
      void this.onConfirm().then(() => {
        new Notice("本地 Whisper 对齐缓存已清除。", 5_000);
        this.close();
      }).catch(() => {
        confirm.disabled = false;
        new Notice("缓存清除失败，请重新加载插件后重试。", 6_000);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ClearFullDictionaryModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("删除 ECDICT 完整版？");
    this.contentEl.createEl("p", {
      text: "删除后会立即恢复使用内置精简版，不会删除生词本、复习记录、字幕或翻译内容。以后仍可重新下载。"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const confirm = actions.createEl("button", { cls: "mod-warning", text: "确认删除" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    confirm.addEventListener("click", () => {
      confirm.disabled = true;
      void this.onConfirm().then(() => this.close()).catch((error) => {
        confirm.disabled = false;
        new Notice(error instanceof Error ? error.message : "完整版词典删除失败。", 6_000);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FullDictionaryUpdateModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("更新 ECDICT 完整词典？");
    this.contentEl.createEl("p", {
      text: "检测到 ECDICT 完整词典有新版本，更新后将支持“初中英语”和“高中英语”标签。是否现在更新？"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const update = actions.createEl("button", { cls: "mod-cta", text: "立即更新" });
    actions.createEl("button", { text: "稍后再说" }).addEventListener("click", () => this.close());
    update.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ClearCustomDictionaryModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("删除自定义词典？");
    this.contentEl.createEl("p", {
      text: "只会删除已导入的自定义词典，不会删除 ECDICT、生词本、复习记录、字幕或翻译内容。"
    });
    const actions = this.contentEl.createDiv({ cls: "lingua-study-import-actions" });
    const confirm = actions.createEl("button", { cls: "mod-warning", text: "确认删除" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    confirm.addEventListener("click", () => {
      confirm.disabled = true;
      void this.onConfirm().then(() => this.close()).catch((error) => {
        confirm.disabled = false;
        new Notice(error instanceof Error ? error.message : "自定义词典删除失败。", 6_000);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class LinguaStudySettingTab extends PluginSettingTab {
  private readonly bilibiliStatusEls = new Set<HTMLElement>();
  private dictionaryUpdatePromptHandled = false;

  constructor(app: App, private readonly plugin: LinguaStudyPlugin) {
    super(app, plugin);
    this.containerEl.addClass("lingua-study-settings");
  }

  /** 顶层按学习与导入分组；六个原生子页面仍参与 Obsidian 设置搜索。 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Lingua Study",
        searchable: false,
        render: (setting) => {
          setting.settingEl.addClass("lingua-study-settings-profile");
          setting.infoEl.empty();
          setting.controlEl.empty();
          setting.infoEl.createDiv({ cls: "lingua-study-settings-monogram", text: "LS" });
          const copy = setting.infoEl.createDiv({ cls: "lingua-study-settings-profile-copy" });
          copy.createDiv({ cls: "lingua-study-settings-profile-name", text: "Lingua Study" });
          const summary = copy.createDiv({
            cls: "lingua-study-settings-profile-summary",
            text: "正在读取学习数据"
          });
          void this.plugin.loadVocabularyBook().then(({ book }) => {
            if (!summary.isConnected) return;
            const review = getDailyReviewSummary(
              book,
              this.plugin.settings.dailyNewWordLimit,
              new Date()
            );
            summary.setText(
              `已收录生词 ${Object.keys(book.entries).length.toLocaleString()} 个 · 今日待复习 ${review.total.toLocaleString()} 个`
            );
          }).catch(() => {
            if (summary.isConnected) {
              summary.setText("学习数据暂不可用");
            }
          });
          setting.controlEl.createSpan({
            cls: "lingua-study-settings-version",
            text: `v${this.plugin.manifest.version}`
          });
          const updateArea = setting.controlEl.createDiv({
            cls: "lingua-study-settings-update",
            attr: { "aria-live": "polite" }
          });
          void this.plugin.checkForAvailableUpdate().then((update) => {
            if (!update || !updateArea.isConnected) {
              return;
            }
            updateArea.createSpan({
              cls: "lingua-study-settings-update-label",
              text: `发现新版本 v${update.latestVersion}`
            });
            const updateButton = updateArea.createEl("button", {
              cls: "lingua-study-settings-update-button",
              text: "前往更新",
              attr: {
                type: "button",
                "aria-label": `在 Obsidian 中打开 Lingua Study 插件页面并更新到 v${update.latestVersion}`
              }
            });
            updateButton.addEventListener("click", () => {
              window.open(update.updatePageUrl, "_blank", "noopener,noreferrer");
            });
          });
        }
      },
      {
        type: "group",
        heading: "学习与数据",
        cls: "lingua-study-settings-home-group",
        items: [this.learningPage(), this.translationPage(), this.generalPage()]
      },
      {
        type: "group",
        heading: "内容导入",
        cls: "lingua-study-settings-home-group",
        items: [this.youtubePage(), this.bilibiliPage(), this.documentAlignmentPage()]
      },
      {
        type: "group",
        heading: "外观",
        cls: "lingua-study-settings-home-group lingua-study-settings-appearance",
        items: [this.appearancePage()]
      }
    ];
  }

  private appearancePage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "外观",
      desc: "切换 Lingua Study 插件外观。",
      displayValue: () => this.plugin.settings.interfaceTheme === "paper"
        ? "Lingua Paper"
        : "经典主题",
      items: [
        {
          type: "group",
          heading: "选择主题",
          cls: "lingua-study-settings-section lingua-study-settings-page-appearance",
          items: [
            {
              name: "界面主题",
              searchable: false,
              render: (setting) => this.renderInterfaceThemePicker(setting)
            }
          ]
        }
      ]
    };
  }

  private renderInterfaceThemePicker(setting: Setting): void {
    const themes: ReadonlyArray<{
      value: InterfaceTheme;
      label: string;
      description: string;
    }> = [
      {
        value: "classic",
        label: "经典主题",
        description: "保留 Obsidian 原生视觉"
      },
      {
        value: "paper",
        label: "Lingua Paper",
        description: "纸张卡片与黑白强调"
      }
    ];

    setting.settingEl.addClass("lingua-study-settings-theme-setting");
    setting.controlEl.empty();
    const picker = setting.controlEl.createDiv({
      cls: "lingua-study-settings-theme-picker"
    });
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "界面主题");

    const choices: HTMLButtonElement[] = [];
    const syncSelection = (): void => {
      for (const choice of choices) {
        const selected = choice.dataset.theme === this.plugin.settings.interfaceTheme;
        choice.classList.toggle("is-selected", selected);
        choice.setAttribute("aria-pressed", String(selected));
        const status = choice.querySelector<HTMLElement>(".lingua-study-settings-theme-status");
        if (status) {
          status.hidden = !selected;
        }
      }
    };

    for (const theme of themes) {
      const choice = picker.createEl("button", {
        cls: "lingua-study-settings-theme-choice",
        attr: {
          type: "button",
          "data-theme": theme.value,
          "aria-label": `${theme.label}：${theme.description}`
        }
      });
      choices.push(choice);

      const preview = choice.createDiv({
        cls: `lingua-study-settings-theme-preview is-${theme.value}`
      });
      preview.setAttribute("aria-hidden", "true");
      const previewHeader = preview.createDiv({ cls: "lingua-study-settings-theme-preview-header" });
      previewHeader.createSpan({ cls: "lingua-study-settings-theme-preview-brand", text: "Lingua Study" });
      previewHeader.createSpan({ cls: "lingua-study-settings-theme-preview-meta", text: "ECDICT" });
      const previewTabs = preview.createDiv({ cls: "lingua-study-settings-theme-preview-tabs" });
      previewTabs.createSpan({ cls: "is-active", text: "查词" });
      previewTabs.createSpan({ text: "生词本" });
      previewTabs.createSpan({ text: "复习" });
      const previewCard = preview.createDiv({ cls: "lingua-study-settings-theme-preview-card" });
      previewCard.createDiv({ cls: "lingua-study-settings-theme-preview-word", text: "language" });
      previewCard.createDiv({ cls: "lingua-study-settings-theme-preview-line is-long" });
      previewCard.createDiv({ cls: "lingua-study-settings-theme-preview-line" });

      const caption = choice.createDiv({ cls: "lingua-study-settings-theme-caption" });
      const captionCopy = caption.createDiv();
      captionCopy.createDiv({ cls: "lingua-study-settings-theme-name", text: theme.label });
      captionCopy.createDiv({ cls: "lingua-study-settings-theme-description", text: theme.description });
      const status = caption.createSpan({
        cls: "lingua-study-settings-theme-status",
        text: "✓ 已选择"
      });
      status.hidden = true;

      choice.addEventListener("click", () => {
        if (this.plugin.settings.interfaceTheme === theme.value) {
          return;
        }
        for (const item of choices) {
          item.disabled = true;
        }
        void this.plugin.updateSettings({ interfaceTheme: theme.value }).then(() => {
          syncSelection();
        }).catch(() => {
          new Notice("界面主题保存失败，请重新加载插件后重试。", 5_000);
        }).finally(() => {
          for (const item of choices) {
            item.disabled = false;
          }
        });
      });
    }

    syncSelection();
  }

  private youtubePage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "YouTube 字幕",
      desc: "设置字幕保存和获取方式。",
      displayValue: "字幕获取与保存",
      items: [
        {
          type: "group",
          heading: "字幕文件",
          cls: "lingua-study-settings-section lingua-study-settings-page-youtube",
          items: [
            {
              name: "字幕保存文件夹",
              desc: "一键导入的字幕保存在这里；留空使用默认文件夹。",
              control: {
                type: "text",
                key: "transcriptFolder",
                defaultValue: DEFAULT_SETTINGS.transcriptFolder,
                placeholder: DEFAULT_TRANSCRIPT_FOLDER
              }
            }
          ]
        },
        {
          type: "group",
          heading: "获取方式",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "yt-dlp 程序路径（可选）",
              desc: "自动寻找失败时，再填写 yt-dlp 的完整路径。",
              visible: () => this.plugin.capabilities.ytDlp,
              control: {
                type: "text",
                key: "ytDlpPath",
                defaultValue: DEFAULT_SETTINGS.ytDlpPath,
                placeholder: "留空则自动寻找"
              }
            },
            {
              name: "移动端获取方式",
              desc: "移动端优先在线获取，失败时可导入 SRT/VTT。",
              visible: () => this.plugin.capabilities.mobile
            },
            {
              name: "网络与隐私",
              desc: this.plugin.capabilities.mobile
                ? "仅获取公开字幕，不使用账号、Cookie 或 API Key；接口可能失效。"
                : "仅获取字幕，不使用账号或 Cookie；公开接口可能失效。"
            }
          ]
        }
      ]
    };
  }

  private bilibiliPage(): SettingDefinitionPage {
    const mobile = this.plugin.capabilities.mobile;
    return {
      type: "page",
      name: mobile ? "B站视频与字幕" : "B站视频与登录",
      desc: mobile
        ? "设置 B站字幕与播放。"
        : "设置 B站字幕、播放与登录。",
      displayValue: mobile ? "在线播放 · 匿名字幕" : "匿名优先 · 需要时登录",
      items: [
        {
          type: "group",
          heading: "视频缓存",
          cls: "lingua-study-settings-section lingua-study-settings-page-bilibili",
          visible: () => this.plugin.capabilities.bilibiliVideoCache,
          items: [
            {
              name: "缓存位置",
              desc: `缓存位于系统目录，不参与 Obsidian 同步：${this.plugin.getBilibiliCacheFolder()}`
            },
            {
              name: "管理缓存视频",
              desc: "打开缓存文件夹；删除文件后改用在线播放。",
              render: (setting) => {
                setting.addButton((button) => {
                  button.setButtonText("打开缓存文件夹").onClick(async () => {
                    button.setDisabled(true);
                    try {
                      await this.plugin.openBilibiliCacheFolder();
                    } catch {
                      new Notice("无法打开缓存文件夹，请检查系统文件管理器权限。", 6_000);
                    } finally {
                      button.setDisabled(false);
                    }
                  });
                });
              }
            }
          ]
        },
        {
          type: "group",
          heading: "B站账号",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.capabilities.bilibiliLogin,
          items: [
            {
              name: "插件内登录状态",
              desc: "优先匿名获取；需要时使用插件独立登录。",
              render: (setting) => this.renderBilibiliStatus(setting)
            },
            {
              name: "管理插件内账号",
              desc: "登录仅用于 Lingua Study，不影响其他浏览器。",
              render: (setting) => {
                setting.addButton((button) => {
                  button.setButtonText("在 Obsidian 内登录").onClick(async () => {
                    button.setDisabled(true);
                    try {
                      await this.plugin.openBilibiliLogin();
                      new Notice("B站登录成功。再次导入时会自动使用该会话。", 6_000);
                      await this.refreshBilibiliStatusIndicators();
                    } catch (error) {
                      new Notice(
                        error instanceof Error ? error.message : "B站登录失败，请稍后重试。",
                        6_000
                      );
                    } finally {
                      button.setDisabled(false);
                    }
                  });
                });
                setting.addButton((button) => {
                  button.setButtonText("退出并清除插件内登录").setDestructive().onClick(async () => {
                    button.setDisabled(true);
                    try {
                      await this.plugin.clearBilibiliLogin();
                      new Notice("已清除 Lingua Study 的 B站登录会话。", 5_000);
                      await this.refreshBilibiliStatusIndicators();
                    } catch {
                      new Notice("B站登录会话清除失败，请重新加载插件后再试。", 6_000);
                    } finally {
                      button.setDisabled(false);
                    }
                  });
                });
              }
            }
          ]
        },
        {
          type: "group",
          heading: "移动端能力",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.capabilities.mobile,
          items: [
            {
              name: "在线播放与匿名字幕",
              desc: "移动端支持在线播放和匿名字幕；登录、缓存与自动对齐仅限电脑端。"
            }
          ]
        },
        {
          type: "group",
          heading: "使用说明",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "网络与空间限制",
              desc: mobile
                ? "使用 B站公开接口，可能因平台变化而失效。"
                : "缓存视频通常最高 480P、单个不超过 2 GB；公开接口可能失效。"
            }
          ]
        }
      ]
    };
  }

  private learningPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "学习与词典",
      desc: "设置学习目标、词典和复习。",
      displayValue: () => this.studyProfileLabel(),
      items: [
        {
          type: "group",
          heading: "学习目标",
          cls: "lingua-study-settings-section lingua-study-settings-page-learning",
          items: [
            {
              name: "当前备考范围",
              desc: "影响知识卡讲解方向和生词分类。",
              control: {
                type: "dropdown",
                key: "studyProfile",
                defaultValue: DEFAULT_SETTINGS.studyProfile,
                options: STUDY_PROFILE_LONG_LABELS
              }
            }
          ]
        },
        {
          type: "group",
          heading: "词典与复习",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "字幕双击查词",
              desc: "关闭后不再双击查词；词典与生词本仍可手动打开。",
              control: {
                type: "toggle",
                key: "enableDoubleClickLookup",
                defaultValue: DEFAULT_SETTINGS.enableDoubleClickLookup
              }
            },
            {
              name: "ECDICT 精简版",
              desc: `内置 ${DICTIONARY_SOURCE.entryCount.toLocaleString()} 个词条，完全离线且不产生费用。`
            },
            {
              name: "ECDICT 完整版",
              desc: "下载后离线使用；文件保存在系统缓存，不参与 Obsidian Sync。",
              visible: () => this.plugin.capabilities.fullDictionary,
              render: (setting) => {
                const status = setting.controlEl.createSpan({
                  cls: "lingua-study-settings-status"
                });
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                const download = setting.controlEl.createEl("button", { text: "下载完整版" });
                const open = setting.controlEl.createEl("button", { text: "打开目录" });
                const remove = setting.controlEl.createEl("button", {
                  cls: "mod-warning",
                  text: "删除完整版"
                });
                const refresh = (): void => {
                  const current = this.plugin.getFullDictionaryStatus();
                  status.classList.remove("is-success", "is-warning", "is-error");
                  if (current.manifest) {
                    if (current.updateAvailable) {
                      status.setText(`已安装旧版 · ${current.manifest.entryCount.toLocaleString()} 词条 · 有可用更新`);
                      status.classList.add("is-warning");
                    } else {
                      status.setText(`已安装 · ${current.manifest.entryCount.toLocaleString()} 词条 · ${(current.manifest.compressedBytes / 1024 / 1024).toFixed(1)} MB`);
                      status.classList.add("is-success");
                    }
                  } else {
                    status.setText("尚未下载");
                    status.classList.add("is-warning");
                  }
                  download.setText(current.updateAvailable ? "更新完整版" : "下载完整版");
                  download.hidden = current.installed && !current.updateAvailable;
                  open.hidden = !current.installed;
                  remove.hidden = !current.installed;
                };
                const setBusy = (busy: boolean): void => {
                  download.disabled = busy;
                  open.disabled = busy;
                  remove.disabled = busy;
                };
                const showInstallError = (error: unknown): void => {
                  const message = error instanceof Error
                    ? error.message
                    : "完整版词典安装失败，请稍后重试。";
                  status.setText(`安装失败：${message}`);
                  status.classList.add("is-error");
                  new Notice(message, 8_000);
                };
                const showInstallSuccess = (result: { manifest: { entryCount: number } }): void => {
                  new Notice(`ECDICT 完整版已安装，共 ${result.manifest.entryCount.toLocaleString()} 个词条。`, 7_000);
                  refresh();
                };
                const install = (): void => {
                  setBusy(true);
                  status.classList.remove("is-success", "is-warning", "is-error");
                  void this.plugin.installFullDictionary((message) => status.setText(message))
                    .then(showInstallSuccess)
                    .catch(showInstallError)
                    .finally(() => setBusy(false));
                };
                download.addEventListener("click", install);
                open.addEventListener("click", () => {
                  void this.plugin.openFullDictionaryFolder().catch(() => {
                    new Notice("无法打开词典缓存目录，请检查系统文件管理器权限。", 6_000);
                  });
                });
                remove.addEventListener("click", () => {
                  new ClearFullDictionaryModal(this.app, async () => {
                    await this.plugin.clearFullDictionary();
                    refresh();
                    new Notice("已删除 ECDICT 完整版，当前恢复使用精简版。", 6_000);
                  }).open();
                });
                refresh();
                const current = this.plugin.getFullDictionaryStatus();
                if (current.updateAvailable && !this.dictionaryUpdatePromptHandled) {
                  this.dictionaryUpdatePromptHandled = true;
                  window.setTimeout(() => {
                    if (!setting.settingEl.isConnected) return;
                    new FullDictionaryUpdateModal(this.app, install).open();
                  }, 0);
                }
              }
            },
            {
              name: "导入自定义词典（CSV / TSV / JSON）",
              desc: "导入 CSV、TSV 或 JSON；自定义释义优先，支持 forms/aliases，文件仅在本机处理。",
              visible: () => this.plugin.capabilities.fullDictionary,
              render: (setting) => {
                setting.controlEl.addClass("lingua-study-custom-dictionary-controls");
                const primaryRow = setting.controlEl.createDiv({
                  cls: "lingua-study-custom-dictionary-primary"
                });
                const templateRow = setting.controlEl.createDiv({
                  cls: "lingua-study-custom-dictionary-templates"
                });
                const status = primaryRow.createSpan({
                  cls: "lingua-study-settings-status"
                });
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                const importButton = primaryRow.createEl("button", { text: "选择词典文件" });
                const remove = primaryRow.createEl("button", {
                  cls: "mod-warning",
                  text: "删除自定义词典"
                });
                const csvTemplateButton = templateRow.createEl("button", { text: "CSV 模板" });
                const tsvTemplateLabel = "TSV 模板";
                const tsvTemplateButton = templateRow.createEl("button", { text: tsvTemplateLabel });
                const jsonTemplateButton = templateRow.createEl("button", { text: "JSON 模板" });
                const fileInput = primaryRow.createEl("input", {
                  attr: {
                    type: "file",
                    accept: ".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
                  }
                });
                fileInput.hidden = true;

                const refresh = (): void => {
                  const current = this.plugin.getCustomDictionaryStatus();
                  status.classList.remove("is-success", "is-warning", "is-error");
                  if (current.manifest) {
                    const detail = [
                      `${current.manifest.entryCount.toLocaleString()} 词条`,
                      current.manifest.skippedRows > 0
                        ? `跳过 ${current.manifest.skippedRows.toLocaleString()} 行`
                        : "",
                      current.manifest.duplicateRows > 0
                        ? `覆盖 ${current.manifest.duplicateRows.toLocaleString()} 个重复词`
                        : ""
                    ].filter(Boolean).join(" · ");
                    status.setText(`已导入 ${current.manifest.sourceFileName} · ${detail}`);
                    status.classList.add("is-success");
                  } else {
                    status.setText("尚未导入");
                    status.classList.add("is-warning");
                  }
                  remove.hidden = !current.installed;
                };
                const setBusy = (busy: boolean): void => {
                  importButton.disabled = busy;
                  csvTemplateButton.disabled = busy;
                  tsvTemplateButton.disabled = busy;
                  jsonTemplateButton.disabled = busy;
                  remove.disabled = busy;
                };
                importButton.addEventListener("click", () => fileInput.click());
                fileInput.addEventListener("change", () => {
                  const file = fileInput.files?.[0];
                  fileInput.value = "";
                  if (!file) return;
                  setBusy(true);
                  status.classList.remove("is-success", "is-warning", "is-error");
                  status.setText("正在读取自定义词典…");
                  void file.arrayBuffer()
                    .then((buffer) => this.plugin.installCustomDictionaryFromFile(
                      file.name,
                      new Uint8Array(buffer),
                      (message) => status.setText(message)
                    ))
                    .then((result) => {
                      const skipped = result.manifest.skippedRows;
                      const importSummary = skipped > 0
                        ? `，另有 ${skipped.toLocaleString()} 行未导入`
                        : "";
                      const warning = result.warnings.length > 0
                        ? `，提示：${result.warnings.join("；")}`
                        : "";
                      new Notice(
                        `自定义词典已导入，共 ${result.manifest.entryCount.toLocaleString()} 个词条${importSummary}${warning}。`,
                        8_000
                      );
                      refresh();
                    })
                    .catch((error: unknown) => {
                      const message = error instanceof Error
                        ? error.message
                        : "自定义词典导入失败，请检查文件格式。";
                      status.setText(`导入失败：${message}`);
                      status.classList.add("is-error");
                      new Notice(message, 8_000);
                    })
                    .finally(() => setBusy(false));
                });
                const downloadTemplate = (
                  content: string,
                  fileName: string,
                  mimeType: string
                ): void => {
                  const document = this.containerEl.ownerDocument;
                  const view = document.defaultView;
                  if (!view) return;
                  const blob = new Blob([`\uFEFF${content}\n`], {
                    type: `${mimeType};charset=utf-8`
                  });
                  const url = view.URL.createObjectURL(blob);
                  const link = document.body.createEl("a");
                  link.href = url;
                  link.download = fileName;
                  link.click();
                  link.remove();
                  view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
                };
                csvTemplateButton.addEventListener("click", () => {
                  downloadTemplate(
                    CUSTOM_DICTIONARY_TEMPLATE,
                    "lingua-study-custom-dictionary-template.csv",
                    "text/csv"
                  );
                });
                tsvTemplateButton.addEventListener("click", () => {
                  downloadTemplate(
                    CUSTOM_DICTIONARY_TSV_TEMPLATE,
                    "lingua-study-custom-dictionary-template.tsv",
                    "text/tab-separated-values"
                  );
                });
                jsonTemplateButton.addEventListener("click", () => {
                  downloadTemplate(
                    CUSTOM_DICTIONARY_JSON_TEMPLATE,
                    "lingua-study-custom-dictionary-template.json",
                    "application/json"
                  );
                });
                remove.addEventListener("click", () => {
                  new ClearCustomDictionaryModal(this.app, async () => {
                    await this.plugin.clearCustomDictionary();
                    refresh();
                    new Notice("已删除自定义词典，ECDICT 不受影响。", 6_000);
                  }).open();
                });
                refresh();
              }
            },
            {
              name: "移动端词典",
              desc: "移动端使用精简词典；完整和自定义词典仅限电脑端管理。",
              visible: () => this.plugin.capabilities.mobile
            },
            {
              name: "每日新词数量",
              desc: "限制每天进入复习队列的新词数量；到期词不受影响。",
              control: {
                type: "number",
                key: "dailyNewWordLimit",
                defaultValue: DEFAULT_SETTINGS.dailyNewWordLimit,
                min: 1,
                max: 50,
                step: 1,
                  validate: (value) =>
                  Number.isInteger(value) && value >= 1 && value <= 50
                    ? undefined
                    : "请输入 1–50 之间的整数。"
              }
            },
            {
              name: "FSRS-6 目标留存率",
              desc: "数值越高，复习越频繁；仅影响后续评分。",
              control: {
                type: "number",
                key: "fsrsRequestRetention",
                defaultValue: DEFAULT_SETTINGS.fsrsRequestRetention,
                min: MIN_FSRS_REQUEST_RETENTION,
                max: MAX_FSRS_REQUEST_RETENTION,
                step: 0.01,
                validate: (value) =>
                  value >= MIN_FSRS_REQUEST_RETENTION && value <= MAX_FSRS_REQUEST_RETENTION
                    ? undefined
                    : "请输入 0.70–0.99 之间的数值。"
              }
            }
          ]
        }
      ]
    };
  }

  private documentAlignmentPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "文稿导入与对齐",
      desc: "管理手动文稿的本地时间轴对齐。",
      displayValue: "仅用于手动文稿",
      items: [
        {
          type: "group",
          heading: "本地文稿对齐",
          cls: "lingua-study-settings-section lingua-study-settings-page-alignment",
          visible: () => this.plugin.capabilities.localWhisper,
          items: [
            {
              name: "Whisper Base English 模型",
              desc: `用于手动文稿对齐；音视频不会上传。目录：${this.plugin.getWhisperAlignmentCacheFolder()}`,
              render: (setting) => {
                const status = setting.controlEl.createSpan({
                  cls: "lingua-study-settings-status",
                  text: "正在检查模型…"
                });
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                void this.plugin.hasWhisperAlignmentModel().then((cached) => {
                  status.setText(cached ? "模型已缓存" : "尚未下载");
                  status.classList.toggle("is-success", cached);
                  status.classList.toggle("is-warning", !cached);
                }).catch(() => {
                  status.setText("状态检查失败");
                  status.classList.add("is-error");
                });
              }
            },
            {
              name: "管理本地模型",
              desc: "打开目录或清除模型；不影响已有字幕。",
              render: (setting) => {
                setting.addButton((button) => {
                  button.setButtonText("打开缓存目录").onClick(() => {
                    void this.plugin.openWhisperAlignmentCacheFolder();
                  });
                });
                setting.addButton((button) => {
                  button.setButtonText("清除模型").setDestructive().onClick(() => {
                    new ClearWhisperAlignmentCacheModal(
                      this.app,
                      () => this.plugin.clearWhisperAlignmentCache()
                    ).open();
                  });
                });
              }
            }
          ]
        },
        {
          type: "group",
          heading: "移动端对齐",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.capabilities.mobile,
          items: [
            {
              name: "手动时间轴",
              desc: "移动端可导入 SRT/VTT；Whisper 自动对齐仅限电脑端。"
            }
          ]
        },
        {
          type: "group",
          heading: "使用范围",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "与 B站字幕获取相互独立",
              desc: "仅用于手动文稿对齐，不处理 B站官方字幕。"
            }
          ]
        }
      ]
    };
  }

  private translationPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "翻译服务",
      desc: "设置翻译服务和 API 凭据。",
      displayValue: () => this.translationProviderLabel(),
      items: [
        {
          type: "group",
          heading: "服务选择",
          cls: "lingua-study-settings-section lingua-study-settings-page-translation",
          items: [
            {
              name: "翻译服务",
              desc: "百度仅翻译；AI 服务还可生成学习知识卡。",
              control: {
                type: "dropdown",
                key: "translationProvider",
                defaultValue: DEFAULT_SETTINGS.translationProvider,
                options: {
                  disabled: "关闭翻译",
                  baidu: "百度翻译 API",
                  deepseek: "DeepSeek 官方",
                  kimi: "Kimi 官方（国内）",
                  "openai-compatible": "OpenAI 兼容中转站"
                }
              }
            },
            {
              name: "划词翻译",
              desc: "选中字幕中的英文句子后显示翻译悬浮窗。",
              control: {
                type: "toggle",
                key: "enableSelectionTranslation",
                defaultValue: DEFAULT_SETTINGS.enableSelectionTranslation
              }
            },
            {
              name: "整篇文稿翻译",
              desc: "开启后翻译未缓存的整篇文稿，并产生多次 API 请求。",
              control: {
                type: "toggle",
                key: "translateWholeTranscript",
                defaultValue: DEFAULT_SETTINGS.translateWholeTranscript
              }
            }
          ]
        },
        {
          type: "group",
          heading: "百度翻译 API",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.settings.translationProvider === "baidu",
          items: [
            {
              name: "API 地址",
              desc: "固定的百度官方地址。",
              render: (setting) => {
                setting.addText((text) => {
                  text.setValue("https://fanyi-api.baidu.com").setDisabled(true);
                });
              }
            },
            {
              name: "百度翻译 AppID",
              desc: "在百度翻译开放平台获取。",
              control: {
                type: "text",
                key: "baiduAppId",
                defaultValue: DEFAULT_SETTINGS.baiduAppId,
                placeholder: "填写 AppID"
              }
            },
            {
              name: "百度翻译密钥",
              desc: "保存在 Obsidian 安全凭据库中。",
              render: (setting) => {
                new SecretComponent(this.app, setting.controlEl)
                  .setValue(this.plugin.settings.baiduSecretId)
                  .onChange(async (value) => {
                    await this.plugin.updateSettings({ baiduSecretId: value });
                  });
              }
            },
            {
              name: "功能范围",
              desc: "支持句子、整篇字幕和 Markdown 选区；不生成知识卡。"
            }
          ]
        },
        {
          type: "group",
          heading: "Kimi 官方（国内）",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.settings.translationProvider === "kimi",
          items: [
            {
              name: "API 地址",
              desc: "固定的 Moonshot 国内官方地址。",
              render: (setting) => {
                setting.addText((text) => {
                  text.setValue("https://api.moonshot.cn/v1").setDisabled(true);
                });
              }
            },
            {
              name: "模型",
              desc: "使用 Kimi K2.6。",
              control: {
                type: "dropdown",
                key: "kimiModel",
                defaultValue: DEFAULT_SETTINGS.kimiModel,
                options: {
                  "kimi-k2.6": "Kimi K2.6"
                }
              }
            },
            {
              name: "Kimi API Key",
              desc: "保存在 Obsidian 安全凭据库中。",
              render: (setting) => {
                new SecretComponent(this.app, setting.controlEl)
                  .setValue(this.plugin.settings.kimiSecretId)
                  .onChange(async (value) => {
                    await this.plugin.updateSettings({ kimiSecretId: value });
                  });
              }
            }
          ]
        },
        {
          type: "group",
          heading: "DeepSeek 官方",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.settings.translationProvider === "deepseek",
          items: [
            {
              name: "API 地址",
              desc: "固定的 DeepSeek 官方地址。",
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
              desc: "保存在 Obsidian 安全凭据库中。",
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
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.settings.translationProvider === "openai-compatible",
          items: [
            {
              name: "API 地址",
              desc: "填写 /v1 或完整的 /chat/completions 地址。",
              control: {
                type: "text",
                key: "customBaseUrl",
                placeholder: "https://example.com/v1"
              }
            },
            {
              name: "模型名称",
              desc: "填写中转站提供的模型 ID。",
              control: {
                type: "text",
                key: "customModel",
                placeholder: "例如 deepseek-v4-flash"
              }
            },
            {
              name: "中转站 API Key",
              desc: "单独保存在 Obsidian 安全凭据库中。",
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
          heading: "连接与隐私",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "测试连接",
              desc: "发送固定测试短句，不读取当前笔记。",
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
              desc: "凭据存入安全库；请求可能计费，并会把文本发送给所选服务。"
            }
          ]
        }
      ]
    };
  }

  private generalPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "通用选项",
      desc: "设置导入方式和翻译缓存。",
      displayValue: "手动创建与缓存",
      items: [
        {
          type: "group",
          heading: "自动化",
          cls: "lingua-study-settings-section lingua-study-settings-page-general",
          items: [
            {
              name: "粘贴视频链接后自动创建学习内容（可选）",
              desc: "开启后，粘贴单个完整的 B站或 YouTube 链接会自动导入。",
              control: {
                type: "toggle",
                key: "autoImportPastedVideoLinks",
                defaultValue: DEFAULT_SETTINGS.autoImportPastedVideoLinks
              }
            }
          ]
        },
        {
          type: "group",
          heading: "本地缓存",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "保存翻译缓存",
              desc: "将译文保存到字幕旁的 JSON；重新打开时默认隐藏。",
              control: {
                type: "toggle",
                key: "cacheTranslations",
                defaultValue: DEFAULT_SETTINGS.cacheTranslations
              }
            }
          ]
        }
      ]
    };
  }

  private renderBilibiliStatus(setting: Setting): () => void {
    const statusEl = setting.controlEl.createSpan({
      cls: "lingua-study-settings-status",
      text: "正在检查…"
    });
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    this.bilibiliStatusEls.add(statusEl);
    void this.refreshBilibiliStatusElement(statusEl);
    return () => this.bilibiliStatusEls.delete(statusEl);
  }

  private async refreshBilibiliStatusIndicators(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const statusEl of this.bilibiliStatusEls) {
      if (!statusEl.isConnected) {
        this.bilibiliStatusEls.delete(statusEl);
        continue;
      }
      tasks.push(this.refreshBilibiliStatusElement(statusEl));
    }
    await Promise.all(tasks);
  }

  private async refreshBilibiliStatusElement(statusEl: HTMLElement): Promise<void> {
    statusEl.setText("正在检查…");
    statusEl.classList.remove("is-success", "is-warning", "is-error");
    try {
      const status = await this.plugin.getBilibiliLoginStatus();
      if (!status.supported) {
        statusEl.setText("仅支持桌面版");
        statusEl.classList.add("is-warning");
        return;
      }
      statusEl.setText(status.loggedIn ? "已登录" : "未登录");
      statusEl.classList.add(status.loggedIn ? "is-success" : "is-warning");
    } catch {
      statusEl.setText("状态检查失败");
      statusEl.classList.add("is-error");
    }
  }

  private studyProfileLabel(): string {
    return STUDY_PROFILE_LONG_LABELS[this.plugin.settings.studyProfile];
  }

  private translationProviderLabel(): string {
    if (this.plugin.settings.translationProvider === "baidu") {
      return "百度翻译 API";
    }
    if (this.plugin.settings.translationProvider === "deepseek") {
      return "DeepSeek 官方";
    }
    if (this.plugin.settings.translationProvider === "kimi") {
      return "Kimi 官方（国内）";
    }
    if (this.plugin.settings.translationProvider === "openai-compatible") {
      return "OpenAI 兼容中转站";
    }
    return "已关闭";
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
    if (key === "transcriptFolder" && typeof value === "string") {
      await this.plugin.updateSettings({ transcriptFolder: sanitizeTranscriptFolder(value) });
      return;
    }

    if (key === "ytDlpPath" && typeof value === "string") {
      await this.plugin.updateSettings({ ytDlpPath: value.trim() });
      return;
    }

    if (key === "studyProfile" && isStudyProfile(value)) {
      await this.plugin.updateSettings({ studyProfile: value });
      return;
    }

    if (key === "dailyNewWordLimit" && typeof value === "number") {
      await this.plugin.updateSettings({ dailyNewWordLimit: value });
      return;
    }

    if (key === "fsrsRequestRetention" && typeof value === "number") {
      await this.plugin.updateSettings({ fsrsRequestRetention: value });
      return;
    }

    if (
      key === "translationProvider" &&
      (value === "disabled" || value === "baidu" || value === "deepseek" || value === "kimi" || value === "openai-compatible")
    ) {
      await this.plugin.updateSettings({ translationProvider: value });
      this.refreshDomState();
      return;
    }

    if (key === "translateWholeTranscript" && typeof value === "boolean") {
      await this.plugin.updateSettings({ translateWholeTranscript: value });
      return;
    }

    if (key === "enableSelectionTranslation" && typeof value === "boolean") {
      await this.plugin.updateSettings({ enableSelectionTranslation: value });
      return;
    }

    if (key === "baiduAppId" && typeof value === "string") {
      await this.plugin.updateSettings({ baiduAppId: value.trim() });
      return;
    }

    if (
      key === "deepSeekModel" &&
      (value === "deepseek-v4-flash" || value === "deepseek-v4-pro")
    ) {
      await this.plugin.updateSettings({ deepSeekModel: value });
      return;
    }

    if (key === "kimiModel" && value === "kimi-k2.6") {
      await this.plugin.updateSettings({ kimiModel: value });
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

    if (key === "autoImportPastedVideoLinks" && typeof value === "boolean") {
      await this.plugin.updateSettings({ autoImportPastedVideoLinks: value });
      return;
    }

    if (key === "enableDoubleClickLookup" && typeof value === "boolean") {
      await this.plugin.updateSettings({ enableDoubleClickLookup: value });
      return;
    }

    if (key === "cacheTranslations" && typeof value === "boolean") {
      await this.plugin.updateSettings({ cacheTranslations: value });
    }
  }
}
