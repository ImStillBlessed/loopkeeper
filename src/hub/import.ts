import type { SupportHub } from "./support-hub.js";

/**
 * Importing an exported hub chat (often thousands of messages) as a background job. Messages are
 * routed one at a time, in order, at the pace the clients' pipelines can take (the hub waits when a
 * client has a backlog). Dashboards get one progress update a second instead of an event per message.
 * Messages already in the hub are skipped, so importing the same export again resumes it.
 */

export interface ImportProgress {
  state: "running" | "done" | "stopped" | "failed";
  total: number;
  /** Messages handled so far (including skipped ones). */
  done: number;
  /** Already in the hub from an earlier import. */
  skipped: number;
  routed: number;
  pending: number;
  ignored: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

const PROGRESS_EVERY_MS = 1000;

export class HubImport {
  private progress: ImportProgress | undefined;
  private stopping = false;
  private lastSent = 0;

  constructor(
    private hub: SupportHub,
    private report: (progress: ImportProgress) => void,
  ) {}

  status(): ImportProgress | null {
    return this.progress ?? null;
  }

  get running(): boolean {
    return this.progress?.state === "running";
  }

  start(messages: Array<{ sender: string; text: string; ts: number }>): ImportProgress {
    if (this.running) throw Object.assign(new Error("An import is already running. Stop it first, or wait for it to finish."), { status: 409 });
    this.stopping = false;
    this.progress = { state: "running", total: messages.length, done: 0, skipped: 0, routed: 0, pending: 0, ignored: 0, startedAt: Date.now(), finishedAt: null, error: null };
    void this.run(messages);
    this.send(true);
    return this.progress;
  }

  /** Stops after the message being routed now. What was imported stays; importing again resumes. */
  stop(): void {
    this.stopping = true;
  }

  private async run(messages: Array<{ sender: string; text: string; ts: number }>): Promise<void> {
    const progress = this.progress!;
    try {
      for (const message of messages) {
        if (this.stopping) break;
        const status = await this.hub.receive(message.sender, message.text, message.ts, { quiet: true, skipKnown: true });
        if (status === "known") progress.skipped++;
        else if (status) progress[status]++;
        progress.done++;
        this.send();
      }
      progress.state = this.stopping ? "stopped" : "done";
    } catch (error) {
      progress.state = "failed";
      progress.error = (error as Error).message;
    }
    progress.finishedAt = Date.now();
    this.send(true);
  }

  private send(now = false): void {
    if (!this.progress || (!now && Date.now() - this.lastSent < PROGRESS_EVERY_MS)) return;
    this.lastSent = Date.now();
    this.report({ ...this.progress });
  }
}
