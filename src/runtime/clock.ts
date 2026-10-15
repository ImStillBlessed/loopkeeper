/**
 * The chat's clock. It runs at real speed, but can be moved forward (never back), so a demo can
 * jump "two days later" and watch promises go overdue. Each project has its own.
 */
export class ChatClock {
  private offset = 0;
  private last = 0;

  constructor(initial = 0) {
    this.setAtLeast(initial);
  }

  /** Current chat time in ms. Strictly increasing, so two messages never share a timestamp. */
  now(): number {
    const now = Math.max(Date.now() + this.offset, this.last + 1);
    this.last = now;
    return now;
  }

  /** Read without ticking. */
  peek(): number {
    return Math.max(Date.now() + this.offset, this.last);
  }

  advance(ms: number): void {
    if (ms > 0) this.offset += ms;
  }

  /** Move forward to `ts` if the clock is behind it. */
  setAtLeast(ts: number): void {
    const behind = ts - (Date.now() + this.offset);
    if (behind > 0) this.offset += behind;
  }
}
