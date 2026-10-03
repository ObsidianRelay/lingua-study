/** Incrementally reads OpenAI-compatible Chat Completions SSE events. */
export class StudyChatStreamParser {
  private lineBuffer = "";
  private dataLines: string[] = [];
  private completed = false;
  private answer = "";
  private reasoningSeen = false;

  get hasReasoning(): boolean { return this.reasoningSeen; }

  push(chunk: string): string[] {
    this.lineBuffer += chunk;
    if (this.lineBuffer.length > 1_000_000) throw new Error("聊天服务返回的流式片段过大。");
    const deltas: string[] = [];
    let newline = this.lineBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.lineBuffer.slice(0, newline).replace(/\r$/u, "");
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      this.readLine(line, deltas);
      newline = this.lineBuffer.indexOf("\n");
    }
    return deltas;
  }

  finish(requireContent = true): string {
    if (this.lineBuffer) this.readLine(this.lineBuffer.replace(/\r$/u, ""), []);
    this.dispatch([]);
    if (!this.completed) throw new Error("聊天连接提前中断，回答可能不完整，请重试。");
    if (requireContent && !this.answer.trim()) {
      throw new Error(this.reasoningSeen
        ? "模型只返回了思考内容，没有回答正文。请重试或切换模型。"
        : "聊天服务返回了空内容，请稍后重试。");
    }
    return this.answer;
  }

  private readLine(line: string, deltas: string[]): void {
    if (line === "") {
      this.dispatch(deltas);
    } else if (line.startsWith("data:")) {
      this.dataLines.push(line.slice(5).replace(/^ /u, ""));
    }
  }

  private dispatch(deltas: string[]): void {
    if (this.dataLines.length === 0 || this.completed) return;
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    if (data.trim() === "[DONE]") {
      this.completed = true;
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch {
      throw new Error("聊天服务返回了无法解析的流式数据。");
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.error) throw new Error("聊天服务在生成回答时出错，请检查模型与账户配置。");
    if (!Array.isArray(record.choices)) return;
    for (const item of record.choices) {
      if (!item || typeof item !== "object") continue;
      const choice = item as Record<string, unknown>;
      const delta = choice.delta;
      if (delta && typeof delta === "object") {
        const deltaRecord = delta as Record<string, unknown>;
        if (typeof deltaRecord.reasoning === "string" && deltaRecord.reasoning ||
          typeof deltaRecord.reasoning_content === "string" && deltaRecord.reasoning_content) {
          this.reasoningSeen = true;
        }
        const content = deltaRecord.content;
        if (typeof content === "string" && content) {
          this.answer += content;
          deltas.push(content);
        }
      }
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        this.completed = true;
      }
    }
  }
}
