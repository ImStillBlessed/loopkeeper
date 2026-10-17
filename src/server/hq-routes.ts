import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isDemo, notDemo, requireRole, visibleClientIds, type StaffUser } from "../auth.js";
import { githubConfigured, normaliseRepo } from "../github/api.js";
import { DEMO_REPOS } from "../../data/synthetic/product.js";
import { repoHealth, type RepoHealth } from "../github/health.js";
import { indexRepository } from "../github/indexer.js";
import { H12_STAFF, H14_SLA_POLICIES, H20_ALL_FEATURES, HD3_ALL_DEPLOYMENTS, HW4_GROUPS, H9_FEATURE_DETAILS, HG2_REPOS, HG5_PRODUCT_OF_REPO, X7_PATTERNS } from "../graph/hq-queries.js";
import { run } from "../graph/queries.js";
import type { HubEvent } from "../pipeline/types.js";
import { continueConversation, deleteConversation, deskGraph, getConversation, listConversations, migrateLegacyQuestions, plainAnswer } from "../agent/conversations.js";
import { askHq } from "../hq/assist.js";
import { analytics, clientSummaries, ticketsFor, type Ticket } from "../hq/insights.js";
import { claudeLlm } from "../llm/llm.js";
import { getWorld, type ClientInput, type ClientRecord, type World } from "../runtime/world.js";
import { config } from "../config.js";
import { saveSettings, setting } from "../settings.js";
import { cloudApiConfigured } from "../whatsapp/cloud-api.js";
import { linkWhatsAppGroup } from "../whatsapp/groups.js";
import { parseWhatsAppExport } from "../ingest/whatsapp-export.js";

type Env = { Variables: { user: StaffUser } };
const HOUR = 60 * 60 * 1000;

/** HQ-level routes: the event stream, live demo controls, clients, products, staff, patterns. */
export const hqRoutes = new Hono<Env>();

// ─── Live events and the demo school ─────────────────────────────────────────

/**
 * The app-wide event stream (Server-Sent Events), limited to the clients this person can see.
 * A new subscriber first gets recent history, unless it asks for ?history=none.
 */
hqRoutes.get("/events", async (c) => {
  const world = await getWorld();
  const visible = new Set(await visibleClientIds(c.get("user")));
  const seesHub = ["admin", "lead", "developer"].includes(c.get("user").role);
  // The demo account gets nothing from beyond the demo school, except whether it's live.
  const demo = isDemo(c.get("user"));
  const allowed = (event: HubEvent) =>
    event.kind === "hub" || event.kind === "import" ? seesHub : event.clientId ? visible.has(event.clientId) : !demo || event.kind === "live";
  const withHistory = c.req.query("history") !== "none";
  return streamSSE(c, async (stream) => {
    const send = (event: HubEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    if (withHistory) for (const event of world.hub.history()) if (allowed(event)) await send(event);
    const unsubscribe = world.hub.subscribe((event) => void (allowed(event) && send(event)));
    stream.onAbort(unsubscribe);
    world.emitLive();
    while (!stream.aborted) await stream.sleep(15_000);
    unsubscribe();
  });
});

hqRoutes.get("/live", async (c) => {
  const world = await getWorld();
  return c.json({ running: world.live, clock: world.clock.peek() });
});

/** Go live: the demo school's teachers (played by the model) start raising problems and reacting. */
hqRoutes.post("/live/start", async (c) => {
  const world = await getWorld();
  world.goLive();
  return c.json({ running: world.live, clock: world.clock.peek() });
});

hqRoutes.post("/live/stop", async (c) => {
  const world = await getWorld();
  world.pauseLive();
  return c.json({ running: false, clock: world.clock.peek() });
});

/** Fast-forward the chat clock, e.g. two days, to watch promises and SLAs fall due. */
hqRoutes.post("/clock/advance", notDemo, async (c) => {
  const { hours } = await c.req.json<{ hours: number }>();
  if (!(hours > 0)) return c.json({ error: "hours must be positive" }, 400);
  const world = await getWorld();
  world.clock.advance(hours * HOUR);
  world.emitLive();
  return c.json({ running: world.live, clock: world.clock.peek() });
});

// ─── Clients ─────────────────────────────────────────────────────────────────

/** The registry entries of the clients this person can see. */
async function visibleClients(user: StaffUser): Promise<ClientRecord[]> {
  const visible = new Set(await visibleClientIds(user));
  return (await (await getWorld()).registry()).filter((client) => visible.has(client.id));
}

/** The client directory: each client this person can see, with health, open tickets and SLA breaches. */
hqRoutes.get("/clients", async (c) => {
  return c.json(await clientSummaries(await getWorld(), await visibleClients(c.get("user"))));
});

hqRoutes.post("/clients", requireRole("admin", "lead"), async (c) => {
  return c.json(await (await getWorld()).addClient(await c.req.json<ClientInput>()));
});

hqRoutes.patch("/clients/:id", requireRole("admin", "lead"), async (c) => {
  await (await getWorld()).updateClient(c.req.param("id"), await c.req.json<ClientInput>());
  return c.json({ ok: true });
});

hqRoutes.delete("/clients/:id", requireRole("admin"), async (c) => {
  await (await getWorld()).removeClient(c.req.param("id"));
  return c.json({ ok: true });
});

// ─── Products, repos, staff, SLA ─────────────────────────────────────────────

hqRoutes.get("/products", async (c) => {
  const products = await (await getWorld()).products();
  if (!isDemo(c.get("user"))) return c.json(products);
  const visible = new Set(await visibleClientIds(c.get("user")));
  return c.json(products.map((product) => ({ ...product, clients: product.clients.filter((id) => visible.has(id)) })));
});

/** The repositories the demo account may see: the ones the demo school runs from. Everyone else sees all. */
async function reposFor(user: StaffUser): Promise<((repo: string) => boolean)> {
  if (!isDemo(user)) return () => true;
  const visible = new Set(await visibleClientIds(user));
  const deployments = await run<{ clientId: string; repo: string }>((await getWorld()).hq, HD3_ALL_DEPLOYMENTS);
  const repos = new Set(deployments.filter((d) => visible.has(d.clientId)).map((d) => d.repo.toLowerCase()));
  return (repo) => repos.has(repo.toLowerCase());
}

hqRoutes.get("/products/:key/features", async (c) => c.json(await run((await getWorld()).hq, H9_FEATURE_DETAILS, { product: c.req.param("key") })));

hqRoutes.get("/repos", async (c) => {
  const world = await getWorld();
  const shown = await reposFor(c.get("user"));
  const repos = (await run<{ id: string }>(world.hq, HG2_REPOS)).filter((r) => shown(r.id));
  return c.json({ githubConfigured: githubConfigured(), lastError: isDemo(c.get("user")) ? null : (world.lastGithubError ?? null), repos });
});

/** Every repository a product or a client uses: access, issues, webhook and code, each with what to do. Cached for a minute. */
let healthCache: { at: number; result: RepoHealth[] } | undefined;
hqRoutes.get("/repos/health", async (c) => {
  if (!healthCache || c.req.query("refresh") || Date.now() - healthCache.at > 60_000) {
    healthCache = { at: Date.now(), result: await repoHealth((await getWorld()).hq) };
  }
  const shown = await reposFor(c.get("user"));
  return c.json(healthCache.result.filter((h) => shown(h.repo)));
});

/**
 * Connect a repository to a product: reads its files, features, owners, imports and source into HQ,
 * then into each client using it. The product's demo stand-in code goes, now that real code is there.
 */
hqRoutes.post("/repos", requireRole("admin", "lead"), async (c) => {
  const { repo, product } = await c.req.json<{ repo: string; product: string }>();
  const world = await getWorld();
  const say = (text: string) => world.hub.emit({ kind: "activity", text: `GitHub: ${text}`, ts: new Date(world.clock.peek()).toISOString(), source: "github" });
  const result = await indexRepository(world.hq, repo, product, say);
  const standIn = DEMO_REPOS[product];
  if (standIn && standIn !== result.repo) await world.forgetRepo(standIn);
  await world.refreshProduct(product);
  healthCache = undefined;
  const health = (await repoHealth(world.hq)).find((h) => h.repo.toLowerCase() === result.repo.toLowerCase());
  say(`Connected ${result.repo} to ${product}: ${result.files} files (${result.read} read), ${result.features} features, ${result.owners} code owners`);
  return c.json({ ...result, health });
});

hqRoutes.delete("/repos/:owner/:name", requireRole("admin", "lead"), async (c) => {
  const world = await getWorld();
  const id = normaliseRepo(`${c.req.param("owner")}/${c.req.param("name")}`);
  const [owner] = await run<{ product: string }>(world.hq, HG5_PRODUCT_OF_REPO, { id });
  await world.forgetRepo(id);
  if (owner) await world.refreshProduct(owner.product);
  healthCache = undefined;
  return c.json({ ok: true });
});

hqRoutes.post("/repos/sync", notDemo, async (c) => {
  await (await getWorld()).syncGithub();
  return c.json({ ok: true });
});

hqRoutes.get("/staff", async (c) => {
  const staff = await run<{ clients: string[] }>((await getWorld()).hq, H12_STAFF);
  if (!isDemo(c.get("user"))) return c.json(staff);
  const visible = new Set(await visibleClientIds(c.get("user")));
  return c.json(staff.map((member) => ({ ...member, clients: member.clients.filter((id) => visible.has(id)) })));
});

hqRoutes.get("/sla", async (c) => c.json(await run((await getWorld()).hq, H14_SLA_POLICIES)));

// ─── Cross-client patterns ───────────────────────────────────────────────────

interface PatternRow {
  id: string;
  title: string;
  feature: string;
  product: string;
  createdAt: number;
  updatedAt: number;
  signals: Array<{ issueId: string; clientId: string; status: string; severity: string; title: string; createdAt: number }>;
  pullRequests: Array<{ number: number | null; title: string; url: string; state: string }>;
}

/**
 * Problems shared across clients. Staff see which of *their* clients are affected; any other client
 * appears only as "another client".
 */
hqRoutes.get("/patterns", async (c) => {
  const world = await getWorld();
  const visible = new Set(await visibleClientIds(c.get("user")));
  const names = new Map((await world.registry()).map((r) => [r.id, r.name]));
  const patterns = await patternsFor(world, c.get("user"));
  return c.json(
    patterns.map((pattern) => ({
      ...pattern,
      pullRequests: pattern.pullRequests.filter((pr) => pr.number !== null),
      clients: [...new Set(pattern.signals.map((s) => s.clientId))].length,
      signals: pattern.signals.map((s) =>
        visible.has(s.clientId)
          ? { ...s, clientName: names.get(s.clientId) ?? s.clientId }
          : { issueId: "", clientId: "", clientName: "Another client", status: s.status, severity: s.severity, title: s.title, createdAt: s.createdAt },
      ),
    })),
  );
});

// ─── The desk: queue, overview, analytics, Ask across clients ────────────────

const OPEN = new Set(["open", "in_progress", "possibly_resolved"]);
const SLA_ORDER = { breached: 0, due_soon: 1, on_track: 2, missed: 3, met: 4 } as const;

/** Most urgent first: SLA breaches, then escalations, then whatever falls due soonest. */
function byUrgency(a: Ticket, b: Ticket): number {
  return SLA_ORDER[a.sla.state] - SLA_ORDER[b.sla.state] || Number(b.escalated) - Number(a.escalated) || a.sla.dueAt - b.sla.dueAt;
}

/** Every ticket across the clients this person can see, most urgent first. */
hqRoutes.get("/tickets", async (c) => {
  const tickets = await ticketsFor(await getWorld(), await visibleClients(c.get("user")));
  return c.json(tickets.sort(byUrgency));
});

/** The patterns this person may see, as the HQ Ask and Overview describe them (other clients never named). */
/** Patterns across clients. The demo account only sees its own school's part of them, and none without it. */
async function patternsFor(world: World, user: StaffUser): Promise<PatternRow[]> {
  const patterns = await run<PatternRow>(world.hq, X7_PATTERNS);
  if (!isDemo(user)) return patterns;
  const visible = new Set(await visibleClientIds(user));
  return patterns
    .map((pattern) => ({ ...pattern, signals: pattern.signals.filter((s) => visible.has(s.clientId)) }))
    .filter((pattern) => pattern.signals.length > 0);
}

async function visiblePatterns(world: World, user: StaffUser) {
  const visible = new Set(await visibleClientIds(user));
  const names = new Map((await world.registry()).map((r) => [r.id, r.name]));
  const patterns = await patternsFor(world, user);
  return patterns.map((p) => ({
    id: p.id,
    title: p.title,
    clients: new Set(p.signals.map((s) => s.clientId)).size,
    statuses: [...new Set(p.signals.map((s) => s.status))],
    affected: [...new Set(p.signals.map((s) => (visible.has(s.clientId) ? (names.get(s.clientId) ?? s.clientId) : "Another client")))],
    pullRequests: p.pullRequests.filter((pr) => pr.number !== null).map((pr) => `#${pr.number} ${pr.title} (${pr.state})`),
  }));
}

/** The home page: what needs attention now, client health, and the shared problems. */
hqRoutes.get("/overview", async (c) => {
  const world = await getWorld();
  const user = c.get("user");
  const clients = await visibleClients(user);
  const tickets = await ticketsFor(world, clients);
  const summaries = await clientSummaries(world, clients, tickets);
  const open = tickets.filter((t) => OPEN.has(t.status));
  const patterns = (await visiblePatterns(world, user)).filter((p) => p.statuses.some((s) => OPEN.has(s)));
  return c.json({
    now: world.clock.peek(),
    kpis: {
      openTickets: open.length,
      breached: open.filter((t) => t.sla.state === "breached").length,
      dueSoon: open.filter((t) => t.sla.state === "due_soon").length,
      escalated: open.filter((t) => t.escalated).length,
      atRisk: summaries.filter((s) => s.health.band === "at_risk").length,
      frustrated: open.filter((t) => t.moods.includes("frustrated")).length,
      sharedProblems: patterns.length,
    },
    attention: open.filter((t) => t.sla.state === "breached" || t.sla.state === "due_soon" || t.escalated).sort(byUrgency).slice(0, 8),
    clients: summaries.sort((a, b) => a.health.score - b.health.score),
    patterns: patterns.slice(0, 5),
  });
});

/** 30-day trends for every client this person can see, or one client, or one product. */
hqRoutes.get("/analytics", async (c) => {
  const world = await getWorld();
  const clientId = c.req.query("client");
  const product = c.req.query("product");
  let clients = await visibleClients(c.get("user"));
  if (clientId) clients = clients.filter((client) => client.id === clientId);
  if (product) clients = clients.filter((client) => client.products.includes(product));
  const features = await run<{ key: string; name: string; product: string }>(world.hq, H20_ALL_FEATURES);
  let tickets = await ticketsFor(world, clients);
  if (product) {
    const productFeatures = new Set(features.filter((f) => f.product === product).map((f) => f.key));
    tickets = tickets.filter((t) => productFeatures.has(t.feature));
  }
  return c.json(analytics(tickets, world.clock.peek(), new Map(features.map((f) => [f.key, f.name]))));
});

/** Ask about the whole desk (every client this person can see). The answer comes from a scoped snapshot. */
hqRoutes.post("/ask", async (c) => {
  const { question, conversationId } = await c.req.json<{ question: string; conversationId?: string }>();
  if (!question?.trim()) return c.json({ error: "Ask a question first" }, 400);
  const world = await getWorld();
  const user = c.get("user");
  const clients = await visibleClients(user);
  const graph = await deskGraph();
  if (conversationId && !(await mayOpen(user, await getConversation(graph, conversationId)))) return c.json({ error: "You don't have access to this conversation" }, 403);
  const tickets = await ticketsFor(world, clients);
  const features = await run<{ key: string; name: string }>(world.hq, H20_ALL_FEATURES);
  return c.json(
    await continueConversation(graph, { question: question.trim(), conversationId, by: user.name, clientIds: clients.map((client) => client.id) }, async (earlier) => {
      const result = await askHq(claudeLlm, question, earlier, {
        now: world.clock.peek(),
        clients: await clientSummaries(world, clients, tickets),
        tickets,
        patterns: await visiblePatterns(world, user),
        analytics: analytics(tickets, world.clock.peek(), new Map(features.map((f) => [f.key, f.name]))),
      });
      // What the person told the model about a client is stored in that client's graph, as their message.
      for (const item of result.remember) await world.addNote(item.clientId, user, item.text);
      const names = new Map(clients.map((client) => [client.id, client.name]));
      return { ...plainAnswer(result.answer), remembered: result.remember.map((r) => `${names.get(r.clientId) ?? r.clientId}: ${r.text}`) };
    }),
  );
});

/** A conversation is open to anyone who can see every client it drew on. */
async function mayOpen(user: StaffUser, conversation: { clientIds: string[] } | undefined): Promise<boolean> {
  // A conversation that drew on no client at all may still be about real ones: not for the demo account.
  if (!conversation || (conversation.clientIds.length === 0 && isDemo(user))) return false;
  const visible = new Set(await visibleClientIds(user));
  return conversation.clientIds.every((id) => visible.has(id));
}

/** Every Ask conversation this person may open, across clients and in each client, newest first. */
hqRoutes.get("/ask/conversations", async (c) => {
  const world = await getWorld();
  const user = c.get("user");
  const clients = await visibleClients(user);
  const desk = await listConversations(await deskGraph());
  const shared = [];
  for (const conversation of desk) if (await mayOpen(user, conversation)) shared.push({ ...conversation, scope: "hq", scopeName: "All clients" });
  for (const client of clients) {
    const graph = world.client(client.id).graph;
    await migrateLegacyQuestions(graph);
    for (const conversation of await listConversations(graph)) shared.push({ ...conversation, scope: client.id, scopeName: client.name });
  }
  return c.json(shared.sort((x, y) => y.updatedAt - x.updatedAt));
});

hqRoutes.get("/ask/conversations/hq/:id", async (c) => {
  const conversation = await getConversation(await deskGraph(), c.req.param("id"));
  if (!(await mayOpen(c.get("user"), conversation))) return c.json({ error: "No such conversation" }, 404);
  return c.json(conversation);
});

hqRoutes.delete("/ask/conversations/hq/:id", async (c) => {
  const user = c.get("user");
  const graph = await deskGraph();
  const conversation = await getConversation(graph, c.req.param("id"));
  if (!(await mayOpen(user, conversation))) return c.json({ error: "No such conversation" }, 404);
  if (conversation!.createdBy && conversation!.createdBy !== user.name && user.role !== "admin" && user.role !== "lead") {
    return c.json({ error: "Only the person who started it, a lead or an admin can delete this conversation" }, 403);
  }
  await deleteConversation(graph, c.req.param("id"));
  return c.json({ ok: true });
});

/** A fresh demo run: the demo school's chats and tickets are cleared and its teachers start again. Real clients are untouched. */
hqRoutes.post("/demo/start-over", requireRole("admin", "lead"), async (c) => {
  await (await getWorld()).startOver();
  return c.json({ ok: true });
});

// ─── The central support hub ─────────────────────────────────────────────────

/** The hub shows every client's messages, so only roles that see every client may open it. */
const hubStaff = requireRole("admin", "lead", "developer");

hqRoutes.get("/hub", hubStaff, async (c) => {
  const hub = (await getWorld()).supportHub;
  return c.json({ entries: await hub.feed(), pending: await hub.pendingCount() });
});

/** A message in the hub, typed on the dashboard (real ones arrive from WhatsApp). */
hqRoutes.post("/hub/send", hubStaff, async (c) => {
  const { sender, text } = await c.req.json<{ sender?: string; text?: string }>();
  if (!text?.trim()) return c.json({ error: "Write a message first" }, 400);
  const world = await getWorld();
  void world.sayInHub(sender?.trim() || c.get("user").name, text.trim());
  return c.json({ ok: true });
});

hqRoutes.post("/hub/:id/assign", hubStaff, async (c) => {
  const { clientIds } = await c.req.json<{ clientIds: string[] }>();
  if (!clientIds?.length) return c.json({ error: "Choose a client" }, 400);
  await (await getWorld()).supportHub.assign(c.req.param("id"), clientIds, c.get("user").name);
  return c.json({ ok: true });
});

hqRoutes.post("/hub/:id/ignore", hubStaff, async (c) => {
  await (await getWorld()).supportHub.ignore(c.req.param("id"), c.get("user").name);
  return c.json({ ok: true });
});

/** A WhatsApp export of the hub group, imported in the background (progress arrives on the event stream). */
hqRoutes.post("/hub/import", hubStaff, async (c) => {
  const world = await getWorld();
  const { messages } = parseWhatsAppExport(await c.req.text(), { groupId: "hub", salt: config.idHashSalt, utcOffset: config.chatUtcOffset });
  if (messages.length === 0) return c.json({ error: "No messages found. Is it a WhatsApp \"Export chat\" file (without media)?" }, 400);
  return c.json(world.hubImport.start(messages.map((m) => ({ sender: m.senderName, text: m.text, ts: Date.parse(m.ts) }))));
});

hqRoutes.get("/hub/import", hubStaff, async (c) => c.json((await getWorld()).hubImport.status()));

hqRoutes.post("/hub/import/stop", hubStaff, async (c) => {
  (await getWorld()).hubImport.stop();
  return c.json({ ok: true });
});

// ─── WhatsApp (Cloud API) groups ─────────────────────────────────────────────

hqRoutes.get("/whatsapp", requireRole("admin", "lead"), async (c) => {
  const world = await getWorld();
  return c.json({ configured: cloudApiConfigured(), hubGroupId: setting("whatsappHubGroupId"), groups: await run(world.hq, HW4_GROUPS) });
});

/** Link a group the support number is in to a client. */
hqRoutes.post("/whatsapp/groups/:id/link", requireRole("admin", "lead"), async (c) => {
  const { clientId, name } = await c.req.json<{ clientId: string; name?: string }>();
  const world = await getWorld();
  const record = (await world.registry()).find((r) => r.id === clientId);
  if (!record) return c.json({ error: "No such client" }, 404);
  await linkWhatsAppGroup(world, clientId, c.req.param("id"), name || `${record.name} × Ednovax Support`);
  return c.json({ ok: true });
});

/** Make a group the central support hub (where staff forward messages from every school). */
hqRoutes.post("/whatsapp/groups/:id/hub", requireRole("admin"), async (c) => {
  await saveSettings({ whatsappHubGroupId: c.req.param("id") });
  return c.json({ ok: true });
});

/** Every client deployment: which repo and branch each client runs (for the products page). */
hqRoutes.get("/deployments", async (c) => {
  const deployments = await run<{ clientId: string }>((await getWorld()).hq, HD3_ALL_DEPLOYMENTS);
  if (!isDemo(c.get("user"))) return c.json(deployments);
  const visible = new Set(await visibleClientIds(c.get("user")));
  return c.json(deployments.filter((d) => visible.has(d.clientId)));
});
