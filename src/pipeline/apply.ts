import type { Graph } from "falkordb";
import { config } from "../config.js";
import {
  C6_OPEN_FOLLOWUPS,
  C7_FIND_PERSON,
  C8_CANONICAL,
  run,
  W11_FOLLOWUP_ABOUT,
  W12_COMPLETE_FOLLOWUP,
  W13_DECISION,
  W10_CREATE_FOLLOWUP,
  W3_CREATE_ISSUE,
  W4_LINK_FEATURE_AND_OWNER,
  W5_ADD_EVIDENCE,
  W6_CHANGE_STATUS,
} from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";
import type { ChatMessage } from "../ingest/types.js";
import type { Llm } from "../llm/llm.js";
import { mergeDuplicates } from "./duplicates.js";
import { formatLagosDay, HOUR, parseLagosDate } from "./time.js";
import type { Extraction, Feature, PipelineEvent, UpdateKind } from "./types.js";

/** Notified after a status change, e.g. to comment on or close a linked GitHub issue. */
export type StatusChangeHook = (change: { issueId: string; to: string; reason: string }) => void;

export interface ApplyContext {
  graph: Graph;
  llm: Llm;
  message: ChatMessage;
  /** This project's product features; extraction may only use these keys. */
  features: Feature[];
  emit: (event: PipelineEvent) => void;
  onStatusChange?: StatusChangeHook;
}

const knownFeature = (ctx: ApplyContext, key: string | null) => (key && ctx.features.some((f) => f.key === key) ? key : null);

/** Writes one message's extraction into the graph. Every write links back to the message as its source. */
export async function applyExtraction(ctx: ApplyContext, extraction: Extraction): Promise<void> {
  const ts = Date.parse(ctx.message.ts);
  const issueTitles = new Map<string, string>();

  for (const issue of extraction.new_issues) {
    const issueId = await createIssue(ctx, issue, ts);
    issueTitles.set(issueId, issue.title);
  }

  for (const update of extraction.issue_updates) {
    await applyIssueUpdate(ctx, update.issue_id, update.kind, update.confidence, ts);
  }

  for (const followUp of extraction.new_followups) {
    await createFollowUp(ctx, followUp, ts);
  }

  const openFollowUps = await run<{ id: string; text: string }>(ctx.graph, C6_OPEN_FOLLOWUPS);
  for (const { followup_id } of extraction.completed_followups) {
    const followUp = openFollowUps.find((f) => f.id === followup_id);
    if (!followUp) continue;
    await run(ctx.graph, W12_COMPLETE_FOLLOWUP, { followUpId: followUp.id, messageId: ctx.message.id, ts });
    activity(ctx, `Promise kept: ${followUp.text}`);
  }

  for (const decision of extraction.decisions) {
    const featureKey = knownFeature(ctx, decision.feature_key);
    await run(ctx.graph, W13_DECISION, {
      id: stableId("dec", [ctx.message.id, decision.text]),
      messageId: ctx.message.id,
      text: decision.text,
      ts,
      featureKey,
    });
    activity(ctx, `Recorded a decision: ${decision.text}`);
  }
}

async function createIssue(ctx: ApplyContext, issue: Extraction["new_issues"][number], ts: number): Promise<string> {
  const id = stableId("iss", [ctx.message.id, issue.title]);
  const featureKey = knownFeature(ctx, issue.feature_key);
  const [embedding] = await ctx.llm.embed([`${issue.title}. ${issue.summary}`]);

  await run(ctx.graph, W3_CREATE_ISSUE, {
    id,
    messageId: ctx.message.id,
    title: issue.title,
    summary: issue.summary,
    kind: issue.kind,
    severity: issue.severity,
    featureKey,
    ts,
    embedding,
  });

  let owner: string | undefined;
  if (featureKey) {
    const [assigned] = await run<{ owner: string }>(ctx.graph, W4_LINK_FEATURE_AND_OWNER, { issueId: id, featureKey });
    owner = assigned?.owner;
  }
  const feature = ctx.features.find((f) => f.key === featureKey)?.name;
  activity(ctx, `Opened ${issue.kind === "bug" ? "a problem" : issue.kind === "question" ? "a question" : "a request"}: "${issue.title}"${feature ? ` in ${feature}` : ""}${owner ? `, assigned to ${owner}` : ""}`, id);

  for (const merge of await mergeDuplicates(ctx.graph, ctx.llm, id, ts)) {
    activity(ctx, `Recognised a duplicate and merged it into "${merge.canonicalTitle}"`, merge.canonicalId);
  }
  return id;
}

async function applyIssueUpdate(ctx: ApplyContext, issueIdFromModel: string, kind: UpdateKind, confidence: number, ts: number) {
  // The model may point at an issue that has since been merged: follow DUPLICATE_OF to the canonical one.
  const [issue] = await run<{ id: string; status: string }>(ctx.graph, C8_CANONICAL, { issueId: issueIdFromModel });
  if (!issue) return;

  const evidenceKind = kind === "answered" ? "resolved" : kind;
  await run(ctx.graph, W5_ADD_EVIDENCE, { messageId: ctx.message.id, issueId: issue.id, kind: evidenceKind, ts });

  const nextStatus = statusAfter(kind, issue.status, confidence);
  if (!nextStatus || nextStatus === issue.status) {
    if (kind === "confirmed") activity(ctx, `Added to an open issue: ${ctx.message.senderName} has it too`, issue.id);
    return;
  }

  await run(ctx.graph, W6_CHANGE_STATUS, {
    id: stableId("sc", [issue.id, ctx.message.id, nextStatus]),
    issueId: issue.id,
    messageId: ctx.message.id,
    to: nextStatus,
    ts,
    confidence,
  });
  const label =
    nextStatus === "possibly_resolved"
      ? "might be fixed, waiting for a person to confirm"
      : nextStatus === "in_progress" ? "being worked on" : nextStatus;
  activity(ctx, `Marked ${label}, because ${ctx.message.senderName} said so`, issue.id);
  ctx.onStatusChange?.({ issueId: issue.id, to: nextStatus, reason: `${ctx.message.senderName} said: "${ctx.message.text}"` });
}

/**
 * The status rules. A resolution only closes an issue when the model is confident the message is
 * about that issue; otherwise it becomes "possibly resolved" and waits for a human.
 */
export function statusAfter(kind: UpdateKind, current: string, confidence: number): string | undefined {
  switch (kind) {
    case "in_progress":
      return current === "open" ? "in_progress" : undefined;
    case "resolved":
    case "answered":
      return confidence >= config.autoCloseMinConfidence ? "resolved" : "possibly_resolved";
    case "reopened":
      return "open";
    default:
      return undefined;
  }
}

async function createFollowUp(ctx: ApplyContext, followUp: Extraction["new_followups"][number], ts: number) {
  const [owner] = followUp.owner_name
    ? await run<{ id: string; name: string }>(ctx.graph, C7_FIND_PERSON, { name: followUp.owner_name.replace(/^@/, "") })
    : [];
  const ownerId = owner?.id ?? ctx.message.senderId;
  const ownerName = owner?.name ?? ctx.message.senderName;
  const dueAt = parseLagosDate(followUp.due) ?? ts + 24 * HOUR;
  const id = stableId("fu", [ctx.message.id, followUp.text]);

  await run(ctx.graph, W10_CREATE_FOLLOWUP, { id, messageId: ctx.message.id, ownerId, text: followUp.text, dueAt, ts });
  if (followUp.issue_id) {
    const [issue] = await run<{ id: string }>(ctx.graph, C8_CANONICAL, { issueId: followUp.issue_id });
    if (issue) await run(ctx.graph, W11_FOLLOWUP_ABOUT, { followUpId: id, issueId: issue.id });
  }
  activity(ctx, `Noted a promise: ${ownerName} will ${followUp.text.charAt(0).toLowerCase()}${followUp.text.slice(1)} by ${formatLagosDay(dueAt)}`);
}

function activity(ctx: ApplyContext, text: string, issueId?: string) {
  ctx.emit({ kind: "activity", text, issueId, ts: ctx.message.ts });
}
