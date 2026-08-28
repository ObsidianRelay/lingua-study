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
  type LinguaStudySettings
} from "./settings-core";
import {
  isStudyProfile,
  STUDY_PROFILE_LONG_LABELS
} from "./study-core";
import { DICTIONARY_SOURCE } from "./dictionary-core";

export {
  DEFAULT_SETTINGS,
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

export class LinguaStudySettingTab extends PluginSettingTab {
  private readonly bilibiliStatusEls = new Set<HTMLElement>();

  constructor(app: App, private readonly plugin: LinguaStudyPlugin) {
    super(app, plugin);
    this.containerEl.addClass("lingua-study-settings");
  }

  /** 顶层只保留六个原生子页面，子页面内容仍参与 Obsidian 设置搜索。 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.youtubePage(),
      this.bilibiliPage(),
      this.learningPage(),
      this.documentAlignmentPage(),
      this.translationPage(),
      this.generalPage()
    ];
  }

  private youtubePage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "YouTube 字幕",
      desc: "管理字幕保存位置、yt-dlp 回退和网络说明。",
      displayValue: "字幕获取与保存",
      items: [
        {
          type: "group",
          heading: "字幕文件",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "字幕保存文件夹",
              desc: "一键导入创建的本地字幕 JSON 会保存在这里。留空或路径无效时使用默认文件夹。",
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
              desc: "直接获取失败时，插件会先自动寻找电脑上的 yt-dlp。只有自动找不到时才需要填写完整路径，例如 /opt/homebrew/bin/yt-dlp 或 C:\\Tools\\yt-dlp.exe。",
              control: {
                type: "text",
                key: "ytDlpPath",
                defaultValue: DEFAULT_SETTINGS.ytDlpPath,
                placeholder: "留空则自动寻找"
              }
            },
            {
              name: "网络与隐私",
              desc: "插件和本机 yt-dlp 只向 YouTube 获取字幕，不使用 Cookie、Google 登录、用户 API Key、作者服务器或遥测。普通公开视频使用非官方公开字幕接口，可能随 YouTube 更新而失效。"
            }
          ]
        }
      ]
    };
  }

  private bilibiliPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "B站视频与登录",
      desc: "管理视频缓存、插件内登录和字幕获取限制。",
      displayValue: "匿名优先 · 需要时登录",
      items: [
        {
          type: "group",
          heading: "视频缓存",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "缓存位置",
              desc: `视频缓存在电脑的系统缓存目录，不会写入笔记库或参与 Obsidian 同步：${this.plugin.getBilibiliCacheFolder()}`
            },
            {
              name: "管理缓存视频",
              desc: "打开所有 B站缓存视频所在的文件夹。可以在系统文件管理器中查看并自行删除；删除后笔记会自动退回在线播放器。",
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
          items: [
            {
              name: "插件内登录状态",
              desc: "先匿名读取字幕；只有 B站明确要求登录时才需要在 Obsidian 内登录。登录会话与 Chrome 分开，仅保存在这台电脑。",
              render: (setting) => this.renderBilibiliStatus(setting)
            },
            {
              name: "管理插件内账号",
              desc: "登录窗口由 Obsidian 桌面端打开。清除登录只退出 Lingua Study 的独立会话，不影响 Chrome 或其他浏览器。",
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
          heading: "使用说明",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "网络与空间限制",
              desc: "视频缓存仍来自 B站公开接口，通常最高为 480P，单个视频缓存上限 2 GB。英文字幕直接从 B站接口读取，不需要 Chrome 扩展，也不使用 Whisper；接口或平台规则变化仍可能导致获取失败。"
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
      desc: "选择备考范围，并管理离线词典和每日生词数量。",
      displayValue: () => this.studyProfileLabel(),
      items: [
        {
          type: "group",
          heading: "学习目标",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "当前备考范围",
              desc: "决定句子知识卡的讲解深度和生词归类。各目标采用对应备考方向讲解，不代表官方固定词表；词典侧栏也可以快捷切换。",
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
              name: "ECDICT 精简版",
              desc: `已内置 ${DICTIONARY_SOURCE.entryCount.toLocaleString()} 个考试和高频词条。双击英文字幕中的单词即可查词，不调用翻译服务，也不会产生费用。`
            },
            {
              name: "ECDICT 完整版",
              desc: "点击下载后优先安装已生成的压缩词典包，不可用时自动回退到 ECDICT 官方 CSV；支持断点续传和自动重试。文件保存在系统缓存目录，不写入笔记库、不参与 Obsidian Sync。",
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
                    status.setText(`已安装 · ${current.manifest.entryCount.toLocaleString()} 词条 · ${(current.manifest.compressedBytes / 1024 / 1024).toFixed(1)} MB`);
                    status.classList.add("is-success");
                  } else {
                    status.setText("尚未下载");
                    status.classList.add("is-warning");
                  }
                  download.hidden = current.installed;
                  open.hidden = !current.installed;
                  remove.hidden = !current.installed;
                };
                download.addEventListener("click", () => {
                  download.disabled = true;
                  open.disabled = true;
                  remove.disabled = true;
                  status.classList.remove("is-success", "is-warning", "is-error");
                  void this.plugin.installFullDictionary((message) => status.setText(message)).then((result) => {
                    new Notice(`ECDICT 完整版已安装，共 ${result.manifest.entryCount.toLocaleString()} 个词条。`, 7_000);
                    refresh();
                  }).catch((error) => {
                    const message = error instanceof Error
                      ? error.message
                      : "完整版词典安装失败，请稍后重试。";
                    status.setText(`安装失败：${message}`);
                    status.classList.add("is-error");
                    new Notice(message, 8_000);
                  }).finally(() => {
                    download.disabled = false;
                    open.disabled = false;
                    remove.disabled = false;
                  });
                });
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
              }
            },
            {
              name: "每日新词数量",
              desc: "每天最多在复习队列中引入多少个从未学习过的新词；已经到期的旧词不受此限制。",
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
      desc: "管理用户手动上传文稿与视频的本地时间轴对齐。",
      displayValue: "仅用于手动文稿",
      items: [
        {
          type: "group",
          heading: "本地文稿对齐",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "Whisper Base English 模型",
              desc: `仅在用户手动上传文稿并选择自动对齐时使用。首次使用需确认下载；音视频不会上传。运行文件位于：${this.plugin.getWhisperAlignmentCacheFolder()}`,
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
              desc: "可以打开缓存目录或清除本地模型；不会影响已经生成的字幕。",
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
          heading: "使用范围",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "与 B站字幕获取相互独立",
              desc: "B站官方字幕通过 B站接口直接读取，不调用 Whisper。这里的模型只负责把用户手动粘贴或上传的文稿与视频时间轴对齐。"
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
      desc: "配置翻译提供方、模型、安全凭据和连接测试。",
      displayValue: () => this.translationProviderLabel(),
      items: [
        {
          type: "group",
          heading: "服务选择",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "翻译服务",
              desc: "选择生成中文译文和学习知识卡所使用的服务。",
              control: {
                type: "dropdown",
                key: "translationProvider",
                defaultValue: DEFAULT_SETTINGS.translationProvider,
                options: {
                  disabled: "关闭翻译",
                  deepseek: "DeepSeek 官方",
                  kimi: "Kimi 官方（国内）",
                  "openai-compatible": "OpenAI 兼容中转站"
                }
              }
            },
            {
              name: "整篇文稿翻译",
              desc: "关闭时，翻译按钮只处理当前选择的句子；开启后，点击翻译会按顺序处理整篇文稿中尚未翻译的句子，并跳过已有缓存。整篇模式会产生多次 API 请求和相应费用。",
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
          heading: "Kimi 官方（国内）",
          cls: "lingua-study-settings-section",
          visible: () => this.plugin.settings.translationProvider === "kimi",
          items: [
            {
              name: "API 地址",
              desc: "Moonshot 国内官方固定地址，不会保存到插件配置中。",
              render: (setting) => {
                setting.addText((text) => {
                  text.setValue("https://api.moonshot.cn/v1").setDisabled(true);
                });
              }
            },
            {
              name: "模型",
              desc: "使用 Kimi 官方当前的 K2.6 模型。",
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
              desc: "选择已有安全凭据，或在控件中创建新凭据；与其他翻译服务的 API Key 分开保存。",
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
          cls: "lingua-study-settings-section",
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
          heading: "连接与隐私",
          cls: "lingua-study-settings-section",
          items: [
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
              desc: "API Key 保存在 Obsidian 安全凭据库中。测试连接和翻译可能产生费用；使用官方服务时字幕会发送给对应服务商，第三方中转站也会收到你主动发送的英文字幕，请只使用可信服务。"
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
      desc: "管理手动创建、可选的粘贴自动导入和本地翻译缓存。",
      displayValue: "手动创建与缓存",
      items: [
        {
          type: "group",
          heading: "自动化",
          cls: "lingua-study-settings-section",
          items: [
            {
              name: "粘贴视频链接后自动创建学习内容（可选）",
              desc: "默认关闭：粘贴链接后点击左侧 Lingua Study Logo 手动创建。开启后，粘贴单个完整的 B站或 YouTube 视频链接会立即开始导入；普通文字中的链接和一次粘贴多个链接不会触发。",
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
              desc: "开启后，翻译结果保存在字幕文件旁边的独立 JSON 中；重新打开笔记时仍默认隐藏。",
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

    if (
      key === "translationProvider" &&
      (value === "disabled" || value === "deepseek" || value === "kimi" || value === "openai-compatible")
    ) {
      await this.plugin.updateSettings({ translationProvider: value });
      this.refreshDomState();
      return;
    }

    if (key === "translateWholeTranscript" && typeof value === "boolean") {
      await this.plugin.updateSettings({ translateWholeTranscript: value });
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

    if (key === "cacheTranslations" && typeof value === "boolean") {
      await this.plugin.updateSettings({ cacheTranslations: value });
    }
  }
}
