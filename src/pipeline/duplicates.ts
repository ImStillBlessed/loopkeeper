import type { Graph } from "falkordb";
import { config } from "../config.js";
import { C10_DUPLICATE_CLUSTER, C9_SIMILAR_TO_ISSUE, OPEN_STATUSES, run, W8_LINK_SIMILAR, W9_MERGE_DUPLICATE } from "../graph/queries.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";

export interface Merge {
  duplicateId: string;
  duplicateTitle: string;
  canonicalId: string;
  canonicalTitle: string;
}

/**
 * Duplicate detection in three graph-native steps:
 *   1. vector index → link the new issue to close open issues with SIMILAR_TO
 *   2. WCC (connected components) over SIMILAR_TO → the candidate cluster
 *   3. a model confirms which issues in the cluster are truly the same → DUPLICATE_OF the oldest
 */
export async function mergeDuplicates(graph: Graph, llm: Llm, issueId: string, ts: number): Promise<Merge[]> {
  const neighbours = await run<{ id: string; distance: number }>(graph, C9_SIMILAR_TO_ISSUE, {
    issueId,
    openStatuses: OPEN_STATUSES,
  });
  const close = neighbours.filter((n) => n.distance <= config.duplicateMaxDistance);
  if (close.length === 0) return [];

  for (const neighbour of close) {
    await run(graph, W8_LINK_SIMILAR, { a: issueId, b: neighbour.id, score: 1 - neighbour.distance });
  }

  const cluster = await run<{ id: string; title: string; summary: string; createdAt: number }>(graph, C10_DUPLICATE_CLUSTER, {
    issueId,
    openStatuses: OPEN_STATUSES,
  });
  if (cluster.length < 2) return [];

  const verdict = await llm.json<{ groups?: string[][] }>("smart", prompt("merge-judge"), {
    issues: cluster.map(({ id, title, summary }) => ({ id, title, summary })),
  });

  const merges: Merge[] = [];
  const byId = new Map(cluster.map((issue) => [issue.id, issue]));
  for (const group of verdict.groups ?? []) {
    // The cluster is ordered oldest first, so the first known id in the group is the canonical issue.
    const members = cluster.filter((issue) => group.includes(issue.id));
    if (members.length < 2) continue;
    const [canonical, ...duplicates] = members;
    for (const duplicate of duplicates) {
      await run(graph, W9_MERGE_DUPLICATE, { duplicateId: duplicate.id, canonicalId: canonical.id, ts });
      merges.push({
        duplicateId: duplicate.id,
        duplicateTitle: byId.get(duplicate.id)!.title,
        canonicalId: canonical.id,
        canonicalTitle: canonical.title,
      });
    }
  }
  return merges;
}
