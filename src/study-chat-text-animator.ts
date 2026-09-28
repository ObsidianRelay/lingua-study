/** Reveals received chat text in small batches aligned with screen refreshes. */
export class StudyChatTextAnimator {
  private target: string;
  private visibleLength: number;
  private frame: number | null = null;
  private onReveal: (text: string) => void = () => undefined;
  private resolveFinish: (() => void) | null = null;
  private finishPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly requestFrame: (callback: () => void) => number,
    private readonly cancelFrame: (frame: number) => void,
    initialText = ""
  ) {
    this.target = initialText;
    this.visibleLength = initialText.length;
  }

  get visibleText(): string { return this.target.slice(0, this.visibleLength); }

  setRenderer(onReveal: (text: string) => void): void {
    this.onReveal = onReveal;
    this.schedule();
  }

  append(text: string): void {
    if (this.disposed || !text) return;
    this.target += text;
    this.schedule();
  }

  finish(): Promise<void> {
    if (this.disposed || this.visibleLength === this.target.length) return Promise.resolve();
    if (!this.finishPromise) {
      this.finishPromise = new Promise<void>((resolve) => { this.resolveFinish = resolve; });
    }
    this.schedule();
    return this.finishPromise;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.resolveFinish?.();
    this.resolveFinish = null;
    this.onReveal = () => undefined;
  }

  private schedule(): void {
    if (this.disposed || this.frame !== null || this.visibleLength >= this.target.length) return;
    this.frame = this.requestFrame(() => this.reveal());
  }

  private reveal(): void {
    this.frame = null;
    if (this.disposed) return;
    const remaining = this.target.length - this.visibleLength;
    if (remaining > 0) {
      const count = Math.min(remaining, Math.max(2, Math.min(64, Math.ceil(remaining / 8))));
      const next = this.target.slice(this.visibleLength, this.visibleLength + count);
      this.visibleLength += count;
      this.onReveal(next);
    }
    if (this.visibleLength < this.target.length) this.schedule();
    else {
      this.resolveFinish?.();
      this.resolveFinish = null;
    }
  }
}
