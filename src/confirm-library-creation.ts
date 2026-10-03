import { App, Modal } from "obsidian";

class ConfirmLibraryCreationModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly label: string,
    private readonly path: string,
    private readonly previouslySeen: boolean,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.previouslySeen ? `重新建立空${this.label}？` : `创建${this.label}文件？`);
    this.contentEl.createEl("p", {
      text: this.previouslySeen
        ? `此前存在的 ${this.path} 现在缺失。仅在你已主动删除旧文件、确认同步完成且不需要恢复旧数据时继续。重新建立空文件会从零开始，可能与其他设备上的旧数据冲突。`
        : `当前找不到 ${this.path}。如果你正在使用 Obsidian Sync 或其他同步工具，请先等同步完成；现在创建可能与另一台设备上的数据冲突。`
    });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "取消，稍后重试" });
    cancel.addEventListener("click", () => this.finish(false));
    const create = actions.createEl("button", { text: `确认创建空${this.label}` });
    create.addClass("mod-warning");
    create.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}

export function confirmLibraryCreation(app: App, label: string, path: string, previouslySeen = false): Promise<boolean> {
  return new Promise((resolve) => new ConfirmLibraryCreationModal(app, label, path, previouslySeen, resolve).open());
}
