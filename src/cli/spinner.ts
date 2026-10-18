/** 轻量终端 spinner：TTY 下用动画帧，非 TTY 退化为单行提示 */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private message = "";
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  start(message: string): void {
    this.message = message;
    if (!process.stdout.isTTY) {
      console.log(`${message}…`);
      return;
    }
    this.stop();
    this.frame = 0;
    this.timer = setInterval(() => {
      process.stdout.write(`\r\x1b[2K${this.frames[this.frame % this.frames.length]!} ${this.message}`);
      this.frame += 1;
    }, 100);
  }

  setMessage(message: string): void {
    this.message = message;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
  }
}
