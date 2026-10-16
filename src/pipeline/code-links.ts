import type { Graph } from "falkordb";
import { C14_CODE_NEAR, C15_FEATURE_CODE, run, W20_LIKELY_CODE } from "../graph/queries.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";

/**
 * Where a new ticket most likely lives in the code. FalkorDB finds the candidates (the code vector
 * index, closest in meaning to the problem, plus the files of its product area); the model then
 * reads the actual source of the closest ones and names the files and functions involved, with a
 * reason. Only files the repo index read can be candidates, so nothing is guessed from names alone.
 */

const NEAREST = 6;
const MAX_CANDIDATES = 8;
/** How many candidates' source is read from GitHub for the model. */
const READ_SOURCE = 4;
const SOURCE_CHARS = 7000;
const MIN_CONFIDENCE = 0.4;

interface Candidate {
  id: string;
  path: string;
  repo: string;
  symbols: string[];
  outline: string;
}

export interface LikelyCode {
  path: string;
  repo: string;
  functions: string[];
  why: string;
  confidence: number;
  /** The model read the file's source, not just its outline. */
  readSource: boolean;
}

/** Reads a file's source from its repository, or undefined if that isn't possible. */
export type SourceReader = (repo: string, path: string) => Promise<string | undefined>;

export async function linkLikelyCode(
  graph: Graph,
  llm: Llm,
  issue: { id: string; title: string; summary: string; featureKey: string | null },
  embedding: number[],
  readSource: SourceReader,
  ts: number,
): Promise<LikelyCode[]> {
  const near = await run<Candidate>(graph, C14_CODE_NEAR, { embedding, k: NEAREST });
  const ofFeature = issue.featureKey ? await run<Candidate>(graph, C15_FEATURE_CODE, { featureKey: issue.featureKey }) : [];
  const candidates = [...new Map([...near, ...ofFeature].map((c) => [c.id, c])).values()].slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];

  const sources = await Promise.all(
    candidates.map((c, index) => (index < READ_SOURCE ? readSource(c.repo, c.path).catch(() => undefined) : Promise.resolve(undefined))),
  );
  const { files } = await llm
    .json<{ files?: Array<{ path: string; functions?: string[]; why?: string; confidence?: number }> }>("fast", prompt("code-links"), {
      problem: { title: issue.title, summary: issue.summary },
      candidates: candidates.map((c, index) => ({
        path: c.path,
        defines: c.symbols.slice(0, 25),
        outline: c.outline,
        source: sources[index]?.slice(0, SOURCE_CHARS) ?? null,
      })),
    })
    .catch(() => ({ files: [] }));

  const likely: LikelyCode[] = [];
  for (const pick of files ?? []) {
    const index = candidates.findIndex((c) => c.path === pick.path);
    if (index === -1 || (pick.confidence ?? 0) < MIN_CONFIDENCE || likely.some((l) => l.path === pick.path)) continue;
    const candidate = candidates[index];
    // Only functions the file really defines (or that appear in its source) are kept.
    const functions = (pick.functions ?? []).filter((name) => candidate.symbols.includes(name) || sources[index]?.includes(name)).slice(0, 5);
    likely.push({ path: candidate.path, repo: candidate.repo, functions, why: pick.why?.trim() ?? "", confidence: pick.confidence ?? 0, readSource: Boolean(sources[index]) });
    if (likely.length === 3) break;
  }

  if (likely.length) {
    await run(graph, W20_LIKELY_CODE, {
      issueId: issue.id,
      ts,
      links: likely.map((l) => ({ fileId: candidates.find((c) => c.path === l.path)!.id, functions: l.functions, why: l.why, confidence: l.confidence, readSource: l.readSource })),
    });
  }
  return likely;
}
