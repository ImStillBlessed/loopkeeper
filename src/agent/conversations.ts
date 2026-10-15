import type { Graph } from "falkordb";
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
import { ask, type Answer } from "./agent.js";

/** One question and its answer, inside a conversation. */
export interface Turn {
  id: string;
  question: string;
  askedAt: number;
  answer: Answer;
}

export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
}

/** How many earlier turns the agent sees. Enough for follow-ups, small enough for free-tier limits. */
const CONTEXT_TURNS = 4;
/** Earlier answers are trimmed when passed back as context; the full answer stays stored. */
const CONTEXT_ANSWER_CHARS = 1200;

/**
 * Asks a question inside a conversation (a new one if none is given). The agent sees the last few
 * turns, so follow-ups work. The whole conversation is one node in the graph, linked to every
 * message, issue and person its answers used.
 */
export async function askInConversation(
  graph: Graph,
  llm: Llm,
  input: { question: string; conversationId?: string; now?: number },
): Promise<{ conversationId: string; title: string; turn: Turn }> {
  const conversation = input.conversationId ? await getConversation(graph, input.conversationId) : undefined;
  const conversationId = conversation?.id ?? (await startConversation(graph, input.question));
  const turns = conversation?.turns ?? [];

  const earlier = turns.slice(-CONTEXT_TURNS).map((t) => ({ question: t.question, answer: t.answer.answer.slice(0, CONTEXT_ANSWER_CHARS) }));
  const answer = await ask(graph, llm, input.question, input.now, earlier);

  const askedAt = Date.now();
  const turn: Turn = { id: stableId("turn", [conversationId, input.question, String(askedAt)]), question: input.question, askedAt, answer };
  const all = [...turns, turn];
  await run(graph, CV2_SAVE_TURNS, { id: conversationId, turnsJson: JSON.stringify(all), turnCount: all.length, ts: askedAt });
  if (answer.graphPath.nodeIds.length) await run(graph, CV3_LINK_CONVERSATION, { id: conversationId, nodeIds: answer.graphPath.nodeIds });

  return { conversationId, title: conversation?.title ?? titleFor(input.question), turn };
}

export async function listConversations(graph: Graph): Promise<ConversationSummary[]> {
  return run<ConversationSummary>(graph, CV4_CONVERSATIONS, { limit: 30 });
}

export async function getConversation(graph: Graph, id: string): Promise<{ id: string; title: string; turns: Turn[] } | undefined> {
  const [row] = await run<{ id: string; title: string; turnsJson: string }>(graph, CV5_CONVERSATION, { id });
  return row ? { id: row.id, title: row.title, turns: JSON.parse(row.turnsJson) as Turn[] } : undefined;
}

export async function deleteConversation(graph: Graph, id: string): Promise<void> {
  await run(graph, CV6_DELETE_CONVERSATION, { id });
}

/** Questions saved one by one before conversations existed become a single conversation. */
export async function migrateLegacyQuestions(graph: Graph): Promise<void> {
  const legacy = await run<{ id: string; question: string; answerJson: string; askedAt: number }>(graph, CV7_LEGACY_QUESTIONS);
  if (legacy.length === 0) return;
  const id = await startConversation(graph, legacy[0].question, legacy[0].askedAt);
  const turns: Turn[] = legacy.map((q) => ({ id: q.id, question: q.question, askedAt: q.askedAt, answer: JSON.parse(q.answerJson) }));
  await run(graph, CV2_SAVE_TURNS, { id, turnsJson: JSON.stringify(turns), turnCount: turns.length, ts: legacy.at(-1)!.askedAt });
  await run(graph, CV8_DELETE_LEGACY_QUESTIONS);
}

async function startConversation(graph: Graph, firstQuestion: string, ts = Date.now()): Promise<string> {
  const id = stableId("conv", [firstQuestion, String(ts)]);
  await run(graph, CV1_CREATE_CONVERSATION, { id, title: titleFor(firstQuestion), ts });
  return id;
}

/** The first question, shortened, names the conversation. */
function titleFor(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean;
}
