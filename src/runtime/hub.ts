import type { HubEvent } from "../pipeline/types.js";

type Listener = (event: HubEvent) => void;

const MAX_HISTORY = 6000;

/**
 * Everything the app says as it happens, for every client (each event carries its clientId). Open dashboards and CLIs subscribe;
 * a new subscriber first receives the recent history, so it can draw the feed.
 */
export class EventHub {
  private log: HubEvent[] = [];
  private listeners = new Set<Listener>();

  history(): HubEvent[] {
    return this.log;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: HubEvent): void {
    this.log.push(event);
    if (this.log.length > MAX_HISTORY) this.log.splice(0, this.log.length - MAX_HISTORY);
    for (const listener of this.listeners) listener(event);
  }

  /** Forget one client's events (after its data is reset). */
  clearClient(clientId: string): void {
    this.log = this.log.filter((event) => event.clientId !== clientId);
  }
}
