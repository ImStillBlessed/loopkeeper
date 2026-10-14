import type { Graph } from "falkordb";
import { C12_PEOPLE, Q0_STATS, run, W1_COUNT_MESSAGE, W2_MESSAGE } from "../graph/queries.js";
import type { ChatMessage } from "../ingest/types.js";
import type { Llm } from "../llm/llm.js";
import { applyExtraction } from "./apply.js";
import { extract } from "./extract.js";
import { sendDueReminders } from "./reminders.js";
import { TRIAGE_BATCH_SIZE, triageBatch } from "./triage.js";
import type { Person, PipelineEvent, TriageResult } from "./types.js";

export interface RunOptions {
  graph: Graph;
  llm: Llm;
  emit: (event: PipelineEvent) => void;
  /** Pause between messages so a replay looks live. 0 = as fast as possible. */
  delayMs?: number;
  signal?: AbortSignal;
}

const RECENT_CONTEXT = 8;

/**
 * The whole ingest pipeline for a stream of chat messages:
 *   triage (batch) → for each message: count it; if it's work, store it, extract, write to the graph
 *   → send any reminders that are now due on the chat's clock.
 */
export async function ingestMessages(messages: ChatMessage[], options: RunOptions): Promise<void> {
  const { graph, llm, emit, signal } = options;
  const people = await loadPeople(graph);
  const seenSoFar: ChatMessage[] = [];

  for (let start = 0; start < messages.length; start += TRIAGE_BATCH_SIZE) {
    if (signal?.aborted) return;
    const batch = messages.slice(start, start + TRIAGE_BATCH_SIZE);
    const verdicts = await triageBatch(llm, batch, seenSoFar, people);

    for (const [index, message] of batch.entries()) {
      if (signal?.aborted) return;
      if (options.delayMs) await sleep(options.delayMs);

      await processMessage(message, verdicts[index], seenSoFar.slice(-RECENT_CONTEXT), people, options);
      seenSoFar.push(message);
    }
  }
}

async function processMessage(
  message: ChatMessage,
  verdict: TriageResult,
  recent: ChatMessage[],
  people: Map<string, Person>,
  { graph, llm, emit }: RunOptions,
): Promise<void> {
  const ts = Date.parse(message.ts);
  emit({
    kind: "message",
    message: {
      id: message.id,
      ts: message.ts,
      senderName: people.get(message.senderId)?.name ?? message.senderName,
      text: message.text,
      hasMedia: message.hasMedia,
      relevant: verdict.relevant,
      type: verdict.type,
    },
  });

  await run(graph, W1_COUNT_MESSAGE, { ignored: verdict.relevant ? 0 : 1, ts });

  if (verdict.relevant) {
    const text = message.text || "[photo]";
    const [embedding] = await llm.embed([text]);
    await run(graph, W2_MESSAGE, {
      id: message.id,
      groupId: message.groupId,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      ts,
      type: verdict.type,
      hasMedia: message.hasMedia,
      embedding,
    });

    const { extraction } = await extract(graph, llm, { message, embedding, recent, people });
    // Activity lines use the roster name, not the masked number WhatsApp showed.
    const named = { ...message, senderName: people.get(message.senderId)?.name ?? message.senderName };
    await applyExtraction({ graph, llm, message: named, emit }, extraction);
  }

  for (const reminder of await sendDueReminders(graph, ts)) {
    emit({ kind: "bot", text: reminder.text, ts: message.ts });
  }

  const [stats] = await run<{ seen: number; ignored: number; used: number }>(graph, Q0_STATS);
  if (stats) emit({ kind: "stats", seen: stats.seen, ignored: stats.ignored, used: stats.used });
}

async function loadPeople(graph: Graph): Promise<Map<string, Person>> {
  const rows = await run<Person>(graph, C12_PEOPLE);
  return new Map(rows.map((person) => [person.id, person]));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
