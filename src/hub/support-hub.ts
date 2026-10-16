import type { Graph } from "falkordb";
import { config } from "../config.js";
import { selectGraph } from "../graph/client.js";
import { HB1_SAVE, HB2_ROUTE, HB3_IGNORE, HB4_FEED, HB5_LAST_ROUTED_BY, HB6_RESET, HB7_PENDING_COUNT, HB8_FIND_CONTACT } from "../graph/hub-queries.js";
import { run } from "../graph/queries.js";
import { personId, stableId } from "../ingest/ids.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";
import type { HubEntry, HubEvent } from "../pipeline/types.js";
import { clientsNamedIn, continuesThread, isChatter, parseHubMessage, type DirectoryEntry, type ParsedHubMessage } from "./routing.js";

export const HUB_GRAPH = "lk_hub";
/** A follow-up from the same person within this window continues the same client's thread. */
const THREAD_WINDOW_MS = 15 * 60_000;
const MODEL_MIN_CONFIDENCE = 0.6;

/** What the hub needs from the running app. */
export interface HubServices {
  directory: () => Promise<Array<DirectoryEntry & { type: string; city: string; products: string[] }>>;
  clientGraph: (clientId: string) => Graph | undefined;
  /** Passes a message into a client's own pipeline, in its "Central support hub" group. */
  deliver: (clientId: string, senderLabel: string, text: string, ts: number) => Promise<void>;
  emit: (event: HubEvent) => void;
  llm: Llm;
}

interface Decision {
  clientIds: string[];
  method: HubEntry["method"];
  reason: string;
  /** Not about any client (greetings, team chat). */
  ignore?: boolean;
}

/**
 * Ednovax's central support hub: one WhatsApp group where staff forward messages from every school.
 * Each message is worked out to belong to a client and passed into that client's own graph, where it
 * becomes tickets, promises and patterns like any other message. Anything unclear waits for a person.
 */
export class SupportHub {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    readonly graph: Graph,
    private services: HubServices,
  ) {}

  static async open(services: HubServices): Promise<SupportHub> {
    const graph = await selectGraph(HUB_GRAPH);
    await graph.query("CREATE INDEX FOR (m:HubMessage) ON (m.id)").catch(() => undefined);
    return new SupportHub(graph, services);
  }

  /** A message arrives in the hub group. Messages are routed one at a time, in order. */
  receive(senderLabel: string, text: string, ts: number): Promise<void> {
    this.queue = this.queue.then(() => this.route(senderLabel, text, ts)).catch((error: Error) => console.warn(`Hub routing: ${error.message}`));
    return this.queue;
  }

  async feed(limit = 120): Promise<HubEntry[]> {
    return run<HubEntry>(this.graph, HB4_FEED, { limit });
  }

  async pendingCount(): Promise<number> {
    const [row] = await run<{ pending: number }>(this.graph, HB7_PENDING_COUNT);
    return row?.pending ?? 0;
  }

  /** A person routes a waiting message. */
  async assign(id: string, clientIds: string[], by: string): Promise<void> {
    const [message] = await run<{ id: string; ts: number; sender: string; text: string }>(this.graph, HB2_ROUTE, {
      id,
      clientIds,
      method: "manual",
      reason: `Routed by ${by}`,
    });
    if (!message) throw Object.assign(new Error("No such hub message"), { status: 404 });
    const parsed = parseHubMessage(message.text);
    for (const clientId of clientIds) await this.services.deliver(clientId, await this.speakerFor(clientId, message.sender, parsed), parsed.body, message.ts);
    this.services.emit({ kind: "hub", entry: { ...message, status: "routed", clientIds, method: "manual", reason: `Routed by ${by}` } });
  }

  async ignore(id: string, by: string): Promise<void> {
    await run(this.graph, HB3_IGNORE, { id, reason: `Marked not about a client by ${by}` });
  }

  /** Which clients a piece of text is about, by the same rules as hub messages (nothing is saved). */
  async clientsFor(sender: string, text: string): Promise<{ clientIds: string[]; reason: string }> {
    const decision = await this.decide(sender, parseHubMessage(text), text, Date.now(), await this.services.directory());
    return { clientIds: decision.ignore ? [] : decision.clientIds, reason: decision.reason };
  }

  async reset(): Promise<void> {
    await run(this.graph, HB6_RESET);
  }

  // ─── Routing ───────────────────────────────────────────────────────────────

  private async route(senderLabel: string, text: string, ts: number): Promise<void> {
    const parsed = parseHubMessage(text);
    const directory = await this.services.directory();
    const decision = await this.decide(senderLabel, parsed, text, ts, directory);
    const status: HubEntry["status"] = decision.ignore ? "ignored" : decision.clientIds.length ? "routed" : "pending";
    const entry: HubEntry = {
      id: stableId("hub", [senderLabel, text, String(ts)]),
      ts,
      sender: senderLabel,
      text,
      status,
      clientIds: decision.clientIds,
      method: decision.method,
      reason: decision.reason,
    };
    await run(this.graph, HB1_SAVE, entry as unknown as Record<string, unknown>);
    this.services.emit({ kind: "hub", entry });

    for (const clientId of decision.clientIds) {
      await this.services.deliver(clientId, await this.speakerFor(clientId, senderLabel, parsed), parsed.forwarded ? parsed.body : text, ts);
    }
  }

  /** The cheapest signal that settles it wins: named client, known contact, same thread, then the model. */
  private async decide(sender: string, parsed: ParsedHubMessage, text: string, ts: number, directory: DirectoryEntry[]): Promise<Decision> {
    const nameOf = (id: string) => directory.find((c) => c.id === id)?.name ?? id;

    if (parsed.clientHint) {
      const hinted = clientsNamedIn(parsed.clientHint, directory);
      if (hinted.length === 1) return { clientIds: hinted, method: "named", reason: `Forwarded from ${nameOf(hinted[0])}` };
    }

    if (!parsed.forwarded && isChatter(text)) return { clientIds: [], method: "", reason: "Team chatter", ignore: true };

    const named = clientsNamedIn(`${parsed.speaker ?? ""} ${parsed.body}`, directory);
    if (named.length > 0) return { clientIds: named, method: "named", reason: `Mentions ${named.map(nameOf).join(" and ")}` };

    if (parsed.speaker) {
      const owners = await this.clientsKnowing(parsed.speaker, directory);
      if (owners.length === 1) return { clientIds: owners, method: "contact", reason: `${parsed.speaker} is a contact at ${nameOf(owners[0])}` };
    }

    const [recent] = await run<{ clientIds: string[] }>(this.graph, HB5_LAST_ROUTED_BY, { sender, since: ts - THREAD_WINDOW_MS });
    const threadClient = recent?.clientIds?.length === 1 && continuesThread(parsed.body) ? recent.clientIds[0] : undefined;

    const model = await this.askModel(sender, text, directory).catch(() => undefined);
    if (model?.ignore) return { clientIds: [], method: "model", reason: model.reason, ignore: true };
    if (model && model.clientIds.length) return model;

    if (threadClient) return { clientIds: [threadClient], method: "thread", reason: `Continues ${sender}'s message about ${nameOf(threadClient)}` };
    return { clientIds: [], method: "", reason: model ? model.reason : "No client named; waiting for a person to route it" };
  }

  /** Clients that have a contact (not Ednovax staff) with this name. */
  private async clientsKnowing(name: string, directory: DirectoryEntry[]): Promise<string[]> {
    const owners: string[] = [];
    for (const client of directory) {
      const graph = this.services.clientGraph(client.id);
      if (!graph) continue;
      const [row] = await run<{ matches: number }>(graph, HB8_FIND_CONTACT, { name, personId: personId(name, config.idHashSalt) });
      if ((row?.matches ?? 0) > 0) owners.push(client.id);
    }
    return owners;
  }

  private async askModel(sender: string, text: string, directory: Array<DirectoryEntry & { type?: string; city?: string; products?: string[] }>): Promise<Decision | undefined> {
    const recent = (await this.feed(6)).map((m) => ({
      sender: m.sender,
      text: m.text,
      went_to: m.clientIds.map((id) => directory.find((c) => c.id === id)?.name ?? id),
    }));
    const answer = await this.services.llm.json<{ about_a_client: boolean; client_id: string | null; confidence: number; reason: string }>("fast", prompt("route"), {
      clients: directory.map((c) => ({ id: c.id, name: c.name, nicknames: c.aliases, type: c.type, city: c.city, products: c.products })),
      recent_hub_messages: recent,
      new_message: { sender, text },
    });
    if (!answer.about_a_client) return { clientIds: [], method: "model", reason: answer.reason || "Not about a client", ignore: true };
    const known = directory.some((c) => c.id === answer.client_id);
    if (known && answer.confidence >= MODEL_MIN_CONFIDENCE) return { clientIds: [answer.client_id!], method: "model", reason: answer.reason };
    return { clientIds: [], method: "", reason: answer.reason || "The model wasn't sure" };
  }

  /**
   * Who the message is from inside the client's graph: the person the forwarder named, or "<client>
   * (via hub)" for an unnamed forward. Staff speaking for themselves stay themselves.
   */
  private async speakerFor(clientId: string, sender: string, parsed: ParsedHubMessage): Promise<string> {
    if (parsed.speaker) return parsed.speaker;
    if (!parsed.forwarded) return sender;
    const directory = await this.services.directory();
    return `${directory.find((c) => c.id === clientId)?.name ?? clientId} (via hub)`;
  }
}
