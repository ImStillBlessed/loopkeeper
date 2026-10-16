import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireRole, type StaffUser } from "../auth.js";
import { queryLog } from "../graph/activity.js";
import { getFalkorDB, HQ_GRAPH, selectGraph } from "../graph/client.js";
import { DB1_LABELS, DB2_RELATIONSHIPS, DB3_INDEXES, QUERIES, run } from "../graph/queries.js";
import { getWorld } from "../runtime/world.js";

type Env = { Variables: { user: StaffUser } };

/**
 * The database page: what each FalkorDB graph holds, its indexes, and every query as it runs.
 * Counts and query names only, never content, but it spans every client, so only roles that see
 * every client may open it.
 */
export const dbRoutes = new Hono<Env>();

dbRoutes.use("*", requireRole("admin", "lead", "developer"));

interface IndexRow {
  label: string;
  properties: string[];
  types: Record<string, string[]>;
  options: Record<string, Record<string, unknown>>;
  entity: string;
  status: string;
}

dbRoutes.get("/", async (c) => {
  const clients = new Map((await (await getWorld()).registry()).map((r) => [r.id, r.name]));
  const names = (await (await getFalkorDB()).list()).filter((name) => name.startsWith("lk_") && !name.startsWith("lk_test_")).sort(byRole);
  const graphs = [];
  for (const name of names) {
    const graph = await selectGraph(name);
    const [labels, relationships, indexes] = await Promise.all([
      run<{ label: string; count: number }>(graph, DB1_LABELS),
      run<{ type: string; count: number }>(graph, DB2_RELATIONSHIPS),
      run<IndexRow>(graph, DB3_INDEXES),
    ]);
    graphs.push({
      name,
      ...describe(name, clients),
      nodes: labels.reduce((sum, l) => sum + l.count, 0),
      relationships: relationships.reduce((sum, r) => sum + r.count, 0),
      labels,
      relationshipTypes: relationships,
      indexes: indexes.flatMap((index) =>
        index.properties.map((property) => ({
          label: index.label,
          property,
          type: (index.types[property] ?? []).join(", ").toLowerCase(),
          entity: index.entity.toLowerCase(),
          status: index.status.toLowerCase(),
          options: index.options?.[property] ?? {},
        })),
      ),
    });
  }
  return c.json({ graphs });
});

/** Every query as it runs (Server-Sent Events): the recent ones first, then live. */
dbRoutes.get("/queries", (c) =>
  streamSSE(c, async (stream) => {
    for (const entry of queryLog.recent()) await stream.writeSSE({ data: JSON.stringify(entry) });
    const unsubscribe = queryLog.subscribe((entry) => void stream.writeSSE({ data: JSON.stringify(entry) }));
    stream.onAbort(unsubscribe);
    while (!stream.aborted) await stream.sleep(15_000);
    unsubscribe();
  }),
);

/** The Cypher behind a named query. */
dbRoutes.get("/queries/:id", (c) => {
  const named = QUERIES.get(c.req.param("id"));
  return named ? c.json(named) : c.json({ error: "No such query" }, 404);
});

function describe(name: string, clients: Map<string, string>): { kind: string; title: string; holds: string } {
  if (name === HQ_GRAPH) return { kind: "hq", title: "Ednovax HQ", holds: "Products, code, staff, the client registry and patterns across clients (no chat text)" };
  if (name === "lk_hub") return { kind: "hub", title: "Central support hub", holds: "Messages forwarded by staff, and which client each went to" };
  if (name === "lk_desk") return { kind: "desk", title: "Ask across clients", holds: "Staff conversations with Ask about several clients" };
  const clientId = name.replace(/^lk_client_/, "");
  return { kind: "client", title: clients.get(clientId) ?? clientId, holds: "One client's chats, tickets, promises and its copy of the code reference" };
}

/** HQ first, then clients, then the rest. */
function byRole(a: string, b: string): number {
  const rank = (name: string) => (name === HQ_GRAPH ? 0 : name.startsWith("lk_client_") ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}
