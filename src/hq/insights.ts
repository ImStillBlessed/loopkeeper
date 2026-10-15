import type { Graph } from "falkordb";
import { H14_SLA_POLICIES } from "../graph/hq-queries.js";
import { I1_SENTIMENT_SINCE, I2_LAST_STAFF_REPLY, I3_LAST_CLIENT_MESSAGE, OPEN_STATUSES, Q0_STATS, Q11_BOARD, Q4_DUE_FOLLOWUPS, run } from "../graph/queries.js";
import type { ClientRecord, World } from "../runtime/world.js";

/**
 * What a support manager looks at: SLA timers, client health, the queue across clients, and trends.
 * Everything is computed from the client graphs on request, on the chat's clock.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SlaState = "on_track" | "due_soon" | "breached" | "met" | "missed";

export interface Sla {
  state: SlaState;
  /** Which deadline the state is about: the first reply, or the fix. */
  stage: "response" | "resolution";
  dueAt: number;
  firstResponseDue: number;
  resolveDue: number;
}

export interface Ticket {
  id: string;
  title: string;
  kind: string;
  status: string;
  severity: string;
  feature: string;
  createdAt: number;
  updatedAt: number;
  firstResponseAt: number;
  resolvedAt: number;
  messages: number;
  merged: number;
  owner: string;
  escalated: boolean;
  /** The tone of the client's messages on this ticket (calm, concerned, frustrated). */
  moods: string[];
  clientId: string;
  clientName: string;
  plan: string;
  sla: Sla;
}

export interface SlaPolicy {
  plan: string;
  firstResponseMins: number;
  resolveMins: number;
}

export interface Health {
  score: number;
  band: "healthy" | "watch" | "at_risk";
  /** Plain-language reasons for every point lost, so the number can be trusted. */
  reasons: Array<{ text: string; points: number }>;
}

const OPEN = new Set(OPEN_STATUSES);
const SEVERE = new Set(["critical", "high"]);

/** SLA for one ticket: first reply and fix deadlines from the client's plan, judged on the chat clock. */
export function slaFor(ticket: { createdAt: number; firstResponseAt: number; resolvedAt: number; status: string; kind?: string }, policy: SlaPolicy, now: number): Sla {
  const firstResponseDue = ticket.createdAt + policy.firstResponseMins * MINUTE;
  const resolveDue = ticket.createdAt + policy.resolveMins * MINUTE;
  const base = { firstResponseDue, resolveDue };

  // Feature requests only promise a first reply: building something new has no fix deadline.
  if (ticket.kind === "feature_request" && (ticket.firstResponseAt || ticket.status === "resolved")) {
    const met = (ticket.firstResponseAt || ticket.resolvedAt) <= firstResponseDue;
    return { ...base, state: met ? "met" : "missed", stage: "response", dueAt: firstResponseDue };
  }

  if (ticket.status === "resolved") {
    const met = (ticket.resolvedAt || now) <= resolveDue;
    return { ...base, state: met ? "met" : "missed", stage: "resolution", dueAt: resolveDue };
  }
  const waitingForReply = !ticket.firstResponseAt;
  const stage = waitingForReply && now < resolveDue ? "response" : "resolution";
  const dueAt = stage === "response" ? firstResponseDue : resolveDue;
  const window = stage === "response" ? policy.firstResponseMins * MINUTE : policy.resolveMins * MINUTE;
  if (now > dueAt) return { ...base, state: "breached", stage, dueAt };
  return { ...base, state: dueAt - now <= window * 0.25 ? "due_soon" : "on_track", stage, dueAt };
}

export async function slaPolicies(hq: Graph): Promise<Map<string, SlaPolicy>> {
  const policies = await run<SlaPolicy>(hq, H14_SLA_POLICIES);
  return new Map(policies.map((p) => [p.plan, p]));
}

/** Every ticket of the given clients, with its SLA. Merged duplicates are left out. */
export async function ticketsFor(world: World, clients: ClientRecord[]): Promise<Ticket[]> {
  const policies = await slaPolicies(world.hq);
  const now = world.clock.peek();
  const fallback: SlaPolicy = { plan: "standard", firstResponseMins: 240, resolveMins: 4320 };
  const perClient = await Promise.all(
    clients.map(async (client) => {
      const rows = await run<Omit<Ticket, "clientId" | "clientName" | "plan" | "sla">>(world.client(client.id).graph, Q11_BOARD);
      const policy = policies.get(client.plan) ?? fallback;
      return rows.map((row) => ({ ...row, clientId: client.id, clientName: client.name, plan: client.plan, sla: slaFor(row, policy, now) }));
    }),
  );
  return perClient.flat();
}

/** Health 0–100 for one client, from its own graph, with the reason for every point lost. */
export async function healthOf(world: World, client: ClientRecord, tickets: Ticket[]): Promise<Health> {
  const graph = world.client(client.id).graph;
  const now = world.clock.peek();
  const open = tickets.filter((t) => t.clientId === client.id && OPEN.has(t.status));
  const reasons: Health["reasons"] = [];
  const lose = (points: number, text: string) => points > 0 && reasons.push({ text, points });

  const severe = open.filter((t) => SEVERE.has(t.severity)).length;
  lose(Math.min(30, severe * 10), `${severe} serious ${severe === 1 ? "problem" : "problems"} open`);
  const minor = open.length - severe;
  lose(Math.min(12, minor * 3), `${minor} smaller ${minor === 1 ? "ticket" : "tickets"} open`);
  const breached = open.filter((t) => t.sla.state === "breached").length;
  lose(Math.min(36, breached * 12), `${breached} SLA ${breached === 1 ? "breach" : "breaches"}`);

  const followUps = await run<{ status: string; dueAt: number }>(graph, Q4_DUE_FOLLOWUPS, { until: now });
  const overdue = followUps.filter((f) => f.status === "overdue" || f.dueAt < now).length;
  lose(Math.min(18, overdue * 6), `${overdue} overdue ${overdue === 1 ? "promise" : "promises"}`);

  const moods = await run<{ sentiment: string; messages: number }>(graph, I1_SENTIMENT_SINCE, { since: now - 7 * DAY });
  const frustrated = moods.find((m) => m.sentiment === "frustrated")?.messages ?? 0;
  lose(Math.min(12, frustrated * 4), `${frustrated} frustrated ${frustrated === 1 ? "message" : "messages"} this week`);

  const [{ lastReply }] = await run<{ lastReply: number | null }>(graph, I2_LAST_STAFF_REPLY);
  if (open.length > 0 && lastReply && now - lastReply > 2 * DAY) lose(10, `No reply from Ednovax in ${Math.floor((now - lastReply) / DAY)} days`);

  reasons.sort((a, b) => b.points - a.points);
  const score = Math.max(0, 100 - reasons.reduce((sum, r) => sum + r.points, 0));
  return { score, band: score >= 75 ? "healthy" : score >= 50 ? "watch" : "at_risk", reasons };
}

export interface ClientSummary extends ClientRecord {
  health: Health;
  openTickets: number;
  breached: number;
  seen: number;
  ignored: number;
  lastMessageAt: number;
}

/** The client directory: each client with health, open work and when they last wrote. */
export async function clientSummaries(world: World, clients: ClientRecord[], tickets?: Ticket[]): Promise<ClientSummary[]> {
  const all = tickets ?? (await ticketsFor(world, clients));
  return Promise.all(
    clients.map(async (client) => {
      const graph = world.client(client.id).graph;
      const [stats] = await run<{ seen: number; ignored: number }>(graph, Q0_STATS);
      const [{ lastMessage }] = await run<{ lastMessage: number | null }>(graph, I3_LAST_CLIENT_MESSAGE);
      const mine = all.filter((t) => t.clientId === client.id && OPEN.has(t.status));
      return {
        ...client,
        health: await healthOf(world, client, all),
        openTickets: mine.length,
        breached: mine.filter((t) => t.sla.state === "breached").length,
        seen: stats?.seen ?? 0,
        ignored: stats?.ignored ?? 0,
        lastMessageAt: lastMessage ?? 0,
      };
    }),
  );
}

/** Analytics over the last 30 chat days: volume, speed, SLA compliance, and where tickets come from. */
export function analytics(tickets: Ticket[], now: number, featureNames: Map<string, string>) {
  const start = startOfDay(now) - 29 * DAY;
  const days = Array.from({ length: 30 }, (_, i) => start + i * DAY);
  const inRange = (ts: number) => ts >= start;

  const daily = days.map((day) => ({
    day,
    opened: tickets.filter((t) => t.createdAt >= day && t.createdAt < day + DAY).length,
    resolved: tickets.filter((t) => t.resolvedAt >= day && t.resolvedAt < day + DAY).length,
  }));

  const responded = tickets.filter((t) => inRange(t.createdAt) && t.firstResponseAt > 0);
  const resolved = tickets.filter((t) => inRange(t.createdAt) && t.status === "resolved" && t.resolvedAt > 0);
  const judged = tickets.filter((t) => inRange(t.createdAt) && (t.status === "resolved" || t.sla.state === "breached"));
  const met = judged.filter((t) => t.sla.state === "met").length;

  const countBy = (key: (t: Ticket) => string) => {
    const counts = new Map<string, number>();
    for (const t of tickets.filter((x) => inRange(x.createdAt))) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  return {
    from: start,
    to: now,
    daily,
    totals: {
      opened: tickets.filter((t) => inRange(t.createdAt)).length,
      resolved: resolved.length,
      open: tickets.filter((t) => OPEN.has(t.status)).length,
    },
    medianFirstResponseMins: median(responded.map((t) => (t.firstResponseAt - t.createdAt) / MINUTE)),
    medianResolveHours: median(resolved.map((t) => (t.resolvedAt - t.createdAt) / HOUR)),
    slaCompliance: judged.length ? Math.round((met / judged.length) * 100) : null,
    byFeature: countBy((t) => featureNames.get(t.feature) ?? (t.feature || "Unclassified")).slice(0, 8),
    byClient: countBy((t) => t.clientName),
    byKind: countBy((t) => t.kind),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/** Lagos midnight of the day containing `ts`. */
function startOfDay(ts: number): number {
  const local = new Date(ts + HOUR);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - HOUR;
}
