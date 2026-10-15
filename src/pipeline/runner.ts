import type { Graph } from "falkordb";
import { C12_PEOPLE, C13_FEATURES, Q0_STATS, run, W1_COUNT_MESSAGE, W2_MESSAGE } from "../graph/queries.js";
import type { ChatMessage } from "../ingest/types.js";
import type { Llm } from "../llm/llm.js";
import { applyExtraction, type IssueCreatedHook, type StatusChangeHook } from "./apply.js";
import { extract } from "./extract.js";
import { sendDueReminders } from "./reminders.js";
import { TRIAGE_BATCH_SIZE, triageBatch } from "./triage.js";
import type { Feature, Person, PipelineEvent, TriageResult } from "./types.js";

export interface PipelineOptions {
  graph: Graph;
  llm: Llm;
  emit: (event: PipelineEvent) => void;
  /** Called after any status change, e.g. to keep a linked GitHub issue in sync. */
  onStatusChange?: StatusChangeHook;
  /** Called when a ticket is opened, e.g. to record a cross-client signal in HQ. */
  onIssueCreated?: IssueCreatedHook;
  signal?: AbortSignal;
}

const RECENT_CONTEXT = 8;

/** Ingests a whole list of messages (an imported export, or a test), batch by batch. */
export async function ingestMessages(messages: ChatMessage[], options: PipelineOptions): Promise<void> {
  const seenSoFar: ChatMessage[] = [];
  for (let start = 0; start < messages.length; start += TRIAGE_BATCH_SIZE) {
    if (options.signal?.aborted) return;
    const batch = messages.slice(start, start + TRIAGE_BATCH_SIZE);
    await processBatch(batch, seenSoFar, options);
    seenSoFar.push(...batch);
  }
}

/**
 * The pipeline for a batch of messages that arrived together:
 *   triage (one call) → for each message: count it; if it's work, store it, extract, write to the graph
 *   → send any reminders that are now due on the chat's clock.
 * `previous` is the conversation just before the batch, so replies like "same here" make sense.
 */
export async function processBatch(batch: ChatMessage[], previous: ChatMessage[], options: PipelineOptions): Promise<void> {
  const { graph, llm } = options;
  const [people, features] = await Promise.all([
    run<Person>(graph, C12_PEOPLE).then((rows) => new Map(rows.map((p) => [p.id, p]))),
    run<Feature>(graph, C13_FEATURES),
  ]);
  const verdicts = await triageBatch(llm, batch, previous, people);
  const recent = previous.slice(-RECENT_CONTEXT);

  for (const [index, message] of batch.entries()) {
    if (options.signal?.aborted) return;
    // Notes staff add from Ask are kept even if triage would call them small talk.
    const verdict = message.trusted ? { ...verdicts[index], relevant: true, type: verdicts[index].type ?? "status_update" } : verdicts[index];
    await processMessage(message, verdict, recent, people, features, options);
    recent.push(message);
    if (recent.length > RECENT_CONTEXT) recent.shift();
  }
}

async function processMessage(
  message: ChatMessage,
  verdict: TriageResult,
  recent: ChatMessage[],
  people: Map<string, Person>,
  features: Feature[],
  { graph, llm, emit, onStatusChange, onIssueCreated }: PipelineOptions,
): Promise<void> {
  const ts = Date.parse(message.ts);
  // Activity lines and the feed use the roster name, not the masked number WhatsApp showed.
  const senderName = people.get(message.senderId)?.name ?? message.senderName;
  emit({
    kind: "message",
    message: {
      id: message.id,
      groupId: message.groupId,
      ts: message.ts,
      senderName,
      text: message.text,
      hasMedia: message.hasMedia,
      relevant: verdict.relevant,
      type: verdict.type,
      sentiment: verdict.sentiment,
    },
  });

  await run(graph, W1_COUNT_MESSAGE, { ignored: verdict.relevant ? 0 : 1, ts, groupId: message.groupId });

  if (verdict.relevant) {
    const [embedding] = await llm.embed([message.text || "[photo]"]);
    await run(graph, W2_MESSAGE, {
      id: message.id,
      groupId: message.groupId,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      ts,
      type: verdict.type,
      hasMedia: message.hasMedia,
      sentiment: verdict.sentiment ?? "calm",
      embedding,
    });

    const { extraction } = await extract(graph, llm, { message, embedding, recent, people, features });
    const role = people.get(message.senderId)?.role;
    const senderIsStaff = role === "developer" || role === "support";
    await applyExtraction({ graph, llm, message: { ...message, senderName }, features, emit, senderIsStaff, onStatusChange, onIssueCreated }, extraction);
  }

  for (const reminder of await sendDueReminders(graph, ts)) {
    emit({ kind: "bot", text: reminder.text, ts: message.ts, groupId: message.groupId });
  }

  const [stats] = await run<{ seen: number; ignored: number; used: number }>(graph, Q0_STATS);
  if (stats) emit({ kind: "stats", seen: stats.seen, ignored: stats.ignored, used: stats.used });
}
