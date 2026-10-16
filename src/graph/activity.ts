/**
 * Every named query as FalkorDB runs it, so the dashboard can show the database at work: which
 * query, on which graph, how long FalkorDB took, what it wrote, and whether it used a vector index.
 * Kept in memory only (the latest few hundred).
 */

export interface QueryRun {
  seq: number;
  /** The query's stable id, e.g. "Q12" (see queries.ts and hq-queries.ts). */
  id: string;
  title: string;
  graph: string;
  ts: number;
  /** FalkorDB's own execution time, from the reply's statistics. */
  engineMs: number;
  /** Round trip as the app saw it. */
  totalMs: number;
  rows: number;
  /** What it changed, e.g. { "Nodes created": 3 }. */
  writes: Record<string, number>;
  cached: boolean;
  /** It searched a vector index (semantic search). */
  vector: boolean;
  error?: string;
}

type Listener = (run: QueryRun) => void;

const LOG_SIZE = 400;
/** Statistic lines in a FalkorDB reply that describe changes to the graph. */
const WRITE_STAT = /^(Nodes created|Nodes deleted|Relationships created|Relationships deleted|Properties set|Labels added|Indices created): (\d+)/;

class QueryLog {
  private runs: QueryRun[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;

  recent(): QueryRun[] {
    return this.runs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(run: Omit<QueryRun, "seq">): void {
    const entry = { ...run, seq: ++this.seq };
    this.runs.push(entry);
    if (this.runs.length > LOG_SIZE) this.runs.splice(0, this.runs.length - LOG_SIZE);
    for (const listener of this.listeners) listener(entry);
  }
}

export const queryLog = new QueryLog();

/** Reads FalkorDB's statistics lines ("Query internal execution time: 0.03 milliseconds", "Nodes created: 2", …). */
export function readStatistics(metadata: string[] | undefined): { engineMs: number; cached: boolean; writes: Record<string, number> } {
  let engineMs = 0;
  let cached = false;
  const writes: Record<string, number> = {};
  for (const line of metadata ?? []) {
    const time = /execution time: ([\d.]+) milliseconds/.exec(line);
    if (time) engineMs = Number(time[1]);
    if (/^Cached execution: 1/.test(line)) cached = true;
    const write = WRITE_STAT.exec(line);
    if (write && Number(write[2]) > 0) writes[write[1]] = Number(write[2]);
  }
  return { engineMs, cached, writes };
}
