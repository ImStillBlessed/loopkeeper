import type { Graph } from "falkordb";
import { config } from "../config.js";
import type { ClientChannel } from "../github/activity.js";
import { syncGithubIssue } from "../github/issues.js";
import { getClientGraph } from "../graph/client.js";
import { X14_CLIENT_SIGNALS_RESET } from "../graph/hq-queries.js";
import { C12_PEOPLE, F1_RECENT_MESSAGES, F2_RECENT_REMINDERS, P2_CLIENT_SUMMARY, P4_GROUPS, Q0_STATS, R1_RESET_CHAT, run } from "../graph/queries.js";
import { recordSignal, updateSignalStatus } from "../hq/signals.js";
import { makeLiveMessage, toLagosIso } from "../ingest/live.js";
import { parseWhatsAppExport } from "../ingest/whatsapp-export.js";
import { claudeLlm, ProviderLimitError } from "../llm/llm.js";
import type { MessageType } from "../pipeline/message-types.js";
import { sendDueReminders } from "../pipeline/reminders.js";
import { ingestMessages, type PipelineOptions } from "../pipeline/runner.js";
import { changeStatusFromOutside, STATUS_WORDS, type StatusChangeResult } from "../pipeline/status.js";
import type { PipelineEvent } from "../pipeline/types.js";
import type { ChatClock } from "./clock.js";
import type { EventHub } from "./hub.js";
import { Inbox } from "./inbox.js";

const REMINDER_CHECK_MS = 20_000;
const FEED_RESTORE_LIMIT = 300;

/** What a client needs from the app around it. */
export interface WorldServices {
  hq: Graph;
  hub: EventHub;
  clock: ChatClock;
  /** Pause the simulated groups (when the model provider refuses requests). */
  pauseLive: () => boolean;
}

/**
 * Everything live about one client: its inbox for incoming WhatsApp messages, its reminders, and the
 * link to HQ (every ticket leaves an abstract signal there, which is how cross-client patterns form).
 * Everything it says goes on the app-wide event stream, tagged with its client id.
 */
export class ClientRuntime {
  readonly inbox: Inbox;
  private importing: AbortController | undefined;
  private timers: Array<ReturnType<typeof setInterval>> = [];

  private constructor(
    readonly id: string,
    readonly graph: Graph,
    private world: WorldServices,
  ) {
    this.inbox = new Inbox(
      async () => this.pipelineOptions(),
      (error) => this.reportPipelineError(error),
    );
  }

  static async load(id: string, world: WorldServices): Promise<ClientRuntime> {
    const runtime = new ClientRuntime(id, await getClientGraph(id), world);
    const [summary] = await run<{ clock: number }>(runtime.graph, P2_CLIENT_SUMMARY);
    world.clock.setAtLeast(summary?.clock ?? 0);
    await runtime.restoreFeed();
    runtime.startTimers();
    return runtime;
  }

  emit(event: PipelineEvent): void {
    this.world.hub.emit({ ...event, clientId: this.id });
  }

  /** A message arrives in one of this client's WhatsApp groups (simulated, typed, or a real webhook). */
  async receive(senderLabel: string, text: string, options: { groupId?: string; ts?: number; hasMedia?: boolean; trusted?: boolean } = {}): Promise<void> {
    const groupId = options.groupId ?? (await this.defaultGroupId());
    const ts = options.ts ?? this.world.clock.now();
    this.inbox.push(makeLiveMessage({ groupId, senderLabel, text, ts, hasMedia: options.hasMedia, trusted: options.trusted, salt: config.idHashSalt }));
  }

  async defaultGroupId(): Promise<string> {
    const [first] = await run<{ id: string }>(this.graph, P4_GROUPS);
    if (!first) throw new Error("This client has no WhatsApp group yet. Add one in Settings.");
    return first.id;
  }

  /** Imports a WhatsApp export into a group, in the background. */
  importExport(groupId: string, text: string): number {
    const { messages } = parseWhatsAppExport(text, { groupId, salt: config.idHashSalt, utcOffset: config.chatUtcOffset });
    this.importing?.abort();
    const controller = new AbortController();
    this.importing = controller;
    this.emit({ kind: "run", state: "started" });
    void this.pipelineOptions()
      .then((options) => ingestMessages(messages, { ...options, signal: controller.signal }))
      .then(() => this.emit({ kind: "run", state: controller.signal.aborted ? "stopped" : "finished" }))
      .catch((error: Error) => this.reportPipelineError(error));
    return messages.length;
  }

  /** Forgets everything learned from chats and GitHub for this client; keeps its groups, contacts and products. */
  async reset(): Promise<void> {
    this.inbox.clear();
    this.importing?.abort();
    await run(this.graph, R1_RESET_CHAT);
    await run(this.world.hq, X14_CLIENT_SIGNALS_RESET, { clientId: this.id });
    this.world.hub.clearClient(this.id);
    this.emit({ kind: "stats", seen: 0, ignored: 0, used: 0 });
  }

  async stats() {
    const [stats] = await run<{ seen: number; ignored: number; used: number }>(this.graph, Q0_STATS);
    return stats ?? { seen: 0, ignored: 0, used: 0 };
  }

  /**
   * Changes a ticket's status for a reason that isn't a chat message (a person on the dashboard,
   * a pull request). HQ's signal and any linked GitHub issue follow.
   */
  async changeStatus(issueId: string, to: string, by: string): Promise<StatusChangeResult | undefined> {
    const result = await changeStatusFromOutside(this.graph, issueId, to, by, this.world.clock.peek());
    if (result?.changed) {
      await updateSignalStatus(this.world.hq, result.id, to).catch(() => undefined);
      syncGithubIssue(this.graph, result.id, to, `${by}.`).catch((error: Error) => console.warn(`GitHub sync for ${result.id}: ${error.message}`));
    }
    return result;
  }

  /** How GitHub activity reaches this client. */
  channel(): ClientChannel {
    return {
      graph: this.graph,
      changeStatus: (issueId, to, by) => this.changeStatus(issueId, to, by),
      activity: (text, issueId) => this.emit({ kind: "activity", text, issueId, ts: new Date(this.world.clock.peek()).toISOString(), source: "github" }),
      postToGroup: (text) => this.emit({ kind: "bot", text, ts: new Date(this.world.clock.now()).toISOString() }),
    };
  }

  async pipelineOptions(): Promise<PipelineOptions> {
    return {
      graph: this.graph,
      llm: claudeLlm,
      emit: (event) => this.emit(event),
      onIssueCreated: (issue) => void this.recordTicketSignal(issue).catch((error: Error) => console.warn(`Signal for ${issue.issueId}: ${error.message}`)),
      onStatusChange: ({ issueId, to, reason }) => {
        updateSignalStatus(this.world.hq, issueId, to).catch(() => undefined);
        if (to === "merged") return;
        syncGithubIssue(this.graph, issueId, to, reason).catch((error: Error) => console.warn(`GitHub sync for ${issueId}: ${error.message}`));
      },
    };
  }

  /**
   * Leaves an abstract trace of a new ticket in HQ, and says so in this client's feed if the same
   * problem is already known at other clients. Only a count is shown here, never who they are.
   */
  private async recordTicketSignal(issue: { issueId: string; title: string; featureKey: string | null; severity: string; embedding: number[] }): Promise<void> {
    if (!issue.featureKey) return;
    const pattern = await recordSignal(this.world.hq, {
      clientId: this.id,
      issueId: issue.issueId,
      title: issue.title,
      featureKey: issue.featureKey,
      severity: issue.severity,
      status: "open",
      embedding: issue.embedding,
      privateNames: await this.privateNames(),
    });
    if (!pattern) return;
    const others = pattern.clientIds.filter((id) => id !== this.id).length;
    this.emit({
      kind: "activity",
      text: `${others} other ${others === 1 ? "client has" : "clients have"} reported this problem too`,
      issueId: issue.issueId,
      ts: new Date(this.world.clock.peek()).toISOString(),
    });
    this.world.hub.emit({ kind: "activity", text: `Pattern across ${pattern.clientIds.length} clients: ${pattern.title}`, ts: new Date(this.world.clock.peek()).toISOString() });
  }

  /** The client's own name and its contacts' names: none of these may appear in HQ text. */
  async privateNames(): Promise<string[]> {
    const [client] = await run<{ name: string }>(this.graph, P2_CLIENT_SUMMARY);
    const people = await run<{ name: string; role: string }>(this.graph, C12_PEOPLE);
    return [client?.name ?? "", ...people.filter((p) => p.role !== "developer" && p.role !== "support").map((p) => p.name)].filter(Boolean);
  }

  /**
   * When the model provider says no (out of credits, rate limit, bad key), every new message would
   * fail the same way, so the live chat pauses and the error is reported once, in plain words.
   */
  private reportPipelineError(error: Error): void {
    const status = (error as Error & { status?: number }).status;
    const providerRefused = status === 401 || status === 402 || status === 429 || /rate limit|quota|credit|api key/i.test(error.message);
    if (!providerRefused) {
      this.emit({ kind: "run", state: "failed", error: error.message });
      return;
    }
    const wasLive = this.world.pauseLive();
    // Messages still waiting would fail the same way; drop them instead of repeating the error.
    this.inbox.clear();
    const paused = wasLive ? " Live chat is paused." : "";
    const reason =
      error instanceof ProviderLimitError
        ? `Couldn't read new messages. ${error.message}${paused}`
        : `Couldn't read new messages: ${status === 401 ? "the Anthropic key was rejected" : "Anthropic refused the request"}.${paused} Check the key in Settings, or wait a minute and try again.`;
    this.emit({ kind: "run", state: "failed", error: reason });
  }

  /**
   * The live feed is kept in memory, so after a restart it is rebuilt from the graph: every stored
   * message, a line on what Loopkeeper did with it, and the reminders it sent. Small talk was never
   * stored (by design), so it doesn't come back.
   */
  /** Replays the latest stored messages into the live feed (at startup, and after the demo history is restored). */
  async restoreFeed(): Promise<void> {
    const [messages, reminders] = await Promise.all([
      run<RestoredMessage>(this.graph, F1_RECENT_MESSAGES, { limit: FEED_RESTORE_LIMIT }),
      run<{ text: string; sentAt: number }>(this.graph, F2_RECENT_REMINDERS, { limit: FEED_RESTORE_LIMIT }),
    ]);
    const timeline: Array<{ ts: number; events: PipelineEvent[] }> = [
      ...messages.map((m) => ({ ts: m.ts, events: restoredMessageEvents(m) })),
      ...reminders.map((r) => ({ ts: r.sentAt, events: [{ kind: "bot", text: r.text, ts: new Date(r.sentAt).toISOString() } as PipelineEvent] })),
    ].sort((a, b) => a.ts - b.ts);
    for (const entry of timeline) entry.events.forEach((event) => this.emit(event));
    this.emit({ kind: "stats", ...(await this.stats()) });
  }

  private startTimers(): void {
    // Promises can fall due while the group is quiet, so check on the chat's clock.
    this.timers.push(
      setInterval(() => {
        sendDueReminders(this.graph, this.world.clock.peek())
          .then((sent) => sent.forEach((r) => this.emit({ kind: "bot", text: r.text, ts: new Date(this.world.clock.peek()).toISOString() })))
          .catch(() => undefined);
      }, REMINDER_CHECK_MS),
    );
  }

  dispose(): void {
    this.inbox.clear();
    this.importing?.abort();
    this.timers.forEach(clearInterval);
  }
}

interface RestoredMessage {
  id: string;
  groupId: string;
  ts: number;
  senderName: string;
  text: string;
  hasMedia: boolean;
  type: string;
  evidence: Array<{ kind: string; issueId: string; title: string }>;
}

const EVIDENCE_WORDS: Record<string, string> = {
  reported: "Opened",
  confirmed: "Added to",
  more_info: "Added to",
  in_progress: `Marked ${STATUS_WORDS.in_progress}:`,
  resolved: "Marked resolved:",
  reopened: "Reopened",
};

/** A stored message as feed events: the message itself, then what Loopkeeper did with it. */
function restoredMessageEvents(m: RestoredMessage): PipelineEvent[] {
  const ts = toLagosIso(m.ts);
  return [
    {
      kind: "message",
      message: { id: m.id, groupId: m.groupId, ts, senderName: m.senderName, text: m.text, hasMedia: m.hasMedia, relevant: true, type: m.type as MessageType },
    },
    ...m.evidence.map((e): PipelineEvent => ({ kind: "activity", text: `${EVIDENCE_WORDS[e.kind] ?? "Linked to"} "${e.title}"`, issueId: e.issueId, ts })),
  ];
}
