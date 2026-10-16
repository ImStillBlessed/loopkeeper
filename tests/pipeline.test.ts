import type { Graph } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAST, castOf, CLIENTS, type ClientSeed } from "../data/synthetic/cast.js";
import { buildChat, formatExport } from "../data/synthetic/generator.js";
import { TOOLS_BY_NAME } from "../src/agent/tools.js";
import { recordPullRequest, type ClientChannel, type GithubRouter } from "../src/github/activity.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { X7_PATTERNS } from "../src/graph/hq-queries.js";
import {
  C12_PEOPLE,
  OPEN_STATUSES,
  Q0_STATS,
  Q11_BOARD,
  Q15_REMINDERS,
  Q16_DECISIONS,
  Q17_GRAPH_NODES,
  Q18_GRAPH_EDGES,
  Q2_CODE_PATH,
  Q4_DUE_FOLLOWUPS,
  Q8_HISTORY,
  run,
} from "../src/graph/queries.js";
import { groupIdOf, resetGraph, seedClientGraph, seedHq } from "../src/hq/seed.js";
import { recordSignal } from "../src/hq/signals.js";
import type { ChatMessage } from "../src/ingest/types.js";
import { parseWhatsAppExport } from "../src/ingest/whatsapp-export.js";
import { ingestMessages } from "../src/pipeline/runner.js";
import { changeStatusFromOutside } from "../src/pipeline/status.js";
import type { PipelineEvent } from "../src/pipeline/types.js";
import { createFakeLlm } from "./fake-llm.js";

/**
 * The whole tenancy story against a real FalkorDB (fake LLM, no API key): the synthetic chat is split
 * across four clients, each in its own graph; HQ sees only abstract signals; the shared score bug
 * becomes one cross-client pattern; and a merged fix reaches every affected client separately.
 * Uses lk_test_* graphs, so the app's own data is never touched. Needs `npm run db:up`.
 */

const SALT = "test-salt";
const chat = buildChat();
const parsed = parseWhatsAppExport(formatExport(chat, "android"), { groupId: "unrouted", salt: SALT }).messages;
const labels = new Map(parsed.map((m, i) => [m.id, chat[i].label]));
const llm = createFakeLlm(labels);

/** Teachers write in their own client's group; staff reply where the storyline last was. */
function routeToClients(): Map<string, ChatMessage[]> {
  const byClient = new Map<string, ChatMessage[]>(CLIENTS.map((c) => [c.id, []]));
  const lastByScenario = new Map<string, string>();
  parsed.forEach((message, index) => {
    const event = chat[index];
    const sender = CAST.find((m) => m.key === event.sender);
    const scenario = event.label.scenario ?? "noise";
    const clientId = sender?.clientId ?? lastByScenario.get(scenario) ?? "royal_academy";
    if (sender?.clientId) lastByScenario.set(scenario, clientId);
    byClient.get(clientId)!.push({ ...message, groupId: groupIdOf(clientId) });
  });
  return byClient;
}

let hq: Graph;
const graphs = new Map<string, Graph>();
const events: PipelineEvent[] = [];
const boards = new Map<string, BoardRow[]>();
const posted: Array<{ clientId: string; text: string }> = [];

interface BoardRow {
  id: string;
  title: string;
  status: string;
  schools: string[];
  owner: string;
}

const graphOf = (clientId: string) => graphs.get(clientId)!;
const ticket = (clientId: string, pattern: RegExp) => boards.get(clientId)!.find((row) => pattern.test(row.title))!;
const contactNames = CAST.filter((m) => m.clientId).map((m) => m.name);

beforeAll(async () => {
  const db = await getFalkorDB();
  hq = db.selectGraph("lk_test_hq");
  await resetGraph(hq);
  await seedHq(hq, SALT, CLIENTS);

  for (const client of CLIENTS) {
    const graph = db.selectGraph(`lk_test_client_${client.id}`);
    await resetGraph(graph);
    const members = castOf(client.id).map((m) => ({ name: m.name, role: m.role, whatsappLabel: m.whatsappLabel, atClient: Boolean(m.clientId) }));
    await seedClientGraph(hq, graph, client, SALT, members);
    graphs.set(client.id, graph);
  }

  for (const [clientId, messages] of routeToClients()) {
    const client = CLIENTS.find((c) => c.id === clientId) as ClientSeed;
    const signals: Array<Promise<unknown>> = [];
    await ingestMessages(messages, {
      graph: graphOf(clientId),
      llm,
      emit: (e) => events.push(e),
      onIssueCreated: (issue) => {
        if (!issue.featureKey) return;
        const privateNames = [client.name, ...CAST.filter((m) => m.clientId === clientId).map((m) => m.name)];
        signals.push(recordSignal(hq, { clientId, issueId: issue.issueId, title: issue.title, featureKey: issue.featureKey, severity: issue.severity, status: "open", embedding: issue.embedding, privateNames }));
      },
    });
    await Promise.all(signals);
    boards.set(clientId, await run<BoardRow>(graphOf(clientId), Q11_BOARD));
  }
}, 180_000);

afterAll(async () => {
  for (const graph of [hq, ...graphs.values()]) await resetGraph(graph);
  await closeFalkorDB();
});

describe("each client in its own graph", () => {
  it("counts every message, stores only the relevant ones, across all clients", async () => {
    const totals = { seen: 0, ignored: 0, used: 0 };
    for (const graph of graphs.values()) {
      const [stats] = await run<typeof totals>(graph, Q0_STATS);
      totals.seen += stats.seen;
      totals.ignored += stats.ignored;
      totals.used += stats.used;
    }
    const noise = chat.filter((e) => !e.label.relevant).length;
    expect(totals).toEqual({ seen: chat.length, ignored: noise, used: chat.length - noise });
  });

  it("a client's graph holds only its own contacts", async () => {
    for (const client of CLIENTS) {
      const people = await run<{ name: string; school: string | null }>(graphOf(client.id), C12_PEOPLE);
      const others = contactNames.filter((name) => CAST.find((m) => m.name === name)!.clientId !== client.id);
      expect(people.map((p) => p.name).filter((name) => others.includes(name)), client.id).toEqual([]);
      expect(new Set(people.map((p) => p.school).filter(Boolean)), client.id).toEqual(new Set([client.name]));
    }
  });

  it("walks ticket → feature → code → owner inside the client's graph", async () => {
    const [path] = await run<{ feature: string; files: string[]; codeOwners: string[] }>(graphOf("royal_academy"), Q2_CODE_PATH, { issueId: ticket("royal_academy", /score/i).id });
    expect(path.feature).toBe("Score submission");
    expect(path.files).toContain("lib/scores/submit.ts");
    expect(path.codeOwners).toEqual(["Blessed Oigbochie"]);
  });
});

describe("cross-client patterns without information bleed", () => {
  it("the score bug at three schools becomes one pattern in HQ", async () => {
    const patterns = await run<{ title: string; signals: Array<{ clientId: string }> }>(hq, X7_PATTERNS);
    const scores = patterns.find((p) => /score/i.test(p.title));
    expect(scores).toBeDefined();
    expect(new Set(scores!.signals.map((s) => s.clientId))).toEqual(new Set(["royal_academy", "bright_future", "unity_model"]));
  });

  it("HQ never holds a contact's name or any message text", async () => {
    const rows = await run<{ props: Record<string, unknown> }>(hq, {
      id: "test",
      title: "every HQ property except the client registry and staff",
      cypher: "MATCH (n) WHERE NOT n:Client AND NOT n:Staff AND NOT n:Person RETURN properties(n) AS props",
    });
    const text = rows.flatMap((r) => Object.values(r.props).filter((v): v is string => typeof v === "string")).join("\n");
    const surnames = contactNames.map((name) => name.split(" ").at(-1)!);
    for (const name of [...contactNames, ...surnames]) expect(text, name).not.toContain(name);
    for (const message of chat.filter((e) => e.label.relevant && e.text.length > 25)) expect(text).not.toContain(message.text);
  });

  it("inside one client, the agent learns only how many others share the problem", async () => {
    const tool = TOOLS_BY_NAME.get("same_problem_elsewhere")!;
    const result = await tool.execute({ issueId: ticket("royal_academy", /score/i).id }, { graph: graphOf("royal_academy"), llm, now: Date.now(), repos: [], hq, clientId: "royal_academy" });
    expect(result.data).toMatchObject({ otherClients: 2 });
    const serialised = JSON.stringify(result.data);
    for (const other of CLIENTS.filter((c) => c.id !== "royal_academy")) expect(serialised).not.toContain(other.name);
    for (const name of contactNames) expect(serialised).not.toContain(name);
  });

  it("a merged fix reaches each affected client where it runs, each told only about its own ticket", async () => {
    const notes: Array<{ clientId: string; text: string }> = [];
    const channel = (clientId: string): ClientChannel => ({
      graph: graphOf(clientId),
      changeStatus: (issueId, to, by) => changeStatusFromOutside(graphOf(clientId), issueId, to, by),
      activity: (text) => notes.push({ clientId, text }),
      postToGroup: (text) => posted.push({ clientId, text }),
    });
    const router: GithubRouter = { hq, client: channel, activity: () => undefined };
    const scoreTicket = (clientId: string) => ticket(clientId, /score/i).id;
    const merge = (number: number, repo: string, base: string, clientId: string) =>
      recordPullRequest(router, repo, {
        number,
        title: "Retry score submit for big classes",
        body: `Fixes ${scoreTicket(clientId)}`,
        html_url: `https://github.com/${repo}/pull/${number}`,
        state: "closed",
        merged_at: "2026-10-16T11:00:00Z",
        created_at: "2026-10-16T09:00:00Z",
        updated_at: "2026-10-16T11:00:00Z",
        user: { login: "tunde-dev" },
        base: { ref: base, repo: { default_branch: "main" } },
      });
    const status = async (clientId: string) => (await run<BoardRow>(graphOf(clientId), Q11_BOARD)).filter((r) => /score/i.test(r.title))[0].status;

    // Royal Academy has its own repo: a merge there ships to Royal only.
    await merge(21, "ednovax/sms-royal-academy", "main", "royal_academy");
    expect(await status("royal_academy")).toBe("possibly_resolved");
    expect(await status("bright_future")).toBe("open");
    expect(notes.some((n) => n.clientId === "bright_future" && n.text.includes("doesn't run"))).toBe(true);

    // The shared SMS v1 repo: on main nobody is told yet; on each school's branch, that school is.
    await merge(22, "ednovax/sms-v1", "main", "bright_future");
    expect(await status("bright_future")).toBe("open");
    await merge(23, "ednovax/sms-v1", "bright-future", "bright_future");
    await merge(24, "ednovax/sms-v1", "unity-model", "unity_model");

    for (const clientId of ["royal_academy", "bright_future", "unity_model"]) {
      expect(await status(clientId), clientId).toBe("possibly_resolved");
      const message = posted.find((p) => p.clientId === clientId)!;
      expect(message.text).toContain("Good news");
      for (const other of CLIENTS.filter((c) => c.id !== clientId)) expect(message.text).not.toContain(other.name);
    }
  });
});

describe("the planted scenarios still hold, per client", () => {
  it("S2: the timer ticket closes on the teacher's message", async () => {
    const timer = ticket("bright_future", /timer/i);
    expect(timer.status).toBe("resolved");
    const history = await run<{ to: string; by: string }>(graphOf("bright_future"), Q8_HISTORY, { issueId: timer.id });
    expect(history.at(-1)).toMatchObject({ to: "resolved", by: "Mrs Funke Adeyemi" });
  });

  it("S7: an ambiguous 'it's working' only marks tickets possibly resolved", () => {
    expect(ticket("unity_model", /average/i).status).toBe("possibly_resolved");
  });

  it("S3: the unkept promise goes overdue and the bot reminds", async () => {
    const followUps = await run<{ text: string; status: string; owner: string }>(graphOf("royal_academy"), Q4_DUE_FOLLOWUPS, { until: Number.MAX_SAFE_INTEGER });
    expect(followUps.find((f) => /student list/i.test(f.text))).toMatchObject({ status: "overdue", owner: "Mr Osaro Igbinedion" });
    const reminders = await run<{ followUp: string }>(graphOf("royal_academy"), Q15_REMINDERS);
    expect(reminders.some((r) => /student list/i.test(r.followUp))).toBe(true);
  });

  it("S4: the decision is recorded in the client that made it", async () => {
    const decisions = await run<{ by: string }>(graphOf("unity_model"), Q16_DECISIONS);
    expect(decisions).toEqual([expect.objectContaining({ by: "Mrs Grace Danjuma" })]);
  });

  it("serves each client's graph view", async () => {
    const nodes = await run<{ id: string }>(graphOf("royal_academy"), Q17_GRAPH_NODES);
    const links = await run<{ source: string; target: string }>(graphOf("royal_academy"), Q18_GRAPH_EDGES);
    const ids = new Set(nodes.map((n) => n.id));
    expect(links.every((l) => ids.has(l.source) && ids.has(l.target))).toBe(true);
  });
});

describe("agent tools on a client graph", () => {
  const call = (name: string, args: Record<string, unknown>) =>
    TOOLS_BY_NAME.get(name)!.execute(args, { graph: graphOf("royal_academy"), llm, now: Date.parse("2026-10-11T20:00:00+01:00"), repos: [], hq, clientId: "royal_academy" });

  it("list_issues returns this client's open tickets with sources, and accepts null filters", async () => {
    const result = await call("list_issues", { school: null, person: null, feature: null });
    const rows = result.data as Array<{ title: string; status: string; sourceMessages: string[] }>;
    expect(rows.map((r) => r.title)).toContain("Scores not saving after exam");
    expect(rows.every((r) => OPEN_STATUSES.includes(r.status) && r.sourceMessages.length > 0)).toBe(true);
  });

  it("the other tools answer", async () => {
    const scoresId = ticket("royal_academy", /score/i).id;
    for (const [name, args] of [
      ["get_issue_context", { issueId: scoresId }],
      ["impact_of", { issueId: scoresId }],
      ["who_knows", { featureKey: "score_submission" }],
      ["priority_ranking", {}],
      ["list_decisions", {}],
      ["due_followups", { withinHours: 48 }],
      ["search_issues", { query: "marks not saving" }],
    ] as const) {
      const result = await call(name, args);
      expect(result.queries.length, name).toBeGreaterThan(0);
    }
  });
});
