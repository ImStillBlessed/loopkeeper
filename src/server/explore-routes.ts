import { Hono } from "hono";
import { isDemo, visibleClientIds, type StaffUser } from "../auth.js";
import { queryLog, readStatistics } from "../graph/activity.js";
import { clientGraphName, getFalkorDB, HQ_GRAPH, selectGraph } from "../graph/client.js";
import { DB1_LABELS, DB2_RELATIONSHIPS, run } from "../graph/queries.js";
import { getWorld } from "../runtime/world.js";

type Env = { Variables: { user: StaffUser } };

/**
 * The graph explorer (the Network page): run read-only Cypher on a graph you may see and get back
 * nodes and relationships to draw, and rows for a table. Queries go through FalkorDB's read-only
 * command (GRAPH.RO_QUERY, which refuses any write), with a time limit, and the result is capped.
 * Everyone may explore the clients they can see; HQ, the hub and Ask history are for roles that see
 * every client, never the demo account.
 */
export const exploreRoutes = new Hono<Env>();

const TIMEOUT_MS = 5000;
const MAX_ROWS = 1000;
const MAX_NODES = 1500;
const SEES_EVERYTHING = new Set(["admin", "lead", "developer"]);

interface ExploreGraph {
  name: string;
  title: string;
  kind: "client" | "hq" | "hub" | "desk";
}

async function graphsFor(user: StaffUser): Promise<ExploreGraph[]> {
  const world = await getWorld();
  const visible = new Set(await visibleClientIds(user));
  const clients = (await world.registry())
    .filter((client) => visible.has(client.id))
    .map((client): ExploreGraph => ({ name: clientGraphName(client.id), title: client.name, kind: "client" }));
  if (!SEES_EVERYTHING.has(user.role) || isDemo(user)) return clients;
  const existing = new Set(await (await getFalkorDB()).list());
  const shared: ExploreGraph[] = [
    { name: HQ_GRAPH, title: "Ednovax HQ", kind: "hq" },
    { name: "lk_hub", title: "Central support hub", kind: "hub" },
    { name: "lk_desk", title: "Ask across clients", kind: "desk" },
  ];
  return [...clients, ...shared.filter((g) => existing.has(g.name))];
}

async function allowedGraph(user: StaffUser, name: string | undefined): Promise<ExploreGraph | undefined> {
  return (await graphsFor(user)).find((g) => g.name === name);
}

exploreRoutes.get("/graphs", async (c) => c.json(await graphsFor(c.get("user"))));

/** What a graph holds: labels and relationship types with counts, and its property keys. */
exploreRoutes.get("/schema", async (c) => {
  const target = await allowedGraph(c.get("user"), c.req.query("graph"));
  if (!target) return c.json({ error: "You can't explore that graph" }, 403);
  const graph = await selectGraph(target.name);
  const [labels, relationships, keys] = await Promise.all([
    run<{ label: string; count: number }>(graph, DB1_LABELS),
    run<{ type: string; count: number }>(graph, DB2_RELATIONSHIPS),
    graph.roQuery<{ propertyKey: string }>("CALL db.propertyKeys()").then((r) => (r.data ?? []).map((k) => k.propertyKey)),
  ]);
  return c.json({ labels, relationships, propertyKeys: keys });
});

/** Runs one read-only Cypher query. */
exploreRoutes.post("/query", async (c) => {
  const { graph: name, cypher } = await c.req.json<{ graph: string; cypher: string }>();
  if (!cypher?.trim()) return c.json({ error: "Write a Cypher query first" }, 400);
  const target = await allowedGraph(c.get("user"), name);
  if (!target) return c.json({ error: "You can't explore that graph" }, 403);

  const graph = await selectGraph(target.name);
  const started = performance.now();
  const entry = { id: "Explore", title: "A query from the graph explorer", graph: target.name, ts: Date.now(), vector: cypher.includes("db.idx.vector") };
  try {
    const reply = await graph.roQuery<Record<string, unknown>>(cypher, { TIMEOUT: TIMEOUT_MS } as never);
    const stats = readStatistics(reply.metadata);
    const totalMs = performance.now() - started;
    const rows = reply.data ?? [];
    queryLog.record({ ...entry, ...stats, totalMs, rows: rows.length });
    return c.json({ ...toGraph(rows.slice(0, MAX_ROWS)), totalRows: rows.length, engineMs: stats.engineMs, totalMs });
  } catch (error) {
    const message = (error as Error).message;
    queryLog.record({ ...entry, engineMs: 0, cached: false, writes: {}, totalMs: performance.now() - started, rows: 0, error: message });
    const readOnly = /read-only|RO_QUERY/i.test(message);
    return c.json({ error: readOnly ? "The explorer only reads: queries that change the graph aren't allowed here." : message }, 400);
  }
});

// ─── Turning FalkorDB's reply into something to draw ───────────────────────────

interface RawNode {
  id: number;
  labels: string[];
  properties: Record<string, unknown>;
}
interface RawEdge {
  id: number;
  relationshipType: string;
  sourceId: number;
  destinationId: number;
  properties: Record<string, unknown>;
}

export interface ExploreNode {
  id: number;
  label: string;
  caption: string;
  properties: Record<string, unknown>;
}
export interface ExploreLink {
  id: number;
  type: string;
  source: number;
  target: number;
  properties: Record<string, unknown>;
}

const isNode = (v: unknown): v is RawNode => typeof v === "object" && v !== null && "labels" in v && "properties" in v;
const isEdge = (v: unknown): v is RawEdge => typeof v === "object" && v !== null && "relationshipType" in v && "sourceId" in v;
const isPath = (v: unknown): v is { nodes: unknown[]; edges: unknown[] } =>
  typeof v === "object" && v !== null && Array.isArray((v as { nodes?: unknown }).nodes) && Array.isArray((v as { edges?: unknown }).edges);

/** Embeddings are hundreds of numbers: shown as a note, not sent. */
function cleanProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, Array.isArray(value) && value.length > 32 && typeof value[0] === "number" ? `[vector of ${value.length} numbers]` : value]),
  );
}

/** The name to show on a node: the first property that reads like one. */
function captionOf(node: RawNode): string {
  const p = node.properties;
  for (const key of ["name", "title", "path", "text", "email", "key", "id"]) {
    if (typeof p[key] === "string" && p[key]) return String(p[key]).slice(0, 80);
  }
  return `${node.labels[0] ?? "Node"} ${node.id}`;
}

function toGraph(rows: Array<Record<string, unknown>>) {
  const nodes = new Map<number, ExploreNode>();
  const links = new Map<number, ExploreLink>();
  const addNode = (node: RawNode) => {
    if (nodes.size < MAX_NODES && !nodes.has(node.id)) {
      nodes.set(node.id, { id: node.id, label: node.labels[0] ?? "Node", caption: captionOf(node), properties: cleanProperties(node.properties) });
    }
  };
  const visit = (value: unknown): void => {
    if (isNode(value)) addNode(value);
    else if (isEdge(value)) links.set(value.id, { id: value.id, type: value.relationshipType, source: value.sourceId, target: value.destinationId, properties: cleanProperties(value.properties) });
    else if (isPath(value)) [...value.nodes, ...value.edges].forEach(visit);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  for (const row of rows) Object.values(row).forEach(visit);

  // A relationship is drawn only when both of its ends are in the result.
  const drawn = [...links.values()].filter((l) => nodes.has(l.source) && nodes.has(l.target));
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const table = rows.map((row) => Object.fromEntries(columns.map((column) => [column, cell(row[column])])));
  return { nodes: [...nodes.values()], links: drawn, columns, rows: table };
}

/** One table cell: nodes and relationships by their caption, everything else as it is. */
function cell(value: unknown): unknown {
  if (isNode(value)) return `(${value.labels[0] ?? ""}) ${captionOf(value)}`;
  if (isEdge(value)) return `[:${value.relationshipType}]`;
  if (isPath(value)) return `path of ${value.edges.length} hops`;
  if (Array.isArray(value)) return value.length > 32 && typeof value[0] === "number" ? `[vector of ${value.length} numbers]` : value.map(cell);
  return value;
}
