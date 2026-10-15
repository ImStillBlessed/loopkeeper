import type { PipelineEvent } from "../pipeline/types.js";

type Listener = (event: PipelineEvent) => void;

const MAX_HISTORY = 3000;

/**
 * Everything one project says as it happens. Open dashboards and CLIs subscribe;
 * a new subscriber first receives the recent history, so it can draw the feed.
 */
export class EventHub {
  private log: PipelineEvent[] = [];
  private listeners = new Set<Listener>();

  history(): PipelineEvent[] {
    return this.log;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: PipelineEvent): void {
    this.log.push(event);
    if (this.log.length > MAX_HISTORY) this.log.splice(0, this.log.length - MAX_HISTORY);
    for (const listener of this.listeners) listener(event);
  }

  clear(): void {
    this.log = [];
  }
}
