import type { Graph } from "falkordb";
import { HUB_STORY } from "../../data/synthetic/hub-story.js";
import { SupportHub } from "../hub/support-hub.js";
import { claudeLlm } from "../llm/llm.js";
import { CAST, CLIENTS, productsOf, type ClientType, type Deployment, type Plan } from "../../data/synthetic/cast.js";
import { config } from "../config.js";
import { syncRepositories, type GithubRouter } from "../github/activity.js";
import { githubConfigured } from "../github/api.js";
import { getClientGraph, getHqGraph, graphExists, HQ_GRAPH } from "../graph/client.js";
import { H18_CLIENTS, H19_CLIENT_DELETE, H21_SEED_VERSION, H5_PRODUCTS, HG2_REPOS, X14_CLIENT_SIGNALS_RESET } from "../graph/hq-queries.js";
import { M2_RENAME_CLIENT, P3_GROUP, run, S3_PEOPLE } from "../graph/queries.js";
import { personId } from "../ingest/ids.js";
import { copyProductReference } from "../hq/replicate.js";
import { seedClientHistory } from "../hq/history.js";
import { DEMO_DATA_VERSION, registerClient, resetGraph, seedClientGraph, seedHq } from "../hq/seed.js";
import { ClientRuntime } from "./client-runtime.js";
import { ChatClock } from "./clock.js";
import { EventHub } from "./hub.js";
import { Simulator, whatsappLabelFor } from "./simulator.js";

export interface ClientRecord {
  id: string;
  name: string;
  type: ClientType;
  plan: Plan;
  city: string;
  products: string[];
  agentId: string;
  agentName: string;
  aliases: string[];
  deployments: Deployment[];
}

export interface ClientInput {
  name: string;
  type: ClientType;
  plan: Plan;
  city: string;
  /** Used when no deployments are given; otherwise derived from them. */
  products: string[];
  agentId: string;
  aliases?: string[];
  deployments?: Deployment[];
}

/** Products come from the deployments when there are any. */
const withProducts = (input: ClientInput): ClientInput => (input.deployments?.length ? { ...input, products: productsOf(input.deployments) } : input);

/**
 * The whole running app: the HQ graph, one chat clock, the app-wide event stream, the simulated
 * WhatsApp groups, and a runtime per client. Created once at startup.
 */
export class World {
  readonly hub = new EventHub();
  readonly clock = new ChatClock();
  readonly simulator: Simulator;
  /** The central support hub group (set once the clients are loaded). */
  supportHub!: SupportHub;
  private clients = new Map<string, ClientRuntime>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  lastGithubError: string | undefined;

  private constructor(readonly hq: Graph) {
    this.simulator = new Simulator(
      this.clock,
      (m) => void this.clients.get(m.clientId)?.receive(m.senderLabel, m.text, { ts: m.ts, hasMedia: m.hasMedia }),
      () => this.emitLive(),
      () => [...this.clients.keys()],
    );
  }

  static async start(): Promise<World> {
    const hq = await getHqGraph();
    const world = new World(hq);
    if (!(await graphExists(HQ_GRAPH))) await world.seedDemo();
    else if (await world.demoIsOutdated()) await world.rebuildDemo();
    for (const client of await world.registry()) await world.loadClient(client);
    world.supportHub = await SupportHub.open({
      directory: () => world.registry(),
      clientGraph: (clientId) => world.clients.get(clientId)?.graph,
      deliver: (clientId, sender, text, ts) => world.deliverFromHub(clientId, sender, text, ts),
      emit: (event) => world.hub.emit(event),
      llm: claudeLlm,
    });
    world.startTimers();
    return world;
  }

  private async demoIsOutdated(): Promise<boolean> {
    const [row] = await run<{ version: number }>(this.hq, H21_SEED_VERSION);
    return (row?.version ?? 0) < DEMO_DATA_VERSION;
  }

  /** The demo data changed shape since this database was seeded: start the demo afresh. */
  private async rebuildDemo(): Promise<void> {
    console.log("ℹ Rebuilding the demo data (its shape changed since this database was seeded)");
    await resetGraph(this.hq);
    for (const client of CLIENTS) await resetGraph(await getClientGraph(client.id));
    await this.seedDemo();
  }

  /** First start: Ednovax HQ and the four demo clients, each in its own graph. */
  private async seedDemo(): Promise<void> {
    await seedHq(this.hq, config.idHashSalt);
    for (const client of CLIENTS) {
      const graph = await getClientGraph(client.id);
      await seedClientGraph(this.hq, graph, client, config.idHashSalt);
      await seedClientHistory(this.hq, graph, client.id, this.clock.peek());
    }
  }

  /**
   * Puts the demo clients back to their four weeks of history, ending now: forgets what was learned
   * since (live chat, imports), sets the chat clock back to real time and writes the history again.
   * Groups, contacts, products and staff stay.
   */
  async restoreDemoHistory(): Promise<number> {
    this.pauseLive();
    const demo = CLIENTS.map((client) => this.clients.get(client.id)).filter((runtime) => runtime !== undefined);
    // Forget everything first, so the history's shared problems form fresh patterns.
    for (const runtime of demo) await runtime.reset();
    await this.supportHub.reset();
    this.clock.reset();
    let tickets = 0;
    for (const runtime of demo) tickets += await seedClientHistory(this.hq, runtime.graph, runtime.id, this.clock.peek());
    for (const runtime of demo) await runtime.restoreFeed();
    this.emitLive();
    return tickets;
  }

  async registry(): Promise<ClientRecord[]> {
    return run<ClientRecord>(this.hq, H18_CLIENTS);
  }

  private async loadClient(client: ClientRecord): Promise<void> {
    if (!(await graphExists(`lk_client_${client.id}`))) {
      await seedClientGraph(this.hq, await getClientGraph(client.id), client, config.idHashSalt);
    }
    this.clients.set(client.id, await ClientRuntime.load(client.id, this.services()));
  }

  private services() {
    return { hq: this.hq, hub: this.hub, clock: this.clock, pauseLive: () => this.pauseLive() };
  }

  client(clientId: string): ClientRuntime {
    const runtime = this.clients.get(clientId);
    if (!runtime) throw Object.assign(new Error(`No client "${clientId}"`), { status: 404 });
    return runtime;
  }

  clientIds(): string[] {
    return [...this.clients.keys()];
  }

  // ─── Managing clients ──────────────────────────────────────────────────────

  async addClient(raw: ClientInput): Promise<ClientRecord> {
    const input = withProducts(raw);
    const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    if (!id) throw new Error("Give the client a name with letters or digits");
    if (this.clients.has(id)) throw new Error(`A client called "${input.name}" already exists`);
    await registerClient(this.hq, { id, agent: input.agentId, ...input });
    await seedClientGraph(this.hq, await getClientGraph(id), { id, ...input }, config.idHashSalt);
    const [record] = (await this.registry()).filter((c) => c.id === id);
    await this.loadClient(record);
    return record;
  }

  async updateClient(clientId: string, raw: ClientInput): Promise<void> {
    const input = withProducts(raw);
    const runtime = this.client(clientId);
    await registerClient(this.hq, { id: clientId, agent: input.agentId, ...input });
    await run(runtime.graph, M2_RENAME_CLIENT, { name: input.name });
    await copyProductReference(this.hq, runtime.graph, input.products);
  }

  /** Deletes the client's whole graph and its signals in HQ. There is no undo. */
  async removeClient(clientId: string): Promise<void> {
    const runtime = this.client(clientId);
    runtime.dispose();
    this.clients.delete(clientId);
    await resetGraph(runtime.graph);
    await run(this.hq, X14_CLIENT_SIGNALS_RESET, { clientId });
    await run(this.hq, H19_CLIENT_DELETE, { id: clientId });
    this.hub.clearClient(clientId);
  }

  /** After a product's code changes (a repo connected or re-indexed), every client using it gets the new reference. */
  async refreshProduct(product: string): Promise<void> {
    for (const client of await this.registry()) {
      if (client.products.includes(product)) await copyProductReference(this.hq, this.client(client.id).graph, client.products);
    }
  }

  async products() {
    return run<{ key: string; name: string; description: string; repos: string[]; features: number; clients: string[] }>(this.hq, H5_PRODUCTS);
  }

  // ─── The live (simulated) WhatsApp groups ──────────────────────────────────

  goLive(paceMs?: number): void {
    this.simulator.start(paceMs);
  }

  /** Pauses the simulated groups; returns whether they were running. */
  pauseLive(): boolean {
    const wasLive = this.simulator.running;
    this.simulator.stop();
    return wasLive;
  }

  emitLive(): void {
    this.hub.emit({ kind: "live", running: this.simulator.running, clock: this.clock.peek() });
  }

  /** A message routed from the central support hub joins the client's "Central support hub" group. */
  private async deliverFromHub(clientId: string, sender: string, text: string, ts: number): Promise<void> {
    const runtime = this.clients.get(clientId);
    if (!runtime) return;
    const groupId = `grp_${clientId}_hub`;
    await run(runtime.graph, P3_GROUP, { id: groupId, name: "Central support hub", source: "hub", ts });
    await runtime.receive(whatsappLabelFor(sender), text, { groupId, ts });
  }

  /**
   * A staff member adds information from Ask. It goes through the client's own pipeline as a trusted
   * message in its "Ask notes" group, so it becomes tickets, promises or decisions where it is one,
   * and the agent can find it later either way.
   */
  async addNote(clientId: string, staff: { name: string; role: string }, text: string): Promise<void> {
    const runtime = this.client(clientId);
    const ts = this.clock.now();
    const groupId = `grp_${clientId}_desk`;
    await run(runtime.graph, P3_GROUP, { id: groupId, name: "Ask notes", source: "desk", ts });
    await run(runtime.graph, S3_PEOPLE, {
      groupId,
      people: [{ id: personId(staff.name, config.idHashSalt), name: staff.name, role: staff.role === "developer" ? "developer" : "support" }],
    });
    await runtime.receive(staff.name, text, { groupId, ts, trusted: true });
  }

  /** Someone says something in the central support hub (simulator, CLI, or the WhatsApp webhook). */
  sayInHub(sender: string, text: string, ts = this.clock.now()): Promise<void> {
    return this.supportHub.receive(whatsappLabelFor(sender), text, ts);
  }

  /** Plays a morning in the hub: staff forwarding messages from several schools. */
  async playHubStory(paceMs = 2500): Promise<number> {
    for (const line of HUB_STORY) {
      const member = CAST.find((m) => m.key === line.sender);
      await this.sayInHub(member?.name ?? line.sender, line.text);
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
    return HUB_STORY.length;
  }

  /** Someone in a client's group says something (from the composer or the CLI). */
  say(clientId: string, sender: string, text: string): void {
    void this.client(clientId).receive(whatsappLabelFor(sender), text);
  }

  // ─── GitHub ────────────────────────────────────────────────────────────────

  githubRouter(): GithubRouter {
    return {
      hq: this.hq,
      client: (clientId) => this.clients.get(clientId)?.channel(),
      activity: (text) => this.hub.emit({ kind: "activity", text, ts: new Date(this.clock.peek()).toISOString(), source: "github" }),
    };
  }

  async syncGithub(): Promise<void> {
    try {
      await syncRepositories(this.githubRouter());
      this.lastGithubError = undefined;
    } catch (error) {
      this.lastGithubError = (error as Error).message;
      throw error;
    }
  }

  private startTimers(): void {
    // Picks up pull requests and pushes. Checks for a token each time, so one saved in Settings starts it.
    this.timers.push(
      setInterval(async () => {
        if (!githubConfigured()) return;
        const repos = await run(this.hq, HG2_REPOS).catch(() => []);
        if (repos.length) await this.syncGithub().catch((error: Error) => console.warn(`GitHub poll: ${error.message}`));
      }, config.github.pollSeconds * 1000),
    );
  }
}

let world: Promise<World> | undefined;

/** The one World for this process. */
export function getWorld(): Promise<World> {
  world ??= World.start();
  return world;
}
