import type { ChatMessage } from "../ingest/types.js";
import { processBatch, type PipelineOptions } from "../pipeline/runner.js";

const COLLECT_MS = 1500;
const MAX_BATCH = 20;
const CONTEXT_PER_GROUP = 10;

/**
 * Where live messages land. Messages that arrive close together are processed as one batch
 * (one triage call instead of many), one group at a time, in arrival order.
 */
export class Inbox {
  private queue: ChatMessage[] = [];
  private recent = new Map<string, ChatMessage[]>();
  private working = false;

  constructor(
    private options: () => Promise<PipelineOptions>,
    private onError: (error: Error) => void,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  push(message: ChatMessage): void {
    this.queue.push(message);
    if (!this.working) void this.work();
  }

  clear(): void {
    this.queue = [];
    this.recent.clear();
  }

  private async work(): Promise<void> {
    this.working = true;
    try {
      await sleep(COLLECT_MS);
      while (this.queue.length > 0) {
        const groupId = this.queue[0].groupId;
        const batch = takeWhile(this.queue, (m) => m.groupId === groupId, MAX_BATCH);
        const previous = this.recent.get(groupId) ?? [];
        try {
          await processBatch(batch, previous, await this.options());
        } catch (error) {
          this.onError(error as Error);
        }
        this.recent.set(groupId, [...previous, ...batch].slice(-CONTEXT_PER_GROUP));
      }
    } finally {
      this.working = false;
    }
  }
}

/** Removes and returns the leading items that match, up to `max`. */
function takeWhile<T>(items: T[], matches: (item: T) => boolean, max: number): T[] {
  let count = 0;
  while (count < items.length && count < max && matches(items[count])) count++;
  return items.splice(0, count);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
