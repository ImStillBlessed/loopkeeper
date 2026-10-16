import type { Graph } from "falkordb";
import { CHATTER, HENSON, PROBLEMS, TEACHERS } from "../../data/demo/henson.js";
import { productsOf, type ClientType, type Deployment, type Plan } from "../../data/synthetic/cast.js";
import { deskGraph } from "../agent/conversations.js";
import { config } from "../config.js";
import { syncRepositories, type GithubRouter } from "../github/activity.js";
import { githubConfigured } from "../github/api.js";
import { getClientGraph, getHqGraph, graphExists, HQ_GRAPH } from "../graph/client.js";
import { H18_CLIENTS, H19_CLIENT_DELETE, H21_SEED_VERSION, H5_PRODUCTS, HG2_REPOS, HG4_REMOVE_REPO, X14_CLIENT_SIGNALS_RESET } from "../graph/hq-queries.js";
import { M2_RENAME_CLIENT, P3_GROUP, RP5_FORGET_REPO, run, S3_PEOPLE } from "../graph/queries.js";
import { ensureSchema } from "../graph/schema.js";
import { SupportHub } from "../hub/support-hub.js";
import { personId } from "../ingest/ids.js";
import { copyProductReference } from "../hq/replicate.js";
import { DEMO_DATA_VERSION, registerClient, resetAllGraphs, resetGraph, seedClientGraph, seedHq } from "../hq/seed.js";
import { claudeLlm } from "../llm/llm.js";
import { ClientRuntime } from "./client-runtime.js";
import { ChatClock } from "./clock.js";
import { EventHub } from "./hub.js";
import { SimulatedSchool } from "./teachers.js";

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
 * The whole running app: the HQ graph, one chat clock, the app-wide event stream, a runtime per
 * client, and the demo school whose teachers the model plays. Created once at startup.
 */
export class World {
  readonly hub = new EventHub();
  readonly clock = new ChatClock();
  /** The central support hub group (set once the clients are loaded). */
  supportHub!: SupportHub;
  private clients = new Map<string, ClientRuntime>();
  /** Clients whose people are simulated (the demo school). */
  private schools = new Map<string, SimulatedSchool>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  lastGithubError: string | undefined;

  private constructor(readonly hq: Graph) {}

  static async start(): Promise<World> {
    const hq = await getHqGraph();
    const world = new World(hq);
    if (!(await graphExists(HQ_GRAPH))) await world.seedDemo();
    else if (await world.demoIsOutdated()) await world.rebuildDemo();
    // Indexes added since a graph was created (e.g. the code vector index) are created now.
    await ensureSchema(hq);
    for (const client of await world.registry()) await world.loadClient(client);
    world.supportHub = await SupportHub.open({
      directory: () => world.registry(),
      clientGraph: (clientId) => world.clients.get(clientId)?.graph,
      deliver: (clientId, sender, text, ts) => world.deliverFromHub(clientId, sender, text, ts),
      emit: (event) => world.hub.emit(event),
      llm: claudeLlm,
    });
    world.startTimers();
    // Live before a restart (or a code reload in development): stay live.
    for (const school of world.schools.values()) if (school.wasLive) school.start();
    return world;
  }

  private async demoIsOutdated(): Promise<boolean> {
    const [row] = await run<{ version: number }>(this.hq, H21_SEED_VERSION);
    return (row?.version ?? 0) < DEMO_DATA_VERSION;
  }

  /** The demo data changed shape since this database was seeded: start again from scratch (settings stay). */
  private async rebuildDemo(): Promise<void> {
    console.log("ℹ Starting the demo data again (its shape changed since this database was seeded)");
    await resetAllGraphs();
    await this.seedDemo();
  }

  /** First start: Ednovax HQ and the demo school with its teachers, and no chat yet. */
  private async seedDemo(): Promise<void> {
    await seedHq(this.hq, config.idHashSalt, [HENSON]);
    const members = TEACHERS.map((t) => ({ name: t.name, role: t.role, atClient: true }));
    await seedClientGraph(this.hq, await getClientGraph(HENSON.id), HENSON, config.idHashSalt, members);
  }

  /**
   * A fresh start for the demo: every client forgets its chat, tickets and promises, the teachers
   * start from their first problem, the hub and Ask history are emptied, and the clock is real time
   * again. Clients, their groups and teachers, products, staff and settings stay.
   */
  async startOver(): Promise<void> {
    this.pauseLive();
    for (const runtime of this.clients.values()) await runtime.reset();
    for (const school of this.schools.values()) await school.reset();
    await this.supportHub.reset();
    await resetGraph(await deskGraph());
    this.clock.reset();
    this.emitLive();
  }

  async registry(): Promise<ClientRecord[]> {
    return run<ClientRecord>(this.hq, H18_CLIENTS);
  }

  private async loadClient(client: ClientRecord): Promise<void> {
    if (!(await graphExists(`lk_client_${client.id}`))) {
      await seedClientGraph(this.hq, await getClientGraph(client.id), client, config.idHashSalt);
    }
    await ensureSchema(await getClientGraph(client.id));
    const runtime = await ClientRuntime.load(client.id, this.services());
    this.clients.set(client.id, runtime);
    if (client.id === HENSON.id) {
      const school = await SimulatedSchool.load(
        { name: client.name, city: client.city, teachers: TEACHERS, problems: PROBLEMS, chatter: CHATTER },
        {
          graph: runtime.graph,
          llm: claudeLlm,
          post: (teacher, text, hasMedia) => runtime.receive(teacher.name, text, { hasMedia }),
          changed: () => this.emitLive(),
        },
      );
      this.schools.set(client.id, school);
    }
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
    this.schools.get(clientId)?.stop();
    this.schools.delete(clientId);
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

  /** Forgets a repository and its files, in HQ and in every client's copy. */
  async forgetRepo(repo: string): Promise<void> {
    await run(this.hq, HG4_REMOVE_REPO, { id: repo });
    for (const runtime of this.clients.values()) await run(runtime.graph, RP5_FORGET_REPO, { repo });
  }

  async products() {
    return run<{ key: string; name: string; description: string; repos: string[]; features: number; clients: string[] }>(this.hq, H5_PRODUCTS);
  }

  // ─── The demo school's teachers (played by the model) ──────────────────────

  get live(): boolean {
    return [...this.schools.values()].some((school) => school.running);
  }

  /** The teachers come to life: they raise problems and react to what Ednovax says and does. */
  goLive(): void {
    for (const school of this.schools.values()) school.start();
    this.emitLive();
  }

  /** The teachers go quiet; returns whether they were live. */
  pauseLive(): boolean {
    const wasLive = this.live;
    for (const school of this.schools.values()) school.stop();
    this.emitLive();
    return wasLive;
  }

  emitLive(): void {
    this.hub.emit({ kind: "live", running: this.live, clock: this.clock.peek() });
  }

  /** The simulated school behind a client, if its people are simulated. */
  school(clientId: string): SimulatedSchool | undefined {
    return this.schools.get(clientId);
  }

  /** A message routed from the central support hub joins the client's "Central support hub" group. */
  private async deliverFromHub(clientId: string, sender: string, text: string, ts: number): Promise<void> {
    const runtime = this.clients.get(clientId);
    if (!runtime) return;
    const groupId = `grp_${clientId}_hub`;
    await run(runtime.graph, P3_GROUP, { id: groupId, name: "Central support hub", source: "hub", ts });
    await runtime.receive(sender, text, { groupId, ts });
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

  /** Someone says something in the central support hub (the dashboard, the CLI, or the WhatsApp webhook). */
  sayInHub(sender: string, text: string, ts = this.clock.now()): Promise<void> {
    return this.supportHub.receive(sender, text, ts);
  }

  /** Ednovax staff write in a client's group. A simulated school hears it and its teachers answer. */
  async say(clientId: string, sender: string, text: string): Promise<void> {
    await this.client(clientId).receive(sender, text);
    this.schools.get(clientId)?.heard(sender, text);
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
