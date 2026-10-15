import type { Graph } from "falkordb";
import { GH10_ISSUE_STATUS, run, W7_CHANGE_STATUS_BY_HUMAN } from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";

export const STATUS_WORDS: Record<string, string> = {
  open: "open",
  in_progress: "being worked on",
  possibly_resolved: "might be fixed, waiting for the school to confirm",
  resolved: "resolved",
};

export interface StatusChangeResult {
  id: string;
  title: string;
  from: string;
  changed: boolean;
}

/**
 * Changes an issue's status for a reason that isn't a chat message: a person on the dashboard,
 * a merged pull request, a GitHub issue closed by a developer. The StatusChange records who or what did it.
 * Returns the (canonical) issue, its previous status and whether anything changed; undefined if there is no such issue.
 */
export async function changeStatusFromOutside(graph: Graph, issueId: string, to: string, by: string, ts = Date.now()): Promise<StatusChangeResult | undefined> {
  const [issue] = await run<{ id: string; status: string; title: string }>(graph, GH10_ISSUE_STATUS, { issueId });
  if (!issue) return undefined;
  if (issue.status === to) return { id: issue.id, title: issue.title, from: issue.status, changed: false };
  await run(graph, W7_CHANGE_STATUS_BY_HUMAN, { id: stableId("sc", [issue.id, to, by, String(ts)]), issueId: issue.id, to, ts, by });
  return { id: issue.id, title: issue.title, from: issue.status, changed: true };
}
