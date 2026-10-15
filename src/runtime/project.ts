import type { Graph } from "falkordb";
import { config } from "../config.js";
import { githubConfigured } from "../github/api.js";
import { syncRepositories, type ActivitySink } from "../github/activity.js";
import { syncGithubIssue } from "../github/issues.js";
import { getProjectGraph } from "../graph/client.js";
import { P2_PROJECT_SUMMARY, P6_REPOS, Q0_STATS, R1_RESET_CHAT, run } from "../graph/queries.js";
import { makeLiveMessage } from "../ingest/live.js";
import { parseWhatsAppExport } from "../ingest/whatsapp-export.js";
import { groqLlm } from "../llm/llm.js";
import { sendDueReminders } from "../pipeline/reminders.js";
import { ingestMessages, type PipelineOptions } from "../pipeline/runner.js";
import { ChatClock } from "./clock.js";
import { EventHub } from "./hub.js";
import { Inbox } from "./inbox.js";
import { Simulator } from "./simulator.js";

const REMINDER_CHECK_MS = 20_000;

/**
 * Everything live about one project: its event stream, chat clock, inbox for incoming messages,
 * the simulated WhatsApp group, the reminder check, and GitHub polling.
 */
export class ProjectRuntime {
  readonly hub = new EventHub();
  readonly clock: ChatClock;
  readonly inbox: Inbox;
  readonly simulator: Simulator;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private importing: AbortController | undefined;
  lastGithubError: string | undefined;

  private constructor(
    readonly id: string,
    readonly graph: Graph,
    clockStart: number,
  ) {
    this.clock = new ChatClock(clockStart);
    this.inbox = new Inbox(
      async () => this.pipelineOptions(),
      (error) => this.hub.emit({ kind: "run", state: "failed", error: error.message }),
    );
    this.simulator = new Simulator(
      this.clock,
      (m) => this.receive(m.groupId, m.senderLabel, m.text, { ts: m.ts, hasMedia: m.hasMedia }),
      () => this.emitLive(),
    );
  }

  static async load(id: string): Promise<ProjectRuntime> {
    const graph = await getProjectGraph(id);
    const [summary] = await run<{ clock: number }>(graph, P2_PROJECT_SUMMARY);
    const runtime = new ProjectRuntime(id, graph, summary?.clock ?? 0);
    runtime.startTimers();
    return runtime;
  }

  /** A message arrives from a WhatsApp group (simulated, typed in the CLI, or a real webhook). */
  receive(groupId: string, senderLabel: string, text: string, options: { ts?: number; hasMedia?: boolean } = {}): void {
    const ts = options.ts ?? this.clock.now();
    this.inbox.push(makeLiveMessage({ groupId, senderLabel, text, ts, hasMedia: options.hasMedia, salt: config.idHashSalt }));
  }

  /** Imports a WhatsApp export into a group, in the background. */
  importExport(groupId: string, text: string): number {
    const { messages } = parseWhatsAppExport(text, { groupId, salt: config.idHashSalt, utcOffset: config.chatUtcOffset });
    this.importing?.abort();
    const controller = new AbortController();
    this.importing = controller;
    this.hub.emit({ kind: "run", state: "started" });
    void this.pipelineOptions()
      .then((options) => ingestMessages(messages, { ...options, signal: controller.signal }))
      .then(() => this.hub.emit({ kind: "run", state: controller.signal.aborted ? "stopped" : "finished" }))
      .catch((error: Error) => this.hub.emit({ kind: "run", state: "failed", error: error.message }));
    return messages.length;
  }

  /** Clears everything learned from chats and GitHub; keeps the project, its groups, repos, people and code. */
  async reset(): Promise<void> {
    this.simulator.rewind();
    this.inbox.clear();
    this.importing?.abort();
    await run(this.graph, R1_RESET_CHAT);
    this.hub.clear();
    this.hub.emit({ kind: "stats", seen: 0, ignored: 0, used: 0 });
    this.emitLive();
  }

  async stats() {
    const [stats] = await run<{ seen: number; ignored: number; used: number }>(this.graph, Q0_STATS);
    return { ...(stats ?? { seen: 0, ignored: 0, used: 0 }), clock: this.clock.peek(), live: this.simulator.running, liveGroupId: this.simulator.groupId ?? null };
  }

  emitLive(): void {
    this.hub.emit({ kind: "live", running: this.simulator.running, clock: this.clock.peek(), groupId: this.simulator.groupId });
  }

  /** Lets the dashboard and CLI see what Loopkeeper says back in the group, and what changed. */
  get sink(): ActivitySink {
    return {
      activity: (text, issueId) => this.hub.emit({ kind: "activity", text, issueId, ts: new Date(this.clock.peek()).toISOString(), source: "github" }),
      postToGroup: (text) => this.hub.emit({ kind: "bot", text, ts: new Date(this.clock.now()).toISOString() }),
    };
  }

  async syncGithub(): Promise<void> {
    try {
      await syncRepositories(this.graph, this.sink);
      this.lastGithubError = undefined;
    } catch (error) {
      this.lastGithubError = (error as Error).message;
      throw error;
    }
  }

  async pipelineOptions(): Promise<PipelineOptions> {
    return {
      graph: this.graph,
      llm: groqLlm,
      emit: (event) => this.hub.emit(event),
      onStatusChange: ({ issueId, to, reason }) => {
        syncGithubIssue(this.graph, issueId, to, reason).catch((error: Error) => console.warn(`GitHub sync for ${issueId}: ${error.message}`));
      },
    };
  }

  private startTimers(): void {
    // Promises can fall due while the group is quiet, so check on the chat's clock.
    this.timers.push(
      setInterval(() => {
        sendDueReminders(this.graph, this.clock.peek())
          .then((sent) => sent.forEach((r) => this.hub.emit({ kind: "bot", text: r.text, ts: new Date(this.clock.peek()).toISOString() })))
          .catch(() => undefined);
      }, REMINDER_CHECK_MS),
    );

    // Picks up pull requests and pushes. Checks for a token each time, so one saved in Settings starts it.
    this.timers.push(
      setInterval(async () => {
        if (!githubConfigured()) return;
        const repos = await run(this.graph, P6_REPOS).catch(() => []);
        if (repos.length) await this.syncGithub().catch((error: Error) => console.warn(`GitHub poll (${this.id}): ${error.message}`));
      }, config.github.pollSeconds * 1000),
    );
  }

  dispose(): void {
    this.simulator.stop();
    this.timers.forEach(clearInterval);
  }
}

const runtimes = new Map<string, Promise<ProjectRuntime>>();

/** Stops a project's live parts (before deleting it). */
export async function dropRuntime(projectId: string): Promise<void> {
  const runtime = runtimes.get(projectId);
  runtimes.delete(projectId);
  (await runtime)?.dispose();
}

export function getRuntime(projectId: string): Promise<ProjectRuntime> {
  let runtime = runtimes.get(projectId);
  if (!runtime) {
    runtime = ProjectRuntime.load(projectId);
    runtimes.set(projectId, runtime);
  }
  return runtime;
}
