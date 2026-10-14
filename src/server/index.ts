import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync } from "node:fs";
import { buildChat, formatExport } from "../../data/synthetic/generator.js";
import { ask } from "../agent/agent.js";
import { config } from "../config.js";
import { getTenantGraph } from "../graph/client.js";
import {
  OPEN_STATUSES,
  Q0_STATS,
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
  W7_CHANGE_STATUS_BY_HUMAN,
} from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";
import { groqLlm } from "../llm/llm.js";
import type { PipelineEvent } from "../pipeline/types.js";
import { demo } from "./demo.js";

const app = new Hono();
const api = new Hono();

const SPEEDS: Record<string, number> = { slow: 1200, normal: 400, fast: 0 };

api.get("/stats", async (c) => {
  const [stats] = await run(await getTenantGraph(), Q0_STATS);
  return c.json({ ...stats, running: demo.running, hasApiKey: Boolean(config.llm.apiKey) });
});

/** Live pipeline events (Server-Sent Events). New tabs first get everything that already happened. */
api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (event: PipelineEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    for (const event of demo.history()) await send(event);

    const unsubscribe = demo.subscribe((event) => void send(event));
    stream.onAbort(unsubscribe);
    while (!stream.aborted) await stream.sleep(15_000);
    unsubscribe();
  }),
);

api.post("/replay", async (c) => {
  const { speed = "normal" } = await c.req.json<{ speed?: string }>().catch(() => ({ speed: "normal" }));
  demo.start(formatExport(buildChat(), "android"), SPEEDS[speed] ?? SPEEDS.normal);
  return c.json({ ok: true });
});

/** Upload your own WhatsApp export (.txt) as the request body. */
api.post("/import", async (c) => {
  demo.start(await c.req.text(), 0);
  return c.json({ ok: true });
});

api.post("/stop", (c) => {
  demo.stop();
  return c.json({ ok: true });
});

api.post("/reset", async (c) => {
  await demo.reset();
  return c.json({ ok: true });
});

api.get("/board", async (c) => {
  const graph = await getTenantGraph();
  const issues = await run<{ id: string }>(graph, Q11_BOARD);
  const ranks = await run<{ id: string; score: number }>(graph, Q7_PRIORITY, { openStatuses: OPEN_STATUSES }).catch(() => []);
  const rank = new Map(ranks.map((r, index) => [r.id, index + 1]));
  return c.json(issues.map((issue) => ({ ...issue, priorityRank: rank.get(issue.id) ?? null })));
});

api.get("/issues/:id", async (c) => {
  const graph = await getTenantGraph();
  const issueId = c.req.param("id");
  const [issue] = await run(graph, Q13_ISSUE, { issueId });
  if (!issue) return c.json({ error: "Not found" }, 404);
  const [code] = await run(graph, Q2_CODE_PATH, { issueId });
  return c.json({
    issue,
    code,
    messages: await run(graph, Q12_EVIDENCE, { issueId }),
    history: await run(graph, Q8_HISTORY, { issueId }),
    impact: await run(graph, Q3_IMPACT, { issueId }),
    dependentCode: await run(graph, Q3B_DEPENDENT_CODE, { issueId }),
  });
});

/** A human confirms or changes a status (e.g. confirming a "possibly resolved" issue). */
api.post("/issues/:id/status", async (c) => {
  const { to } = await c.req.json<{ to: string }>();
  if (!["open", "in_progress", "resolved"].includes(to)) return c.json({ error: "Invalid status" }, 400);
  const graph = await getTenantGraph();
  const issueId = c.req.param("id");
  const ts = Date.now();
  await run(graph, W7_CHANGE_STATUS_BY_HUMAN, { id: stableId("sc", [issueId, to, String(ts)]), issueId, to, ts, by: "Ednovax team (dashboard)" });
  return c.json({ ok: true });
});

api.get("/followups", async (c) => {
  const graph = await getTenantGraph();
  const [stats] = await run<{ clock: number }>(graph, Q0_STATS);
  return c.json({
    now: stats?.clock ?? 0,
    followUps: await run(graph, Q4_DUE_FOLLOWUPS, { until: Number.MAX_SAFE_INTEGER }),
    reminders: await run(graph, Q15_REMINDERS),
    decisions: await run(graph, Q16_DECISIONS),
  });
});

api.get("/graph", async (c) => {
  const graph = await getTenantGraph();
  return c.json({ nodes: await run(graph, Q17_GRAPH_NODES), links: await run(graph, Q18_GRAPH_EDGES) });
});

api.post("/ask", async (c) => {
  const { question } = await c.req.json<{ question: string }>();
  return c.json(await ask(await getTenantGraph(), groqLlm, question));
});

api.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message }, 500);
});

app.route("/api", api);

// In production the built dashboard is served from the same process.
if (existsSync("web/dist")) {
  app.use("/*", serveStatic({ root: "web/dist" }));
}

await demo.ensureSeeded();
serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Loopkeeper API on http://localhost:${port}`);
  if (!config.llm.apiKey) console.warn("⚠ GROQ_API_KEY is not set: replay and ask will fail until you add it to .env (free key: https://console.groq.com/keys)");
});
