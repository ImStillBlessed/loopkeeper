import type { ChatMessage } from "../ingest/types.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";
import { MESSAGE_TYPES, type MessageType } from "./message-types.js";
import { formatLagos } from "./time.js";
import type { Person, Sentiment, TriageResult } from "./types.js";

const SENTIMENTS: Sentiment[] = ["calm", "concerned", "frustrated"];

export const TRIAGE_BATCH_SIZE = 20;
const CONTEXT_SIZE = 5;

/**
 * Classifies a batch of messages as noise or work (and which kind of work) in one cheap model call.
 * The few messages before the batch are included so replies like "same here" make sense.
 */
export async function triageBatch(
  llm: Llm,
  batch: ChatMessage[],
  previous: ChatMessage[],
  people: Map<string, Person>,
): Promise<TriageResult[]> {
  const describe = (m: ChatMessage) => ({
    id: m.id,
    time: formatLagos(Date.parse(m.ts)),
    sender: describeSender(people.get(m.senderId), m.senderName),
    text: m.hasMedia ? `${m.text} [photo/media attached]`.trim() : m.text,
  });

  const reply = await llm.json<{ results?: Array<Partial<TriageResult> & { type?: string | null; sentiment?: string | null }> }>(
    "fast",
    prompt("triage"),
    {
      earlier_messages_for_context: previous.slice(-CONTEXT_SIZE).map(describe),
      messages_to_triage: batch.map(describe),
    },
  );

  const byId = new Map((reply.results ?? []).map((r) => [r.id, r]));
  return batch.map((message) => {
    const result = byId.get(message.id);
    const type = MESSAGE_TYPES.includes(result?.type as MessageType) ? (result?.type as MessageType) : undefined;
    // A message the model forgot, or marked relevant without a valid type, is treated as noise.
    const relevant = Boolean(result?.relevant && type);
    const sentiment = SENTIMENTS.includes(result?.sentiment as Sentiment) ? (result?.sentiment as Sentiment) : "calm";
    return { id: message.id, relevant, type: relevant ? type : undefined, sentiment: relevant ? sentiment : undefined, confidence: result?.confidence ?? 0 };
  });
}

export function describeSender(person: Person | undefined, fallbackName: string): string {
  if (!person) return fallbackName;
  if (person.school) return `${person.name} (${person.role}, ${person.school})`;
  if (person.role === "developer" || person.role === "support") return `${person.name} (Ednovax ${person.role})`;
  return person.name;
}
