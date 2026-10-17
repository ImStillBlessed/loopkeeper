import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Expand, Minus, Play, Plus, Waypoints, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GraphCanvas, type GraphControls, type Selection } from "@/components/graph-canvas";
import { ErrorNote, Loading, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api, type ExploreGraph, type ExploreResult } from "@/lib/api";
import { plural } from "@/lib/format";
import { NODE_COLORS } from "@/lib/palette";
import { href, navigate } from "@/lib/router";

/** Colours for labels without one of their own, picked by the label's name so they stay put. */
const SPARE_COLORS = ["#1f6bff", "#16a34a", "#d97706", "#7c3aed", "#0ea5e9", "#db2777", "#0d9488", "#ca8a04", "#4f46e5", "#e11d48"];
function colorOf(label: string): string {
  if (NODE_COLORS[label]) return NODE_COLORS[label];
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPARE_COLORS[hash % SPARE_COLORS.length];
}

const START = "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 150";

/** Ready-made queries that show what the graph is for. */
const EXAMPLES: Record<ExploreGraph["kind"], Array<{ title: string; cypher: string }>> = {
  client: [
    { title: "Tickets and everything they touch", cypher: "MATCH (i:Issue)-[r]-(m) RETURN i, r, m LIMIT 200" },
    { title: "Each ticket with its feature, code and owner", cypher: "MATCH (i:Issue) OPTIONAL MATCH (i)-[a:AFFECTS]->(f:Feature) OPTIONAL MATCH (i)-[l:LIKELY_IN]->(c:CodeFile) OPTIONAL MATCH (i)-[t:ASSIGNED_TO]->(o:Person) RETURN i, a, f, l, c, t, o LIMIT 200" },
    { title: "Where tickets likely live in the code", cypher: "MATCH p = (:Issue)-[:LIKELY_IN]->(:CodeFile) RETURN p" },
    { title: "Who said what, and which ticket it became", cypher: "MATCH p = (:Person)-[:SENT]->(:Message)-[:EVIDENCE_OF]->(:Issue) RETURN p LIMIT 120" },
    { title: "Promises and who owes them", cypher: "MATCH p = (:FollowUp)-[:ASSIGNED_TO]->(:Person) RETURN p" },
    { title: "How the code imports itself", cypher: "MATCH p = (:CodeFile)-[:IMPORTS]->(:CodeFile) RETURN p LIMIT 300" },
    { title: "Tickets by status (a table)", cypher: "MATCH (i:Issue) RETURN i.status AS status, count(i) AS tickets ORDER BY tickets DESC" },
    { title: "Most important open tickets (PageRank)", cypher: "CALL algo.pageRank(null, null) YIELD node, score WHERE node:Issue AND node.status <> 'resolved' RETURN node.title AS ticket, node.status AS status, score ORDER BY score DESC LIMIT 10" },
  ],
  hq: [
    { title: "Clients, products and where they run", cypher: "MATCH p = (:Client)-[:DEPLOYED_AS|USES]->() RETURN p LIMIT 200" },
    { title: "Products, features and code", cypher: "MATCH p = (:Product)-[:HAS_FEATURE]->(:Feature)-[:IMPLEMENTED_IN]->(:CodeFile) RETURN p LIMIT 200" },
    { title: "Problems shared across clients", cypher: "MATCH p = (:Signal)-[:PART_OF]->(:Pattern) RETURN p" },
    { title: "Staff and the clients they look after", cypher: "MATCH p = (:Client)-[:ASSIGNED_AGENT]->(:Staff) RETURN p" },
  ],
  hub: [
    { title: "The latest hub messages", cypher: "MATCH (m:HubMessage) RETURN m.sender AS sender, m.text AS text, m.status AS status ORDER BY m.ts DESC LIMIT 50" },
    { title: "Where hub messages went", cypher: "MATCH (m:HubMessage) RETURN m.status AS status, count(m) AS messages" },
  ],
  desk: [{ title: "Ask conversations", cypher: "MATCH (c:Conversation) RETURN c.title AS title, c.createdBy AS by, c.turnCount AS turns ORDER BY c.updatedAt DESC LIMIT 50" }],
};

/**
 * The graph explorer, in the spirit of FalkorDB Browser: pick a graph you may see, read what it holds,
 * run read-only Cypher (or a ready-made query), and click anything to see its properties.
 * Double-click a node to bring in its neighbours.
 */
export function NetworkPage({ clientId }: { clientId?: string }) {
  const [graphs, setGraphs] = useState<ExploreGraph[]>();
  const [cypher, setCypher] = useState(START);
  const [result, setResult] = useState<ExploreResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"graph" | "table">("graph");
  const [selected, setSelected] = useState<Selection>();
  const controls = useRef<GraphControls>(undefined);

  useEffect(() => {
    api.exploreGraphs().then(setGraphs, (e: Error) => setError(e.message));
  }, []);

  const current = graphs?.find((g) => g.name === (clientId ? `lk_client_${clientId}` : undefined)) ?? graphs?.[0];
  const schema = useSchema(current?.name);

  const runQuery = useCallback(
    async (text: string, merge = false) => {
      if (!current || !text.trim()) return;
      setRunning(true);
      setError(undefined);
      try {
        const next = await api.explore(current.name, text);
        if (merge && result) {
          // Expanding a node adds to what's on screen instead of replacing it.
          const nodes = new Map([...result.nodes, ...next.nodes].map((n) => [n.id, n]));
          const links = new Map([...result.links, ...next.links].map((l) => [l.id, l]));
          setResult({ ...next, nodes: [...nodes.values()], links: [...links.values()] });
        } else {
          setResult(next);
          setSelected(undefined);
          setView(next.nodes.length === 0 && next.rows.length > 0 ? "table" : "graph");
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [current, result],
  );

  // A new graph starts with a first look at it.
  useEffect(() => {
    if (!current) return;
    setCypher(START);
    setResult(undefined);
    void api.explore(current.name, START).then(setResult, (e: Error) => setError(e.message));
  }, [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey || !event.shiftKey)) {
      event.preventDefault();
      void runQuery(cypher);
    }
  };

  const shownLabels = useMemo(() => [...new Set(result?.nodes.map((n) => n.label) ?? [])].sort(), [result]);

  return (
    <Page>
      <PageHeader
        title="Network"
        lead="Explore a graph the way FalkorDB stores it. Run a query, click anything to see its properties, double-click a node to bring in its neighbours."
        actions={
          graphs &&
          graphs.length > 1 && (
            <Select
              label="Graph"
              value={current?.name ?? ""}
              onValueChange={(name) => navigate(name.startsWith("lk_client_") ? href("network", name.slice("lk_client_".length)) : href("network"))}
              options={graphs.map((g) => ({ value: g.name, label: g.title, hint: g.name }))}
              className="min-w-60"
            />
          )
        }
      />

      {/* The query bar */}
      <div className="card mb-5 flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
        <Textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          spellCheck={false}
          aria-label="Cypher query"
          className="min-h-11 flex-1 font-mono text-[13px]"
        />
        <div className="flex gap-2">
          {current && (
            <Examples
              kind={current.kind}
              onPick={(text) => {
                setCypher(text);
                void runQuery(text);
              }}
            />
          )}
          <Button onClick={() => runQuery(cypher)} disabled={running || !current}>
            <Play /> {running ? "Running…" : "Run"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="mb-5">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[250px_1fr]">
        <SchemaPanel
          schema={schema}
          onLabel={(label) => {
            const text = `MATCH (n:${label}) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 150`;
            setCypher(text);
            void runQuery(text);
          }}
          onRelationship={(type) => {
            const text = `MATCH p = ()-[:${type}]->() RETURN p LIMIT 150`;
            setCypher(text);
            void runQuery(text);
          }}
        />

        <section className="card relative flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { id: "graph", label: "Graph" },
                { id: "table", label: "Table" },
              ]}
            />
            {result && (
              <span className="text-[12.5px] text-muted">
                {plural(result.nodes.length, "node")}, {plural(result.links.length, "relationship")}, {plural(result.totalRows, "row")} · {result.engineMs.toFixed(2)} ms in FalkorDB
              </span>
            )}
            {view === "graph" && (
              <div className="ml-auto flex gap-1">
                <IconButton label="Zoom in" onClick={() => controls.current?.zoom("in")}>
                  <Plus />
                </IconButton>
                <IconButton label="Zoom out" onClick={() => controls.current?.zoom("out")}>
                  <Minus />
                </IconButton>
                <IconButton label="Fit to screen" onClick={() => controls.current?.zoom("fit")}>
                  <Expand />
                </IconButton>
              </div>
            )}
          </div>

          <div className="relative h-[min(68vh,640px)] min-h-[420px]">
            {!result && !error && <Loading label="Reading the graph" />}
            {result && view === "graph" && (
              <>
                <GraphCanvas
                  nodes={result.nodes}
                  links={result.links}
                  colorOf={colorOf}
                  selected={selected}
                  onSelect={setSelected}
                  controls={controls}
                  onExpand={(node) => runQuery(`MATCH (n)-[r]-(m) WHERE id(n) = ${node.id} RETURN n, r, m LIMIT 100`, true)}
                />
                {result.nodes.length === 0 && (
                  <p className="absolute inset-0 grid place-items-center px-6 text-center text-muted">
                    {result.rows.length ? "This query returns values, not nodes. See the table." : "Nothing matched. Try a ready-made query."}
                  </p>
                )}
                {shownLabels.length > 0 && (
                  <ul className="pointer-events-none absolute top-3 left-3 flex max-w-[70%] flex-wrap gap-1.5">
                    {shownLabels.map((label) => (
                      <li key={label} className="flex items-center gap-1.5 rounded-full border border-line-soft bg-card/90 px-2.5 py-1 text-[12px] font-medium">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(label) }} />
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {result && view === "table" && <ResultTable result={result} />}
            {view === "graph" && selected && <DetailsPanel selected={selected} result={result} onClose={() => setSelected(undefined)} />}
          </div>
        </section>
      </div>
    </Page>
  );
}

function useSchema(graph: string | undefined) {
  const [schema, setSchema] = useState<Awaited<ReturnType<typeof api.exploreSchema>>>();
  useEffect(() => {
    setSchema(undefined);
    if (graph) api.exploreSchema(graph).then(setSchema, () => undefined);
  }, [graph]);
  return schema;
}

function Examples({ kind, onPick }: { kind: ExploreGraph["kind"]; onPick: (cypher: string) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline">
          Examples <ChevronDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-[min(92vw,380px)] rounded-xl border border-line bg-card p-1.5 shadow-float">
          {EXAMPLES[kind].map((example) => (
            <DropdownMenu.Item
              key={example.title}
              onSelect={() => onPick(example.cypher)}
              className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-paper"
            >
              <div className="text-[13.5px] font-medium">{example.title}</div>
              <div className="truncate font-mono text-[11.5px] text-muted">{example.cypher}</div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SchemaPanel({
  schema,
  onLabel,
  onRelationship,
}: {
  schema: ReturnType<typeof useSchema>;
  onLabel: (label: string) => void;
  onRelationship: (type: string) => void;
}) {
  const nodes = schema?.labels.reduce((sum, l) => sum + l.count, 0) ?? 0;
  const relationships = schema?.relationships.reduce((sum, r) => sum + r.count, 0) ?? 0;
  return (
    <Panel title="In this graph" bodyClassName="px-5 pb-5" collapsible defaultOpen="desktop">
      {!schema && <Loading label="Reading the graph" />}
      {schema && (
        <>
          <div className="mb-2 text-[13px] font-semibold">{plural(nodes, "node")}</div>
          <div className="flex flex-wrap gap-1.5">
            {schema.labels.map((l) => (
              <button
                key={l.label}
                onClick={() => onLabel(l.label)}
                title={`Show ${l.label} nodes`}
                className="flex items-center gap-1.5 rounded-full border border-line-soft bg-paper px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(l.label) }} />
                {l.label} <span className="text-muted tabular">{l.count}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 mb-2 text-[13px] font-semibold">{plural(relationships, "relationship")}</div>
          <div className="flex flex-wrap gap-1.5">
            {schema.relationships.map((r) => (
              <button
                key={r.type}
                onClick={() => onRelationship(r.type)}
                title={`Show ${r.type} relationships`}
                className="rounded-md border border-line-soft bg-paper px-2 py-0.5 font-mono text-[11.5px] transition-colors hover:border-primary hover:text-primary"
              >
                {r.type} <span className="text-muted tabular">{r.count}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 mb-1.5 text-[13px] font-semibold">{plural(schema.propertyKeys.length, "property key")}</div>
          <p className="font-mono text-[11.5px] leading-relaxed text-muted">{schema.propertyKeys.join(", ")}</p>
        </>
      )}
    </Panel>
  );
}

/** The clicked node or relationship and its properties, floating over the graph. */
function DetailsPanel({ selected, result, onClose }: { selected: NonNullable<Selection>; result: ExploreResult | undefined; onClose: () => void }) {
  const captionOf = (id: number) => result?.nodes.find((n) => n.id === id)?.caption ?? `#${id}`;
  const isNode = selected.kind === "node";
  const properties = isNode ? selected.node.properties : selected.link.properties;
  return (
    <Panel
      title={isNode ? "Node" : "Relationship"}
      className="absolute top-3 right-3 bottom-3 w-[min(300px,calc(100%-24px))] overflow-y-auto shadow-float"
      bodyClassName="px-5 pb-5"
      action={
        <button onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink">
          <X className="size-4" />
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {isNode ? (
          <Badge tone="neutral">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(selected.node.label) }} />
            {selected.node.label}
          </Badge>
        ) : (
          <Badge tone="neutral" className="font-mono">
            <Waypoints className="size-3.5" /> {selected.link.type}
          </Badge>
        )}
        <span className="text-[12px] text-faint">id {isNode ? selected.node.id : selected.link.id}</span>
      </div>
      <p className="mt-2 font-medium break-words">
        {isNode ? selected.node.caption : `${captionOf(selected.link.source)} → ${captionOf(selected.link.target)}`}
      </p>
      <dl className="mt-3 flex flex-col divide-y divide-line-soft border-t border-line-soft">
        {Object.keys(properties).length === 0 && <p className="py-2 text-[13px] text-muted">No properties.</p>}
        {Object.entries(properties).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[110px_1fr] gap-2 py-1.5">
            <dt className="truncate font-mono text-[12px] text-muted" title={key}>
              {key}
            </dt>
            <dd className="text-[13px] break-words">{formatValue(key, value)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function ResultTable({ result }: { result: ExploreResult }) {
  if (result.columns.length === 0) return <p className="grid h-full place-items-center text-muted">No rows.</p>;
  return (
    <div className="absolute inset-0 overflow-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-line">
            <th className="w-12 px-3 py-2 text-[12px] font-semibold text-muted">#</th>
            {result.columns.map((column) => (
              <th key={column} className="px-3 py-2 font-mono text-[12px] font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-line-soft align-top">
              <td className="px-3 py-1.5 text-faint tabular">{index + 1}</td>
              {result.columns.map((column) => (
                <td key={column} className="max-w-[360px] px-3 py-1.5 break-words">
                  {formatValue(column, row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.totalRows > result.rows.length && <p className="px-3 py-2 text-[12.5px] text-muted">Showing the first {result.rows.length} of {result.totalRows} rows.</p>}
    </div>
  );
}

/** Times (ms since 1970) as dates, lists joined, everything else as text. */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" && /(At|ts|time|due)$/i.test(key) && value > 1e12) return new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" });
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink [&_svg]:size-4">
      {children}
    </button>
  );
}

