import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PREPARED_KINDS, type PreparedKind } from "../../data/synthetic/prepared.js";
import type { ScenarioId } from "../../data/synthetic/scenarios.js";
import { askInConversation, deleteConversation, getConversation, listConversations, migrateLegacyQuestions } from "../agent/conversations.js";
import { githubConfigured } from "../github/api.js";
import { indexRepository } from "../github/indexer.js";
import { openGithubIssue, syncGithubIssue } from "../github/issues.js";
import { listProjectIds } from "../graph/client.js";
import {
  C12_PEOPLE,
  GH9_CODE_ACTIVITY,
  OPEN_STATUSES,
  P4_GROUPS,
  P6_REPOS,
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
  Q8_HISTORY,
  run,
} from "../graph/queries.js";
import { groqLlm } from "../llm/llm.js";
import { changeStatusFromOutside, STATUS_WORDS } from "../pipeline/status.js";
import type { PipelineEvent } from "../pipeline/types.js";
import { getRuntime, type ProjectRuntime } from "../runtime/project.js";
import { addGroup, removeGroup, removeRepo, renameGroup } from "../runtime/projects.js";
import { castPeople, resolveSender } from "../runtime/simulator.js";

type Env = { Variables: { runtime: ProjectRuntime } };
const HOUR = 60 * 60 * 1000;

/** Everything under /api/projects/:project. */
export const projectRoutes = new Hono<Env>();

projectRoutes.use("*", async (c, next) => {
  const id = c.req.param("project") ?? "";
  if (!(await listProjectIds()).includes(id)) return c.json({ error: `No project "${id}"` }, 404);
  c.set("runtime", await getRuntime(id));
  await next();
});

const graphOf = (c: { get: (key: "runtime") => ProjectRuntime }) => c.get("runtime").graph;

/** The group a request is about: the one named, or the project's first group. */
async function groupOrFirst(runtime: ProjectRuntime, groupId?: string): Promise<string> {
  if (groupId) return groupId;
  const [first] = await run<{ id: string }>(runtime.graph, P4_GROUPS);
  if (!first) throw new Error("This project has no WhatsApp group yet. Add one first.");
  return first.id;
}

// ─── Live state ──────────────────────────────────────────────────────────────

projectRoutes.get("/stats", async (c) => c.json(await c.get("runtime").stats()));

/** Live events (Server-Sent Events). A new subscriber first gets recent history, unless it asks for ?history=none. */
projectRoutes.get("/events", (c) => {
  const runtime = c.get("runtime");
  const withHistory = c.req.query("history") !== "none";
  return streamSSE(c, async (stream) => {
    const send = (event: PipelineEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    if (withHistory) for (const event of runtime.hub.history()) await send(event);
    const unsubscribe = runtime.hub.subscribe((event) => void send(event));
    stream.onAbort(unsubscribe);
    runtime.emitLive();
    while (!stream.aborted) await stream.sleep(15_000);
    unsubscribe();
  });
});

projectRoutes.post("/reset", async (c) => {
  await c.get("runtime").reset();
  return c.json({ ok: true });
});

// ─── WhatsApp groups ─────────────────────────────────────────────────────────

projectRoutes.get("/groups", async (c) => c.json(await run(graphOf(c), P4_GROUPS)));

projectRoutes.post("/groups", async (c) => {
  const { name, source = "simulator" } = await c.req.json<{ name: string; source?: "simulator" | "whatsapp_export" | "wa_cloud" }>();
  if (!name?.trim()) return c.json({ error: "Give the group a name" }, 400);
  return c.json(await addGroup(c.get("runtime").id, name, source));
});

projectRoutes.patch("/groups/:groupId", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  await renameGroup(c.get("runtime").id, c.req.param("groupId"), name ?? "");
  return c.json({ ok: true });
});

projectRoutes.delete("/groups/:groupId", async (c) => {
  const runtime = c.get("runtime");
  if (runtime.simulator.groupId === c.req.param("groupId")) runtime.simulator.stop();
  await removeGroup(runtime.id, c.req.param("groupId"));
  return c.json({ ok: true });
});

/** Inbound messages, shaped like a WhatsApp webhook: who sent what to which group. */
projectRoutes.post("/groups/:groupId/messages", async (c) => {
  const { sender, text, hasMedia } = await c.req.json<{ sender: string; text: string; hasMedia?: boolean }>();
  if (!sender || (!text && !hasMedia)) return c.json({ error: "A message needs a sender and text" }, 400);
  c.get("runtime").receive(c.req.param("groupId"), labelFor(sender), text ?? "", { hasMedia });
  return c.json({ ok: true });
});

/** A WhatsApp "Export chat" .txt file as the request body. */
projectRoutes.post("/groups/:groupId/import", async (c) => {
  const count = c.get("runtime").importExport(c.req.param("groupId"), await c.req.text());
  return c.json({ ok: true, messages: count });
});

/** Everyone in the project, plus the demo cast the simulator can speak as. */
projectRoutes.get("/people", async (c) =>
  c.json({
    people: await run(graphOf(c), C12_PEOPLE),
    cast: castPeople().map((m) => ({ key: m.key, name: m.name, role: m.role })),
  }),
);

// ─── The simulated WhatsApp connection ───────────────────────────────────────

projectRoutes.post("/live/start", async (c) => {
  const { groupId, paceMs } = await c.req.json<{ groupId?: string; paceMs?: number }>().catch(() => ({}) as { groupId?: string; paceMs?: number });
  const runtime = c.get("runtime");
  runtime.simulator.start(await groupOrFirst(runtime, groupId), paceMs);
  return c.json(await runtime.stats());
});

projectRoutes.post("/live/stop", async (c) => {
  c.get("runtime").simulator.stop();
  return c.json(await c.get("runtime").stats());
});

/** Send one message: a prepared kind (issue, greeting, question, promise, fixed) or custom text. */
projectRoutes.post("/live/send", async (c) => {
  const body = await c.req.json<{ groupId?: string; sender?: string; text?: string; kind?: PreparedKind }>();
  const runtime = c.get("runtime");
  const groupId = await groupOrFirst(runtime, body.groupId);
  if (body.kind) {
    if (!PREPARED_KINDS.includes(body.kind)) return c.json({ error: `Kind must be one of ${PREPARED_KINDS.join(", ")}` }, 400);
    return c.json(runtime.simulator.prepared(groupId, body.kind, body.sender));
  }
  if (!body.sender || !body.text) return c.json({ error: "Send needs a sender and text, or a kind" }, 400);
  const sender = resolveSender(body.sender);
  runtime.simulator.say(groupId, sender, body.text);
  return c.json({ sender, text: body.text });
});

projectRoutes.post("/live/story", async (c) => {
  const { groupId, scenario } = await c.req.json<{ groupId?: string; scenario: ScenarioId }>();
  const runtime = c.get("runtime");
  const target = await groupOrFirst(runtime, groupId);
  // Plays in the background; the messages show up on the event stream.
  void runtime.simulator.playStory(target, scenario);
  return c.json({ ok: true, scenario });
});

/** Fast-forward the chat clock, e.g. two days, to watch promises fall due. */
projectRoutes.post("/clock/advance", async (c) => {
  const { hours } = await c.req.json<{ hours: number }>();
  if (!(hours > 0)) return c.json({ error: "hours must be positive" }, 400);
  const runtime = c.get("runtime");
  runtime.clock.advance(hours * HOUR);
  runtime.emitLive();
  return c.json(await runtime.stats());
});

// ─── GitHub ──────────────────────────────────────────────────────────────────

projectRoutes.get("/repos", async (c) => c.json({ githubConfigured: githubConfigured(), lastError: c.get("runtime").lastGithubError ?? null, repos: await run(graphOf(c), P6_REPOS) }));

/** Connect a repository: reads its files, features, owners and imports into the graph. */
projectRoutes.post("/repos", async (c) => {
  const { repo } = await c.req.json<{ repo: string }>();
  const result = await indexRepository(graphOf(c), repo);
  c.get("runtime").sink.activity(`Connected ${result.repo}: ${result.files} files, ${result.features} features, ${result.owners} code owners`);
  return c.json(result);
});

projectRoutes.delete("/repos/:owner/:name", async (c) => {
  await removeRepo(c.get("runtime").id, `${c.req.param("owner")}/${c.req.param("name")}`);
  return c.json({ ok: true });
});

projectRoutes.post("/repos/sync", async (c) => {
  await c.get("runtime").syncGithub();
  return c.json({ ok: true });
});

projectRoutes.post("/issues/:id/github", async (c) => {
  const { repo } = await c.req.json<{ repo?: string }>().catch(() => ({}) as { repo?: string });
  const repos = await run<{ id: string }>(graphOf(c), P6_REPOS);
  const target = repo ?? repos[0]?.id;
  if (!target) return c.json({ error: "Connect a GitHub repository to this project first" }, 400);
  const created = await openGithubIssue(graphOf(c), target, c.req.param("id"));
  c.get("runtime").sink.activity(`Opened GitHub issue #${created.number}`, c.req.param("id"));
  return c.json(created);
});

// ─── Issues, promises, graph, ask ────────────────────────────────────────────

projectRoutes.get("/board", async (c) => {
  const graph = graphOf(c);
  const issues = await run<{ id: string }>(graph, Q11_BOARD);
  const ranks = await run<{ id: string }>(graph, Q7_PRIORITY, { openStatuses: OPEN_STATUSES }).catch(() => []);
  const rank = new Map(ranks.map((r, index) => [r.id, index + 1]));
  return c.json(issues.map((issue) => ({ ...issue, priorityRank: rank.get(issue.id) ?? null })));
});

projectRoutes.get("/issues/:id", async (c) => {
  const graph = graphOf(c);
  const issueId = c.req.param("id");
  const [issue] = await run(graph, Q13_ISSUE, { issueId });
  if (!issue) return c.json({ error: "Not found" }, 404);
  const [code] = await run(graph, Q2_CODE_PATH, { issueId });
  const [activity] = await run(graph, GH9_CODE_ACTIVITY, { issueId });
  return c.json({
    issue,
    code,
    github: activity,
    messages: await run(graph, Q12_EVIDENCE, { issueId }),
    history: await run(graph, Q8_HISTORY, { issueId }),
    impact: await run(graph, Q3_IMPACT, { issueId }),
    dependentCode: await run(graph, Q3B_DEPENDENT_CODE, { issueId }),
  });
});

/** A person on the dashboard confirms or changes a status. A linked GitHub issue follows. */
projectRoutes.post("/issues/:id/status", async (c) => {
  const { to } = await c.req.json<{ to: string }>();
  if (!["open", "in_progress", "resolved"].includes(to)) return c.json({ error: "Invalid status" }, 400);
  const runtime = c.get("runtime");
  const changed = await changeStatusFromOutside(runtime.graph, c.req.param("id"), to, "Support team (dashboard)", runtime.clock.peek());
  if (changed) {
    runtime.sink.activity(`Marked ${STATUS_WORDS[to]} from the dashboard`, changed.id);
    syncGithubIssue(runtime.graph, changed.id, to, "Confirmed by the support team.").catch((e: Error) => console.warn(e.message));
  }
  return c.json({ ok: true });
});

projectRoutes.get("/followups", async (c) => {
  const runtime = c.get("runtime");
  return c.json({
    now: runtime.clock.peek(),
    followUps: await run(runtime.graph, Q4_DUE_FOLLOWUPS, { until: Number.MAX_SAFE_INTEGER }),
    reminders: await run(runtime.graph, Q15_REMINDERS),
    decisions: await run(runtime.graph, Q16_DECISIONS),
  });
});

projectRoutes.get("/graph", async (c) => {
  const graph = graphOf(c);
  return c.json({ nodes: await run(graph, Q17_GRAPH_NODES), links: await run(graph, Q18_GRAPH_EDGES) });
});

/**
 * Ask a question, in an existing conversation or a new one. The agent sees the conversation so far,
 * and the conversation is remembered in the graph, linked to what its answers used.
 */
projectRoutes.post("/ask", async (c) => {
  const { question, conversationId } = await c.req.json<{ question: string; conversationId?: string }>();
  const runtime = c.get("runtime");
  return c.json(await askInConversation(runtime.graph, groqLlm, { question, conversationId, now: runtime.clock.peek() }));
});

projectRoutes.get("/conversations", async (c) => {
  const runtime = c.get("runtime");
  await migrateLegacyQuestions(runtime.graph);
  return c.json(await listConversations(runtime.graph));
});

projectRoutes.get("/conversations/:id", async (c) => {
  const conversation = await getConversation(graphOf(c), c.req.param("id"));
  return conversation ? c.json(conversation) : c.json({ error: "No such conversation" }, 404);
});

projectRoutes.delete("/conversations/:id", async (c) => {
  await deleteConversation(graphOf(c), c.req.param("id"));
  return c.json({ ok: true });
});

/** The simulator speaks as cast members by their WhatsApp label (some appear as phone numbers). */
function labelFor(sender: string): string {
  const name = resolveSender(sender);
  return castPeople().find((m) => m.name === name)?.whatsappLabel ?? name;
}
