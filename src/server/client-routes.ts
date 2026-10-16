import { Hono } from "hono";
import { askInConversation, deleteConversation, getConversation, listConversations, migrateLegacyQuestions } from "../agent/conversations.js";
import { canSeeClient, requireRole, type StaffUser } from "../auth.js";
import { openGithubIssue } from "../github/issues.js";
import { HG2_REPOS, HW5_GROUP_OF_CLIENT, X11_SIGNAL_GITHUB, X8_PATTERN_FOR_TICKET } from "../graph/hq-queries.js";
import { cloudApiConfigured, createGroup, sendGroupText } from "../whatsapp/cloud-api.js";
import { linkWhatsAppGroup } from "../whatsapp/groups.js";
import {
  C12_PEOPLE,
  F1_RECENT_MESSAGES,
  GH9_CODE_ACTIVITY,
  M3_RENAME_GROUP,
  M4_REMOVE_GROUP,
  OPEN_STATUSES,
  P3_GROUP,
  P4_GROUPS,
  Q11_BOARD,
  Q12_EVIDENCE,
  Q13_ISSUE,
  Q15_REMINDERS,
  Q16_DECISIONS,
  Q17_GRAPH_NODES,
  Q18_GRAPH_EDGES,
  Q2_CODE_PATH,
  Q3B_DEPENDENT_CODE,
  Q3_IMPACT,
  Q4_DUE_FOLLOWUPS,
  Q7_PRIORITY,
  Q19_TEAM_NOTES,
  Q21_LIKELY_CODE,
  Q8_HISTORY,
  run,
  W19_TEAM_NOTE,
  S3_PEOPLE,
  W16_UNASSIGN,
  W17_ASSIGN,
  W18_ESCALATE,
} from "../graph/queries.js";
import { config } from "../config.js";
import { suggestReply } from "../hq/assist.js";
import { groupIdOf } from "../hq/seed.js";
import { clientSummaries, slaFor, slaPolicies, ticketsFor } from "../hq/insights.js";
import { personId, stableId } from "../ingest/ids.js";
import { claudeLlm } from "../llm/llm.js";
import { STATUS_WORDS } from "../pipeline/status.js";
import type { ClientRuntime } from "../runtime/client-runtime.js";
import { getWorld } from "../runtime/world.js";

type Env = { Variables: { user: StaffUser; runtime: ClientRuntime } };

/** Everything inside one client: /api/clients/:client/… Each request checks the person may see this client. */
export const clientRoutes = new Hono<Env>();

clientRoutes.use("*", async (c, next) => {
  const clientId = c.req.param("client") ?? "";
  if (!(await canSeeClient(c.get("user"), clientId))) return c.json({ error: "You don't have access to this client" }, 403);
  c.set("runtime", (await getWorld()).client(clientId));
  await next();
});

const graphOf = (c: { get: (key: "runtime") => ClientRuntime }) => c.get("runtime").graph;

/**
 * The GitHub repositories this client's code lives in: its own deployments first (its own repo, its
 * branch of a shared repo, or the multi-tenant platform), then any other repo of its products.
 */
async function clientRepos(clientId: string): Promise<string[]> {
  const world = await getWorld();
  const client = (await world.registry()).find((r) => r.id === clientId);
  const repos = await run<{ id: string; product: string }>(world.hq, HG2_REPOS);
  const deployed = (client?.deployments ?? []).map((d) => d.repo);
  const ofProducts = repos.filter((r) => client?.products.includes(r.product)).map((r) => r.id);
  return [...new Set([...deployed, ...ofProducts])];
}

clientRoutes.get("/stats", async (c) => c.json(await c.get("runtime").stats()));

clientRoutes.post("/reset", async (c) => {
  await c.get("runtime").reset();
  return c.json({ ok: true });
});

// ─── WhatsApp groups ─────────────────────────────────────────────────────────

clientRoutes.get("/groups", async (c) => c.json(await run(graphOf(c), P4_GROUPS)));

clientRoutes.post("/groups", async (c) => {
  const { name, source = "simulator" } = await c.req.json<{ name: string; source?: "simulator" | "whatsapp_export" | "wa_cloud" }>();
  if (!name?.trim()) return c.json({ error: "Give the group a name" }, 400);
  const id = stableId("grp", [c.get("runtime").id, name.trim().toLowerCase(), String(Date.now())]);
  await run(graphOf(c), P3_GROUP, { id, name: name.trim(), source, ts: Date.now() });
  return c.json({ id });
});

clientRoutes.patch("/groups/:groupId", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "A group needs a name" }, 400);
  await run(graphOf(c), M3_RENAME_GROUP, { id: c.req.param("groupId"), name: name.trim() });
  return c.json({ ok: true });
});

clientRoutes.delete("/groups/:groupId", async (c) => {
  await run(graphOf(c), M4_REMOVE_GROUP, { id: c.req.param("groupId") });
  return c.json({ ok: true });
});

/** Inbound messages, shaped like a WhatsApp webhook: who sent what to which group. */
clientRoutes.post("/groups/:groupId/messages", async (c) => {
  const { sender, text, hasMedia } = await c.req.json<{ sender: string; text: string; hasMedia?: boolean }>();
  if (!sender || (!text && !hasMedia)) return c.json({ error: "A message needs a sender and text" }, 400);
  const runtime = c.get("runtime");
  await runtime.receive(sender, text ?? "", { groupId: c.req.param("groupId"), hasMedia });
  return c.json({ ok: true });
});

/** A WhatsApp "Export chat" .txt file as the request body. */
clientRoutes.post("/groups/:groupId/import", async (c) => {
  const count = c.get("runtime").importExport(c.req.param("groupId"), await c.req.text());
  return c.json({ ok: true, messages: count });
});

/** The client's contacts. */
clientRoutes.get("/people", async (c) => c.json({ people: await run(graphOf(c), C12_PEOPLE) }));

// ─── The demo school: teachers played by the model ──────────────────────────

/** Who at the school is waiting on what (only for a client whose people are simulated). */
clientRoutes.get("/teachers", async (c) => {
  const school = (await getWorld()).school(c.get("runtime").id);
  return school ? c.json(school.view()) : c.json({ error: "This client's people are real, not simulated" }, 404);
});

/** A teacher raises their next problem now, instead of when its turn comes. */
clientRoutes.post("/teachers/next", async (c) => {
  const school = (await getWorld()).school(c.get("runtime").id);
  if (!school) return c.json({ error: "This client's people are real, not simulated" }, 404);
  const teacher = school.raiseNext();
  return teacher ? c.json({ teacher }) : c.json({ error: "The teachers have raised every problem they had" }, 409);
});

// ─── Tickets ─────────────────────────────────────────────────────────────────

clientRoutes.get("/board", async (c) => {
  const graph = graphOf(c);
  const issues = await run<{ id: string }>(graph, Q11_BOARD);
  const ranks = await run<{ id: string }>(graph, Q7_PRIORITY, { openStatuses: OPEN_STATUSES }).catch(() => []);
  const rank = new Map(ranks.map((r, index) => [r.id, index + 1]));
  return c.json(issues.map((issue) => ({ ...issue, priorityRank: rank.get(issue.id) ?? null })));
});

clientRoutes.get("/issues/:id", async (c) => {
  const graph = graphOf(c);
  const runtime = c.get("runtime");
  const issueId = c.req.param("id");
  const [issue] = await run(graph, Q13_ISSUE, { issueId });
  if (!issue) return c.json({ error: "Not found" }, 404);
  const [code] = await run(graph, Q2_CODE_PATH, { issueId });
  const [activity] = await run(graph, GH9_CODE_ACTIVITY, { issueId });
  // Shared problems are shown as counts only: this page is about one client.
  const [pattern] = await run((await getWorld()).hq, X8_PATTERN_FOR_TICKET, { id: issueId, clientId: runtime.id });
  return c.json({
    issue,
    code,
    github: activity,
    pattern: pattern ?? null,
    messages: await run(graph, Q12_EVIDENCE, { issueId }),
    history: await run(graph, Q8_HISTORY, { issueId }),
    impact: await run(graph, Q3_IMPACT, { issueId }),
    dependentCode: await run(graph, Q3B_DEPENDENT_CODE, { issueId }),
    likelyCode: await run(graph, Q21_LIKELY_CODE, { issueId }),
  });
});

/** A person on the dashboard confirms or changes a status. HQ and a linked GitHub issue follow. */
clientRoutes.post("/issues/:id/status", async (c) => {
  const { to } = await c.req.json<{ to: string }>();
  if (!["open", "in_progress", "resolved"].includes(to)) return c.json({ error: "Invalid status" }, 400);
  const runtime = c.get("runtime");
  const changed = await runtime.changeStatus(c.req.param("id"), to, `${c.get("user").name} (dashboard)`);
  if (changed?.changed) runtime.channel().activity(`Marked ${STATUS_WORDS[to]} by ${c.get("user").name}`, c.req.param("id"));
  return c.json({ ok: true });
});

clientRoutes.post("/issues/:id/github", async (c) => {
  const { repo } = await c.req.json<{ repo?: string }>().catch(() => ({}) as { repo?: string });
  const runtime = c.get("runtime");
  const target = repo ?? (await clientRepos(runtime.id))[0];
  if (!target) return c.json({ error: "None of this client's products has a GitHub repository connected yet" }, 400);
  const created = await openGithubIssue(runtime.graph, target, c.req.param("id"));
  // HQ remembers the link, so pull requests that mention the GitHub issue find this ticket.
  await run((await getWorld()).hq, X11_SIGNAL_GITHUB, { id: c.req.param("id"), repo: target, number: created.number });
  runtime.channel().activity(`Opened GitHub issue #${created.number}`, c.req.param("id"));
  return c.json(created);
});

clientRoutes.get("/followups", async (c) => {
  const world = await getWorld();
  return c.json({
    now: world.clock.peek(),
    followUps: await run(graphOf(c), Q4_DUE_FOLLOWUPS, { until: Number.MAX_SAFE_INTEGER }),
    reminders: await run(graphOf(c), Q15_REMINDERS),
    decisions: await run(graphOf(c), Q16_DECISIONS),
  });
});

clientRoutes.get("/graph", async (c) => {
  const graph = graphOf(c);
  return c.json({ nodes: await run(graph, Q17_GRAPH_NODES), links: await run(graph, Q18_GRAPH_EDGES) });
});

// ─── Ask (scoped to this client) ─────────────────────────────────────────────

/**
 * Ask about this client, in an existing conversation or a new one. The agent reads only this
 * client's graph, plus counts from HQ that never name other clients.
 */
clientRoutes.post("/ask", async (c) => {
  const { question, conversationId } = await c.req.json<{ question: string; conversationId?: string }>();
  const runtime = c.get("runtime");
  const world = await getWorld();
  const client = (await world.registry()).find((r) => r.id === runtime.id);
  return c.json(
    await askInConversation(runtime.graph, claudeLlm, {
      question,
      conversationId,
      by: c.get("user").name,
      scope: {
        now: world.clock.peek(),
        repos: await clientRepos(runtime.id),
        hq: world.hq,
        clientId: runtime.id,
        clientName: client?.name,
        // What the person tells the agent is stored as their message, through the client's pipeline.
        remember: (text) => world.addNote(runtime.id, c.get("user"), text),
      },
    }),
  );
});

clientRoutes.get("/conversations", async (c) => {
  await migrateLegacyQuestions(graphOf(c));
  return c.json(await listConversations(graphOf(c)));
});

clientRoutes.get("/conversations/:id", async (c) => {
  const conversation = await getConversation(graphOf(c), c.req.param("id"));
  return conversation ? c.json(conversation) : c.json({ error: "No such conversation" }, 404);
});

/** Conversations are shared: only whoever started one, or a lead or admin, may delete it. */
clientRoutes.delete("/conversations/:id", async (c) => {
  const user = c.get("user");
  const conversation = await getConversation(graphOf(c), c.req.param("id"));
  if (!conversation) return c.json({ error: "No such conversation" }, 404);
  if (conversation.createdBy && conversation.createdBy !== user.name && user.role !== "admin" && user.role !== "lead") {
    return c.json({ error: "Only the person who started it, a lead or an admin can delete this conversation" }, 403);
  }
  await deleteConversation(graphOf(c), c.req.param("id"));
  return c.json({ ok: true });
});


// ─── Desk actions: health, SLA, assignment, escalation, replies ──────────────

async function clientRecord(clientId: string) {
  const world = await getWorld();
  const record = (await world.registry()).find((r) => r.id === clientId);
  if (!record) throw Object.assign(new Error(`No client "${clientId}"`), { status: 404 });
  return record;
}

/** The client's profile header: registry details, health with reasons, and its SLA policy. */
clientRoutes.get("/summary", async (c) => {
  const world = await getWorld();
  const record = await clientRecord(c.get("runtime").id);
  const [summary] = await clientSummaries(world, [record]);
  const policy = (await slaPolicies(world.hq)).get(record.plan) ?? null;
  return c.json({ ...summary, sla: policy, now: world.clock.peek() });
});

/** Every ticket of this client with its SLA state. */
clientRoutes.get("/tickets", async (c) => {
  const world = await getWorld();
  return c.json(await ticketsFor(world, [await clientRecord(c.get("runtime").id)]));
});

clientRoutes.post("/issues/:id/assign", async (c) => {
  const { personId } = await c.req.json<{ personId: string }>();
  const world = await getWorld();
  const runtime = c.get("runtime");
  const issueId = c.req.param("id");
  await run(runtime.graph, W16_UNASSIGN, { issueId });
  const [assigned] = await run<{ name: string }>(runtime.graph, W17_ASSIGN, { issueId, personId, ts: world.clock.peek() });
  if (!assigned) return c.json({ error: "No such ticket or person" }, 404);
  runtime.channel().activity(`Assigned to ${assigned.name} by ${c.get("user").name}`, issueId);
  return c.json({ ok: true, owner: assigned.name });
});

/** Flag a ticket for the support lead. Low and medium severities become high. */
clientRoutes.post("/issues/:id/escalate", async (c) => {
  const { note = "" } = await c.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
  const world = await getWorld();
  const runtime = c.get("runtime");
  const issueId = c.req.param("id");
  const [issue] = await run<{ title: string }>(runtime.graph, W18_ESCALATE, { issueId, ts: world.clock.peek(), by: c.get("user").name, note });
  if (!issue) return c.json({ error: "No such ticket" }, 404);
  runtime.channel().activity(`Escalated by ${c.get("user").name}${note ? `: ${note}` : ""}`, issueId);
  return c.json({ ok: true });
});

/** A draft reply for the agent, from the ticket's facts only. */
clientRoutes.post("/issues/:id/suggest-reply", async (c) => {
  const world = await getWorld();
  const runtime = c.get("runtime");
  const issueId = c.req.param("id");
  const [issue] = await run<{ id: string; title: string; status: string; severity: string; createdAt: number; firstResponseAt: number; resolvedAt: number }>(runtime.graph, Q13_ISSUE, { issueId });
  if (!issue) return c.json({ error: "No such ticket" }, 404);
  const record = await clientRecord(runtime.id);
  const policy = (await slaPolicies(world.hq)).get(record.plan);
  const [pattern] = await run<{ otherClients: number; pullRequests: Array<{ number: number | null; title: string; state: string }> }>(world.hq, X8_PATTERN_FOR_TICKET, { id: issueId, clientId: runtime.id });
  const [activity] = await run<{ pullRequests?: Array<{ title: string; state: string }> }>(runtime.graph, GH9_CODE_ACTIVITY, { issueId });
  const messages = await run<{ sender: string; text: string; ts: number; sentiment: string }>(runtime.graph, Q12_EVIDENCE, { issueId });
  const history = await run<{ to: string; by: string; at: number }>(runtime.graph, Q8_HISTORY, { issueId });
  const pullRequests = [...(activity?.pullRequests ?? []), ...(pattern?.pullRequests ?? []).filter((pr) => pr.number !== null)];
  return c.json(
    await suggestReply(claudeLlm, {
      clientName: record.name,
      title: issue.title,
      status: issue.status,
      severity: issue.severity,
      sla: policy ? slaFor(issue, policy, world.clock.peek()).state : "unknown",
      messages: messages.map((m) => ({ sender: m.sender, text: m.text, ts: m.ts, sentiment: m.sentiment })),
      history: history.map((h) => ({ to: h.to, by: h.by, at: h.at })),
      otherClients: pattern?.otherClients ?? 0,
      pullRequests: pullRequests.map((pr) => ({ title: pr.title, state: pr.state })),
    }),
  );
});

/** Post into the client's WhatsApp group as the signed-in staff member (counts as Ednovax's reply for SLA). */
clientRoutes.post("/reply", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "Write a message first" }, 400);
  const user = c.get("user");
  const runtime = c.get("runtime");
  await run(runtime.graph, S3_PEOPLE, {
    groupId: groupIdOf(runtime.id),
    people: [{ id: personId(user.name, config.idHashSalt), name: user.name, role: user.role === "developer" ? "developer" : "support" }],
  });
  const world = await getWorld();
  await world.say(runtime.id, user.name, text.trim());
  // The support number is the bridge: when the client has a real WhatsApp group, the reply goes there too.
  const [wa] = await run<{ id: string }>(world.hq, HW5_GROUP_OF_CLIENT, { clientId: runtime.id });
  if (wa && cloudApiConfigured()) await sendGroupText(wa.id, text.trim());
  return c.json({ ok: true, sender: user.name, sentToWhatsApp: Boolean(wa && cloudApiConfigured()) });
});

/** The latest stored messages in this client's groups, with the tickets each one fed (small talk is never stored). */
clientRoutes.get("/feed", async (c) => {
  const limit = Math.min(500, Number(c.req.query("limit")) || 200);
  const messages = await run<{ ts: number }>(graphOf(c), F1_RECENT_MESSAGES, { limit });
  return c.json(messages.sort((a, b) => a.ts - b.ts));
});

// ─── Team notes: developers and support talk here, the support number talks to the client ───

clientRoutes.get("/issues/:id/notes", async (c) => c.json(await run(graphOf(c), Q19_TEAM_NOTES, { issueId: c.req.param("id") })));

clientRoutes.post("/issues/:id/notes", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "Write a note first" }, 400);
  const user = c.get("user");
  const runtime = c.get("runtime");
  const issueId = c.req.param("id");
  const ts = (await getWorld()).clock.peek();
  await run(runtime.graph, W19_TEAM_NOTE, { issueId, id: stableId("note", [issueId, user.id, String(ts)]), text: text.trim(), by: user.name, role: user.role, ts });
  runtime.channel().activity(`Team note from ${user.name}`, issueId);
  return c.json({ ok: true });
});

// ─── The client's WhatsApp group on the support number ──────────────────────

/** Creates the client's group from the support number; teachers join with the invite link (groups are small: keep it to the main contacts). */
clientRoutes.post("/whatsapp/create", requireRole("admin", "lead"), async (c) => {
  const world = await getWorld();
  const record = await clientRecord(c.get("runtime").id);
  const { groupId: waGroupId, inviteLink } = await createGroup(`${record.name} × Ednovax Support`, "Report problems and questions here. Ednovax support replies in this group.");
  const groupId = await linkWhatsAppGroup(world, record.id, waGroupId, `${record.name} × Ednovax Support`, inviteLink);
  return c.json({ waGroupId, groupId, inviteLink });
});
