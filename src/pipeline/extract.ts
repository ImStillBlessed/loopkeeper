import type { Graph } from "falkordb";
import { FEATURES } from "../../data/synthetic/product.js";
import {
  C2_OPEN_ISSUES_FOR_SCHOOL,
  C3_OPEN_ISSUES_NEAR,
  C4_RECENT_ISSUES,
  C5_ISSUE_CARDS,
  C6_OPEN_FOLLOWUPS,
  OPEN_STATUSES,
  run,
} from "../graph/queries.js";
import type { ChatMessage } from "../ingest/types.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";
import { describeSender } from "./triage.js";
import { formatLagos } from "./time.js";
import type { Extraction, Person } from "./types.js";

export interface ExtractionInput {
  message: ChatMessage;
  embedding: number[];
  recent: ChatMessage[];
  people: Map<string, Person>;
}

export interface IssueCard {
  id: string;
  title: string;
  kind: string;
  status: string;
  feature: string | null;
  people: string[];
  schools: string[];
}

/**
 * This is where the graph shapes the model's behaviour: before extracting anything, we pull the
 * issues it might be about out of FalkorDB (same school, closest in meaning, most recently active)
 * and hand them to the model, so it can say "this is iss_12 again" instead of creating a duplicate.
 */
export async function candidateIssues(graph: Graph, sender: Person | undefined, embedding: number[]): Promise<IssueCard[]> {
  const params = { openStatuses: OPEN_STATUSES };
  const [fromSchool, nearby, recent] = await Promise.all([
    sender?.schoolId
      ? run<{ id: string }>(graph, C2_OPEN_ISSUES_FOR_SCHOOL, { ...params, schoolId: sender.schoolId })
      : Promise.resolve([]),
    run<{ id: string }>(graph, C3_OPEN_ISSUES_NEAR, { ...params, embedding, limit: 5 }),
    run<{ id: string }>(graph, C4_RECENT_ISSUES, { ...params, limit: 5 }),
  ]);

  const ids = [...new Set([...fromSchool, ...nearby, ...recent].map((row) => row.id))];
  if (ids.length === 0) return [];
  return run<IssueCard>(graph, C5_ISSUE_CARDS, { ids });
}

export async function extract(graph: Graph, llm: Llm, input: ExtractionInput): Promise<{ extraction: Extraction; candidates: IssueCard[] }> {
  const { message, embedding, recent, people } = input;
  const sender = people.get(message.senderId);
  const [candidates, followUps] = await Promise.all([
    candidateIssues(graph, sender, embedding),
    run<{ id: string; text: string; dueAt: number; owner: string }>(graph, C6_OPEN_FOLLOWUPS),
  ]);

  const line = (m: ChatMessage) =>
    `[${formatLagos(Date.parse(m.ts))}] ${describeSender(people.get(m.senderId), m.senderName)}: ${m.text}${m.hasMedia ? " [photo]" : ""}`;

  const raw = await llm.json<Partial<Extraction>>("smart", prompt("extract"), {
    message: {
      id: message.id,
      time: formatLagos(Date.parse(message.ts)),
      sender: { name: sender?.name ?? message.senderName, role: sender?.role ?? "unknown", school: sender?.school ?? null },
      text: message.text,
      has_photo: message.hasMedia,
    },
    recent_conversation: recent.map(line),
    open_issues: candidates,
    open_followups: followUps.map((f) => ({ id: f.id, text: f.text, owner: f.owner, due: formatLagos(f.dueAt) })),
    features: FEATURES,
    people: [...people.values()].map((p) => describeSender(p, p.name)),
  });

  return { extraction: normalise(raw), candidates };
}

/** Models occasionally drop a key; downstream code can rely on every list existing. */
function normalise(raw: Partial<Extraction>): Extraction {
  return {
    new_issues: raw.new_issues ?? [],
    issue_updates: raw.issue_updates ?? [],
    new_followups: raw.new_followups ?? [],
    completed_followups: raw.completed_followups ?? [],
    decisions: raw.decisions ?? [],
  };
}
