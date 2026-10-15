import type { Graph } from "falkordb";
import { castMember, castOf } from "../../data/synthetic/cast.js";
import { PAST_SMALL_TALK, PAST_TICKETS, type PastTicket } from "../../data/synthetic/history.js";
import { config } from "../config.js";
import {
  query,
  run,
  W10_CREATE_FOLLOWUP,
  W11_FOLLOWUP_ABOUT,
  W12_COMPLETE_FOLLOWUP,
  W15_FIRST_RESPONSE,
  W2_MESSAGE,
  W3_CREATE_ISSUE,
  W4_LINK_FEATURE_AND_OWNER,
  W5_ADD_EVIDENCE,
  W6_CHANGE_STATUS,
  W7_CHANGE_STATUS_BY_HUMAN,
  W18_ESCALATE,
} from "../graph/queries.js";
import { personId, stableId } from "../ingest/ids.js";
import { embedLocally } from "../llm/embeddings.js";
import { groupIdOf } from "./seed.js";
import { recordSignal } from "./signals.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const H1_COUNT_PAST = query("HS1", "Count past messages, including small talk that was never stored", `
  MATCH (c:Client), (g:Group {id: $groupId})
  SET c.seen = coalesce(c.seen, 0) + $seen, c.ignored = coalesce(c.ignored, 0) + $ignored,
      c.clock = CASE WHEN $last > coalesce(c.clock, 0) THEN $last ELSE c.clock END,
      g.seen = coalesce(g.seen, 0) + $seen,
      g.lastMessageAt = CASE WHEN $last > coalesce(g.lastMessageAt, 0) THEN $last ELSE g.lastMessageAt END`);

/** Lagos time `hh:mm`, `daysAgo` days before `now`, never later than a few minutes ago. */
function lagosTime(now: number, daysAgo: number, at: string): number {
  const [hours, minutes] = at.split(":").map(Number);
  const today = new Date(now + HOUR); // Lagos is UTC+1 all year
  const ts = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hours - 1, minutes);
  return Math.min(ts, now - 30 * MINUTE);
}

/**
 * Writes the past tickets of one client into its graph (messages, tickets, replies, status changes,
 * promises) and leaves each ticket's abstract signal in HQ, so patterns form just as they do live.
 * Uses only local embeddings: no language model calls.
 */
export async function seedClientHistory(hq: Graph, graph: Graph, clientId: string, now: number): Promise<number> {
  const tickets = PAST_TICKETS.filter((t) => t.client === clientId).sort((a, b) => b.daysAgo - a.daysAgo);
  const groupId = groupIdOf(clientId);
  const privateNames = castOf(clientId).filter((m) => m.clientId).map((m) => m.name);
  let stored = 0;
  let last = 0;

  for (const ticket of tickets) {
    const reportedAt = ticket.hoursAgo ? now - ticket.hoursAgo * HOUR : lagosTime(now, ticket.daysAgo, ticket.at);
    const messages = [{ after: 0, ...ticket.report }, ...ticket.thread].filter((m) => reportedAt + m.after * MINUTE < now);
    const [issueEmbedding, ...messageEmbeddings] = await embedLocally([`${ticket.title}. ${ticket.summary}`, ...messages.map((m) => m.text)]);
    const issueId = stableId("iss", [clientId, ticket.key]);

    for (const [index, message] of messages.entries()) {
      const sender = castMember(message.by);
      const ts = reportedAt + message.after * MINUTE;
      const messageId = stableId("msg", [clientId, ticket.key, String(index)]);
      const isStaff = !sender.clientId;
      await run(graph, W2_MESSAGE, {
        id: messageId,
        groupId,
        senderId: personId(sender.whatsappLabel, config.idHashSalt),
        senderName: sender.name,
        text: message.text,
        ts,
        type: index === 0 ? ticket.kind : isStaff ? "status_update" : closes(ticket, index, messages.length) ? "resolution" : ticket.kind,
        hasMedia: false,
        sentiment: message.sentiment ?? "calm",
        embedding: messageEmbeddings[index],
      });

      if (index === 0) {
        await run(graph, W3_CREATE_ISSUE, {
          messageId, id: issueId, title: ticket.title, summary: ticket.summary, kind: ticket.kind,
          severity: ticket.severity, featureKey: ticket.feature, ts, embedding: issueEmbedding,
        });
        await run(graph, W4_LINK_FEATURE_AND_OWNER, { issueId, featureKey: ticket.feature });
      } else {
        await run(graph, W5_ADD_EVIDENCE, { messageId, issueId, kind: isStaff ? "update" : closes(ticket, index, messages.length) ? "confirmed_fixed" : "reported", ts });
        if (isStaff) await run(graph, W15_FIRST_RESPONSE, { issueId, ts });
        if (closes(ticket, index, messages.length)) {
          await run(graph, W6_CHANGE_STATUS, { id: stableId("sc", [issueId, "resolved"]), issueId, messageId, to: "resolved", ts, confidence: 0.95 });
        }
      }
      if (index === 0 && ticket.promise) await recordPromise(graph, ticket, issueId, messageId, ts, now);
      stored++;
      last = Math.max(last, ts);
    }

    if (ticket.status === "in_progress" || ticket.status === "possibly_resolved") {
      const by = ticket.thread.find((m) => !castMember(m.by).clientId);
      const at = by ? reportedAt + by.after * MINUTE + MINUTE : reportedAt + HOUR;
      await run(graph, W7_CHANGE_STATUS_BY_HUMAN, { id: stableId("sc", [issueId, ticket.status]), issueId, to: ticket.status, ts: Math.min(at, now), by: "Tunde Bakare (dashboard)" });
    }

    if (ticket.escalated) {
      const lead = { issueId, ts: Math.min(reportedAt + DAY, now), by: "Ngozi Eze", note: "Teachers can't work and report cards go out next week" };
      await run(graph, W18_ESCALATE, lead);
    }

    await recordSignal(
      hq,
      { clientId, issueId, title: ticket.title, featureKey: ticket.feature, severity: ticket.severity, status: ticket.status, embedding: issueEmbedding, privateNames },
      reportedAt,
    );
  }

  const ignored = PAST_SMALL_TALK[clientId] ?? 0;
  await run(graph, H1_COUNT_PAST, { groupId, seen: stored + ignored, ignored, last });
  return tickets.length;
}

/** A resolved ticket is closed by its last message, when that comes from the client. */
function closes(ticket: PastTicket, index: number, count: number): boolean {
  return ticket.status === "resolved" && index === count - 1;
}

async function recordPromise(graph: Graph, ticket: PastTicket, issueId: string, messageId: string, ts: number, now: number): Promise<void> {
  const promise = ticket.promise!;
  const owner = castMember(promise.by);
  const followUpId = stableId("fu", [issueId, promise.text]);
  const dueAt = ts + promise.dueAfterHours * HOUR;
  await run(graph, W10_CREATE_FOLLOWUP, { messageId, ownerId: personId(owner.whatsappLabel, config.idHashSalt), id: followUpId, text: promise.text, dueAt, ts });
  await run(graph, W11_FOLLOWUP_ABOUT, { followUpId, issueId });
  if (promise.kept && dueAt < now) await run(graph, W12_COMPLETE_FOLLOWUP, { followUpId, messageId, ts: dueAt - HOUR });
}
