import { Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorNote, Loading, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type DbGraph, type QueryRun } from "@/lib/api";
import { formatTime, plural } from "@/lib/format";
import { useLiveQuery } from "@/lib/live";
import type { Tone } from "@/lib/palette";
import { cn } from "@/lib/utils";

type Filter = "all" | "writes" | "vector";

const KEEP = 250;
const MINUTE = 60_000;

/**
 * FalkorDB at work: the graphs the desk keeps (HQ, one per client, the hub, Ask), their indexes,
 * and every named query as it runs, with FalkorDB's own timing and what it wrote.
 */
export function DatabasePage() {
  const overview = useLiveQuery(api.database);
  const runs = useQueryStream();
  const [selected, setSelected] = useState<string>();
  const graphs = overview.data?.graphs ?? [];
  const titles = useMemo(() => new Map(graphs.map((g) => [g.name, g.title])), [graphs]);
  const shown = graphs.find((g) => g.name === selected) ?? graphs[0];

  return (
    <Page>
      <PageHeader title="Database" lead="FalkorDB at work: each graph the desk keeps, its indexes, and every query as it runs." />
      {overview.error && <ErrorNote message={overview.error} />}
      {!overview.data && !overview.error && <Loading label="Reading the graphs" />}

      {overview.data && (
        <>
          <Totals graphs={graphs} runs={runs.list} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {graphs.map((graph) => (
              <GraphCard key={graph.name} graph={graph} active={graph.name === shown?.name} onSelect={() => setSelected(graph.name)} />
            ))}
          </div>
          <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1.4fr_1fr]">
            <QueryFeed {...runs} titles={titles} />
            {shown && <GraphDetail graph={shown} />}
          </div>
        </>
      )}
    </Page>
  );
}

/** The live query log: what has run since the server started, then each new query. */
function useQueryStream() {
  const [list, setList] = useState<QueryRun[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(
    () =>
      api.queries((run) => {
        if (pausedRef.current) return;
        setList((all) => [...all.slice(-(KEEP - 1)), run]);
      }),
    [],
  );
  return { list, paused, setPaused };
}

function Totals({ graphs, runs }: { graphs: DbGraph[]; runs: QueryRun[] }) {
  const recent = runs.filter((r) => r.ts > Date.now() - MINUTE);
  const indexes = graphs.flatMap((g) => g.indexes);
  const average = recent.length ? recent.reduce((sum, r) => sum + r.engineMs, 0) / recent.length : 0;
  const tiles: Array<{ value: string; label: string; tone: Tone }> = [
    { value: String(graphs.length), label: "Graphs", tone: "violet" },
    { value: graphs.reduce((sum, g) => sum + g.nodes, 0).toLocaleString(), label: "Nodes", tone: "blue" },
    { value: graphs.reduce((sum, g) => sum + g.relationships, 0).toLocaleString(), label: "Relationships", tone: "sky" },
    { value: String(indexes.length), label: `Indexes, ${indexes.filter((i) => i.type.includes("vector")).length} of them vector`, tone: "green" },
    { value: String(recent.length), label: "Queries in the last minute", tone: "amber" },
    { value: `${average.toFixed(2)} ms`, label: "Average time inside FalkorDB", tone: "red" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="card px-4 py-3.5">
          <div className={cn("font-display text-[24px] font-semibold tracking-tight", TONE_TEXT[tile.tone])}>{tile.value}</div>
          <div className="text-[12.5px] text-muted">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  red: "text-red",
  amber: "text-amber",
  green: "text-green",
  blue: "text-primary",
  violet: "text-violet",
  sky: "text-sky",
  neutral: "text-ink",
  navy: "text-ink",
};

function GraphCard({ graph, active, onSelect }: { graph: DbGraph; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn("card flex flex-col items-start gap-2 px-4 py-4 text-left transition-colors", active ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-line")}
    >
      <div className="flex w-full items-center gap-2">
        <span className="font-display text-[16px] font-semibold">{graph.title}</span>
        <Badge tone={graph.kind === "hq" ? "navy" : graph.kind === "client" ? "blue" : "neutral"} className="ml-auto">
          {graph.kind === "hq" ? "HQ" : graph.kind === "client" ? "Client" : graph.kind === "hub" ? "Hub" : "Ask"}
        </Badge>
      </div>
      <code className="font-mono text-[12px] text-muted">{graph.name}</code>
      <p className="text-[13px] text-ink-2">{graph.holds}</p>
      <div className="mt-auto text-[13px] font-semibold">
        {plural(graph.nodes, "node")}, {plural(graph.relationships, "relationship")}, {plural(graph.indexes.length, "index", "indexes")}
      </div>
    </button>
  );
}

/** Each query family gets a colour: writes, vector searches, reads, failures. */
function toneOf(run: QueryRun): Tone {
  if (run.error) return "red";
  if (run.vector) return "violet";
  if (Object.keys(run.writes).length) return "green";
  return "blue";
}

function QueryFeed({ list, paused, setPaused, titles }: ReturnType<typeof useQueryStream> & { titles: Map<string, string> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number>();
  const shown = list
    .filter((r) => filter === "all" || (filter === "vector" ? r.vector : Object.keys(r.writes).length > 0))
    .slice(-80)
    .reverse();

  return (
    <Panel
      title="Queries as they run"
      action={
        <Button size="sm" variant="outline" onClick={() => setPaused(!paused)}>
          {paused ? <Play /> : <Pause />} {paused ? "Resume" : "Pause"}
        </Button>
      }
      bodyClassName="px-5 pb-5 sm:px-6"
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "writes", label: "Writes" },
            { id: "vector", label: "Vector searches" },
          ]}
        />
        <span className="text-[12.5px] text-muted">Click a query to see its Cypher.</span>
      </div>
      {shown.length === 0 && <p className="py-8 text-center text-muted">Nothing yet. Press Go live, or open a ticket, and the queries appear here.</p>}
      <ol className="flex max-h-[620px] flex-col gap-1.5 overflow-y-auto">
        {shown.map((run) => (
          <li key={run.seq}>
            <button onClick={() => setOpen(open === run.seq ? undefined : run.seq)} className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-paper">
              <Badge tone={toneOf(run)} className="w-14 justify-center font-mono">
                {run.id}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink">
                  {run.vector && <Sparkles className="mr-1 inline size-3.5 text-violet" />}
                  {run.title}
                </div>
                <div className="text-[12px] text-muted">
                  {titles.get(run.graph) ?? run.graph} · {plural(run.rows, "row")}
                  {Object.entries(run.writes).map(([what, count]) => ` · ${what.toLowerCase()} ${count}`)}
                  {run.error && <span className="text-red"> · {run.error}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[12.5px] text-ink">{run.engineMs.toFixed(2)} ms</div>
                <div className="text-[11.5px] text-faint">{formatTime(run.ts)}</div>
              </div>
            </button>
            {open === run.seq && <Cypher id={run.id} />}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Cypher({ id }: { id: string }) {
  const [text, setText] = useState<string>();
  useEffect(() => {
    api.queryText(id).then((q) => setText(q.cypher.trim()), () => setText("Not found"));
  }, [id]);
  return <pre className="mx-2.5 mb-2 overflow-x-auto rounded-xl bg-paper-2 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-2">{text ?? "…"}</pre>;
}

function GraphDetail({ graph }: { graph: DbGraph }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel title={`Indexes in ${graph.title}`} bodyClassName="px-5 pb-5 sm:px-6">
        <p className="mb-3 text-[13px] text-muted">Range indexes find nodes by id or status without scanning; vector indexes find the closest meaning (messages, tickets, code).</p>
        <ul className="flex flex-col gap-1.5">
          {graph.indexes
            .slice()
            .sort((a, b) => Number(b.type.includes("vector")) - Number(a.type.includes("vector")) || a.label.localeCompare(b.label))
            .map((index) => (
              <li key={`${index.label}.${index.property}.${index.type}`} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <code className="font-mono text-[12.5px]">
                  :{index.label}({index.property})
                </code>
                <Badge tone={index.type.includes("vector") ? "violet" : "neutral"}>{index.type}</Badge>
                {index.type.includes("vector") && (
                  <span className="text-[12px] text-muted">
                    {String(index.options.dimension ?? "")} dimensions, {String(index.options.similarityFunction ?? "")}
                  </span>
                )}
                {index.status !== "operational" && <Badge tone="amber">{index.status}</Badge>}
              </li>
            ))}
        </ul>
      </Panel>
      <Panel title="What it holds" bodyClassName="px-5 pb-5 sm:px-6">
        <div className="flex flex-wrap gap-1.5">
          {graph.labels.map((l) => (
            <Badge key={l.label} tone="blue">
              {l.label} {l.count}
            </Badge>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {graph.relationshipTypes.map((r) => (
            <Badge key={r.type} tone="neutral" className="font-mono">
              {r.type} {r.count}
            </Badge>
          ))}
        </div>
      </Panel>
    </div>
  );
}
