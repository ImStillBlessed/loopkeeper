import type { Graph } from "falkordb";
import { config } from "../config.js";
import { X1_SIGNAL_UPSERT, X2_SIGNAL_STATUS, X3_SIMILAR_SIGNALS, X4_LINK_SIGNALS, X5_SIGNAL_CLUSTER, X6_PATTERN_UPSERT } from "../graph/hq-queries.js";
import { run } from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";

/**
 * Cross-client learning without information bleed.
 *
 * Every ticket in a client's graph leaves a Signal in HQ: what kind of problem, on which feature,
 * how severe, its status, and an embedding of its meaning. No messages, no people, and the title is
 * scrubbed of the client's and contacts' names. Signals from different clients on the same feature
 * that read alike are linked, clustered with WCC, and become a Pattern.
 */

export interface TicketSignal {
  clientId: string;
  issueId: string;
  title: string;
  featureKey: string;
  severity: string;
  status: string;
  embedding: number[];
  /** Names that must never reach HQ text: the client's own name and its contacts'. */
  privateNames: string[];
}

export interface PatternUpdate {
  id: string;
  title: string;
  clientIds: string[];
}

const NAME_TITLES = /^(mr|mrs|miss|ms|mallam|dr|prof)\.?$/i;

/** Removes the client's name and contact names from a title before it leaves the client's graph. */
export function scrubNames(text: string, names: string[]): string {
  let scrubbed = text;
  const words = new Set<string>();
  for (const name of names) {
    scrubbed = scrubbed.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "");
    for (const word of name.split(/\s+/)) if (word.length >= 3 && !NAME_TITLES.test(word)) words.add(word);
  }
  for (const word of words) scrubbed = scrubbed.replace(new RegExp(`\\b${escapeRegExp(word)}('s)?\\b`, "gi"), "");
  return scrubbed.replace(/\s{2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/^[\s,.;:-]+|[\s,;:-]+$/g, "").trim() || "Untitled problem";
}

/** Records (or refreshes) a ticket's signal and checks whether it now belongs to a cross-client pattern. */
export async function recordSignal(hq: Graph, signal: TicketSignal, ts = Date.now()): Promise<PatternUpdate | undefined> {
  await run(hq, X1_SIGNAL_UPSERT, {
    id: signal.issueId,
    clientId: signal.clientId,
    featureKey: signal.featureKey,
    severity: signal.severity,
    status: signal.status,
    title: scrubNames(signal.title, signal.privateNames),
    embedding: signal.embedding,
    ts,
  });
  return detectPattern(hq, signal.issueId, ts);
}

export async function updateSignalStatus(hq: Graph, issueId: string, status: string, ts = Date.now()): Promise<void> {
  await run(hq, X2_SIGNAL_STATUS, { id: issueId, status, ts });
}

async function detectPattern(hq: Graph, issueId: string, ts: number): Promise<PatternUpdate | undefined> {
  const similar = await run<{ id: string; distance: number }>(hq, X3_SIMILAR_SIGNALS, { id: issueId });
  const close = similar.filter((s) => s.distance <= config.patternMaxDistance);
  if (close.length === 0) return undefined;
  for (const other of close) await run(hq, X4_LINK_SIGNALS, { a: issueId, b: other.id, score: 1 - other.distance });

  const cluster = await run<{ id: string; clientId: string; title: string; featureKey: string }>(hq, X5_SIGNAL_CLUSTER, { id: issueId });
  const clientIds = [...new Set(cluster.map((s) => s.clientId))];
  if (clientIds.length < 2) return undefined;

  // The oldest signal names the pattern and fixes its id, so the pattern stays the same as it grows.
  const [oldest] = cluster;
  const id = stableId("pat", [oldest.id]);
  await run(hq, X6_PATTERN_UPSERT, { id, title: oldest.title, featureKey: oldest.featureKey, signalIds: cluster.map((s) => s.id), ts });
  return { id, title: oldest.title, clientIds };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
