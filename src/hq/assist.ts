import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";
import { STATUS_WORDS } from "../pipeline/status.js";
import type { ClientSummary, Ticket } from "./insights.js";

/** The ticket facts a suggested reply may use: nothing more, so it can't promise what hasn't happened. */
export interface ReplyFacts {
  clientName: string;
  title: string;
  status: string;
  severity: string;
  sla: string;
  messages: Array<{ sender: string; text: string; ts: number; sentiment: string }>;
  history: Array<{ to: string; by: string; at: number }>;
  otherClients: number;
  pullRequests: Array<{ title: string; state: string }>;
}

export interface SuggestedReply {
  reply: string;
  why: string;
  /** "model" when the language model wrote it, "template" when there was no model to ask. */
  source: "model" | "template";
}

/** Drafts the agent's next message in the client's group. Falls back to a plain template without a model. */
export async function suggestReply(llm: Llm, facts: ReplyFacts): Promise<SuggestedReply> {
  try {
    const result = await llm.json<{ reply: string; why: string }>("fast", prompt("reply"), {
      ...facts,
      status: STATUS_WORDS[facts.status] ?? facts.status,
      messages: facts.messages.map((m) => ({ ...m, ts: new Date(m.ts).toISOString() })),
      history: facts.history.map((h) => ({ ...h, at: new Date(h.at).toISOString() })),
    });
    if (result.reply) return { reply: result.reply, why: result.why ?? "", source: "model" };
  } catch {
    // No key or out of quota: the template below is still useful.
  }
  return templateReply(facts);
}

function templateReply(facts: ReplyFacts): SuggestedReply {
  const reporter = facts.messages[0]?.sender ?? "everyone";
  const frustrated = facts.messages.some((m) => m.sentiment === "frustrated");
  const sorry = frustrated ? "We're sorry for the trouble this has caused. " : "";
  const title = `"${facts.title}"`;
  const merged = facts.pullRequests.some((pr) => pr.state === "merged");
  const inReview = facts.pullRequests.some((pr) => pr.state === "open");
  const others = facts.otherClients > 0 ? " A few other schools reported the same thing, so it has our full attention." : "";

  let body: string;
  if (facts.status === "resolved") body = `The issue ${title} has been fixed. Please let us know if you notice anything else.`;
  else if (facts.status === "possibly_resolved" || merged) body = `A fix for ${title} has just gone out. Could you check on your side and confirm it's working now? 🙏`;
  else if (inReview) body = `Our developers have a fix for ${title} in review now. We'll update you here as soon as it's live.`;
  else if (facts.status === "in_progress") body = `Our team is working on ${title}. We'll update you here once it's fixed.`;
  else body = `Thank you for reporting ${title}. We've logged it and the team is looking into it now.`;

  return { reply: `Good day ${reporter}. ${sorry}${body}${others}`, why: "Written from the ticket's status (no model available).", source: "template" };
}


// ─── Ask across all clients ──────────────────────────────────────────────────

export interface DeskSnapshot {
  now: number;
  clients: ClientSummary[];
  tickets: Ticket[];
  patterns: Array<{ title: string; clients: number; statuses: string[]; affected: string[]; pullRequests: string[] }>;
  analytics: unknown;
}

/**
 * Answers a question about the whole desk from a snapshot built from the clients this person can see.
 * One model call, no tools: the snapshot is small, already scoped, and holds no message text.
 */
export async function askHq(
  llm: Llm,
  question: string,
  history: Array<{ question: string; answer: string }>,
  snapshot: DeskSnapshot,
): Promise<{ answer: string; remember: Array<{ clientId: string; text: string }> }> {
  const open = snapshot.tickets.filter((t) => t.status !== "resolved");
  const result = await llm.json<{ answer: string; remember?: Array<{ client_id: string; text: string }> }>("smart", prompt("hq"), {
    now: new Date(snapshot.now).toISOString(),
    clients: snapshot.clients.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      plan: c.plan,
      agent: c.agentName,
      products: c.products,
      health: c.health.score,
      healthReasons: c.health.reasons.map((r) => `${r.text} (−${r.points})`),
      openTickets: c.openTickets,
      slaBreaches: c.breached,
      lastMessage: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
    })),
    openTickets: open.map((t) => ({
      id: t.id,
      client: t.clientName,
      title: t.title,
      kind: t.kind,
      status: t.status,
      severity: t.severity,
      feature: t.feature,
      owner: t.owner || "unassigned",
      escalated: t.escalated,
      sla: `${t.sla.state} (${t.sla.stage} due ${new Date(t.sla.dueAt).toISOString()})`,
      openedAt: new Date(t.createdAt).toISOString(),
    })),
    patterns: snapshot.patterns,
    analytics: snapshot.analytics,
    earlierInThisConversation: history.slice(-4),
    question,
  });
  // Only clients in the snapshot (the ones this person can see) can be written to.
  const known = new Set(snapshot.clients.map((c) => c.id));
  return {
    answer: result.answer ?? "I couldn't put an answer together. Try asking another way.",
    remember: (result.remember ?? []).filter((r) => known.has(r.client_id) && r.text?.trim()).map((r) => ({ clientId: r.client_id, text: r.text.trim() })),
  };
}
