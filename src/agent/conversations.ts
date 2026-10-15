import type { Graph } from "falkordb";
import { getFalkorDB } from "../graph/client.js";
import {
  CV1_CREATE_CONVERSATION,
  CV2_SAVE_TURNS,
  CV3_LINK_CONVERSATION,
  CV4_CONVERSATIONS,
  CV5_CONVERSATION,
  CV6_DELETE_CONVERSATION,
  CV7_LEGACY_QUESTIONS,
  CV8_DELETE_LEGACY_QUESTIONS,
  run,
} from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";
import type { Llm } from "../llm/llm.js";
import { ask, type Answer, type AskScope } from "./agent.js";

/**
 * Ask conversations are shared desk records: every staff member who can see the clients a conversation
 * is about can read it and carry it on. Each turn remembers who asked. A turn is either a question
 * (with the agent's answer) or a note: information a person added to the graph from Ask.
 *
 * Conversations about one client live in that client's graph; conversations across clients live in
 * the staff-only desk graph (lk_desk), never in HQ.
 */

export interface Turn {
  id: string;
  question: string;
  askedAt: number;
  /** Who asked (or noted) it. Older turns may not have it. */
  askedBy?: string;
  kind?: "question" | "note";
  answer: Answer;
}

export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
  createdBy: string;
  lastBy: string;
  /** The clients the conversation drew on: only people who can see all of them may open it. */
  clientIds: string[];
}

export interface Conversation {
  id: string;
  title: string;
  turns: Turn[];
  clientIds: string[];
  createdBy: string;
}

export const DESK_GRAPH = "lk_desk";

/** The staff-only graph for conversations across clients. */
export async function deskGraph(): Promise<Graph> {
  const graph = (await getFalkorDB()).selectGraph(DESK_GRAPH);
  await graph.query("CREATE INDEX FOR (c:Conversation) ON (c.id)").catch(() => undefined);
  return graph;
}

/** How many earlier turns the agent sees. Enough for follow-ups, small enough to stay cheap. */
const CONTEXT_TURNS = 4;
/** Earlier answers are trimmed when passed back as context; the full answer stays stored. */
const CONTEXT_ANSWER_CHARS = 1200;

/**
 * Adds a turn to a conversation (a new one if none is given). `answerWith` gets the last few turns, so
 * follow-ups work, and returns the answer for this turn.
 */
export async function continueConversation(
  graph: Graph,
  input: { question: string; conversationId?: string; by: string; clientIds: string[]; kind?: Turn["kind"] },
  answerWith: (earlier: Array<{ question: string; answer: string }>) => Promise<Answer>,
): Promise<{ conversationId: string; title: string; turn: Turn }> {
  const conversation = input.conversationId ? await getConversation(graph, input.conversationId) : undefined;
  const conversationId = conversation?.id ?? (await startConversation(graph, input.question, input.by, input.clientIds));
  const turns = conversation?.turns ?? [];

  const earlier = turns
    .filter((t) => t.kind !== "note")
    .slice(-CONTEXT_TURNS)
    .map((t) => ({ question: t.question, answer: t.answer.answer.slice(0, CONTEXT_ANSWER_CHARS) }));
  const answer = await answerWith(earlier);

  const askedAt = Date.now();
  const turn: Turn = {
    id: stableId("turn", [conversationId, input.question, String(askedAt)]),
    question: input.question,
    askedAt,
    askedBy: input.by,
    kind: input.kind ?? "question",
    answer,
  };
  const all = [...turns, turn];
  await run(graph, CV2_SAVE_TURNS, { id: conversationId, turnsJson: JSON.stringify(all), turnCount: all.length, ts: askedAt, by: input.by, clientIds: input.clientIds });
  if (answer.graphPath.nodeIds.length) await run(graph, CV3_LINK_CONVERSATION, { id: conversationId, nodeIds: answer.graphPath.nodeIds });

  return { conversationId, title: conversation?.title ?? titleFor(input.question), turn };
}

/** Asks about one client, in its own graph. */
export async function askInConversation(
  graph: Graph,
  llm: Llm,
  input: { question: string; conversationId?: string; scope?: AskScope; by?: string },
): Promise<{ conversationId: string; title: string; turn: Turn }> {
  return continueConversation(
    graph,
    { question: input.question, conversationId: input.conversationId, by: input.by ?? "", clientIds: input.scope?.clientId ? [input.scope.clientId] : [] },
    (earlier) => ask(graph, llm, input.question, { ...input.scope, earlier }),
  );
}

/** A plain answer with nothing to cite (for notes and answers across clients). */
export function plainAnswer(text: string): Answer {
  return { answer: text, sources: [], graphPath: { nodeIds: [] }, queriesRun: [], toolCalls: [] };
}

export async function listConversations(graph: Graph, limit = 50): Promise<ConversationSummary[]> {
  return run<ConversationSummary>(graph, CV4_CONVERSATIONS, { limit });
}

export async function getConversation(graph: Graph, id: string): Promise<Conversation | undefined> {
  const [row] = await run<{ id: string; title: string; turnsJson: string; clientIds: string[]; createdBy: string }>(graph, CV5_CONVERSATION, { id });
  return row ? { id: row.id, title: row.title, turns: JSON.parse(row.turnsJson) as Turn[], clientIds: row.clientIds, createdBy: row.createdBy } : undefined;
}

export async function deleteConversation(graph: Graph, id: string): Promise<void> {
  await run(graph, CV6_DELETE_CONVERSATION, { id });
}

/** Questions saved one by one before conversations existed become a single conversation. */
export async function migrateLegacyQuestions(graph: Graph): Promise<void> {
  const legacy = await run<{ id: string; question: string; answerJson: string; askedAt: number }>(graph, CV7_LEGACY_QUESTIONS);
  if (legacy.length === 0) return;
  const id = await startConversation(graph, legacy[0].question, "", [], legacy[0].askedAt);
  const turns: Turn[] = legacy.map((q) => ({ id: q.id, question: q.question, askedAt: q.askedAt, answer: JSON.parse(q.answerJson) }));
  await run(graph, CV2_SAVE_TURNS, { id, turnsJson: JSON.stringify(turns), turnCount: turns.length, ts: legacy.at(-1)!.askedAt, by: "", clientIds: [] });
  await run(graph, CV8_DELETE_LEGACY_QUESTIONS);
}

async function startConversation(graph: Graph, firstQuestion: string, by: string, clientIds: string[], ts = Date.now()): Promise<string> {
  const id = stableId("conv", [firstQuestion, String(ts)]);
  await run(graph, CV1_CREATE_CONVERSATION, { id, title: titleFor(firstQuestion), ts, by, clientIds });
  return id;
}

/** The first question, shortened, names the conversation. */
function titleFor(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean;
}
