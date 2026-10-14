import { config } from "../config.js";
import { getTenantGraph } from "../graph/client.js";
import { Q0_STATS, run } from "../graph/queries.js";
import { DEMO_GROUP_ID, resetGraph, seedWorld } from "../graph/seed.js";
import { parseWhatsAppExport } from "../ingest/whatsapp-export.js";
import { groqLlm } from "../llm/llm.js";
import { ingestMessages } from "../pipeline/runner.js";
import type { PipelineEvent } from "../pipeline/types.js";

type Listener = (event: PipelineEvent) => void;

/**
 * Live state of the demo: one ingest run at a time, a log of its events for the dashboard,
 * and the listeners (open browser tabs) that receive new events.
 */
class Demo {
  private log: PipelineEvent[] = [];
  private listeners = new Set<Listener>();
  private controller: AbortController | undefined;

  get running(): boolean {
    return this.controller !== undefined;
  }

  history(): PipelineEvent[] {
    return this.log;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Seeds the graph on first start, so a fresh install has schools, people and code to link to. */
  async ensureSeeded(): Promise<void> {
    const graph = await getTenantGraph();
    const [tenant] = await run(graph, Q0_STATS).catch(() => []);
    if (!tenant) await seedWorld(graph, config.idHashSalt, config.tenant);
  }

  async reset(): Promise<void> {
    this.stop();
    const graph = await getTenantGraph();
    await resetGraph(graph);
    await seedWorld(graph, config.idHashSalt, config.tenant);
    this.log = [];
    this.emit({ kind: "stats", seen: 0, ignored: 0, used: 0 });
  }

  /** Streams a WhatsApp export through the pipeline in the background. */
  start(exportText: string, delayMs: number): void {
    if (this.running) throw new Error("A replay is already running");
    const { messages } = parseWhatsAppExport(exportText, {
      groupId: DEMO_GROUP_ID,
      salt: config.idHashSalt,
      utcOffset: config.chatUtcOffset,
    });

    const controller = new AbortController();
    this.controller = controller;
    this.emit({ kind: "run", state: "started" });

    getTenantGraph()
      .then((graph) =>
        ingestMessages(messages, { graph, llm: groqLlm, delayMs, signal: controller.signal, emit: (e) => this.emit(e) }),
      )
      .then(() => this.emit({ kind: "run", state: controller.signal.aborted ? "stopped" : "finished" }))
      .catch((error: Error) => {
        console.error(error);
        this.emit({ kind: "run", state: "failed", error: error.message });
      })
      .finally(() => {
        if (this.controller === controller) this.controller = undefined;
      });
  }

  stop(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  private emit(event: PipelineEvent): void {
    this.log.push(event);
    for (const listener of this.listeners) listener(event);
  }
}

export const demo = new Demo();
