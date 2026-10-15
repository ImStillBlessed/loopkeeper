import type { Graph } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildChat, formatExport } from "../data/synthetic/generator.js";
import { TOOLS_BY_NAME } from "../src/agent/tools.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import {
  OPEN_STATUSES,
  Q0_STATS,
  Q11_BOARD,
  Q15_REMINDERS,
  Q16_DECISIONS,
  Q17_GRAPH_NODES,
  Q18_GRAPH_EDGES,
  Q2_CODE_PATH,
  Q4_DUE_FOLLOWUPS,
  Q6_DUPLICATE_CLUSTERS,
  Q8_HISTORY,
  run,
} from "../src/graph/queries.js";
import { DEMO_GROUP_ID, resetGraph, seedWorld } from "../src/graph/seed.js";
import { parseWhatsAppExport } from "../src/ingest/whatsapp-export.js";
import { ingestMessages } from "../src/pipeline/runner.js";
import type { PipelineEvent } from "../src/pipeline/types.js";
import { createFakeLlm } from "./fake-llm.js";

/**
 * Replays the whole synthetic chat through the real pipeline and a real FalkorDB (fake LLM),
 * then checks the graph against the planted scenarios. Needs `npm run db:up`.
 */

const SALT = "test-salt";
const chat = buildChat();
const { messages } = parseWhatsAppExport(formatExport(chat, "android"), { groupId: DEMO_GROUP_ID, salt: SALT });
const labels = new Map(messages.map((m, i) => [m.id, chat[i].label]));
const llm = createFakeLlm(labels);

interface BoardRow {
  id: string;
  title: string;
  status: string;
  schools: string[];
  merged: number;
  owner: string | null;
}

let graph: Graph;
const events: PipelineEvent[] = [];
let board: BoardRow[];
const issue = (pattern: RegExp) => board.find((row) => pattern.test(row.title))!;

beforeAll(async () => {
  graph = (await getFalkorDB()).selectGraph("lk_test_pipeline");
  await resetGraph(graph);
  await seedWorld(graph, SALT, "test");
  await ingestMessages(messages, { graph, llm, emit: (e) => events.push(e) });
  board = await run<BoardRow>(graph, Q11_BOARD);
}, 120_000);

afterAll(async () => {
  await resetGraph(graph);
  await closeFalkorDB();
});

describe("pipeline on the synthetic chat", () => {
  it("counts every message but only stores the relevant ones", async () => {
    const [stats] = await run<{ seen: number; ignored: number; used: number }>(graph, Q0_STATS);
    const noise = chat.filter((e) => !e.label.relevant).length;
    expect(stats).toMatchObject({ seen: chat.length, ignored: noise, used: chat.length - noise });
  });

  it("S1: merges three schools' score reports into one issue, assigned to the code owner", async () => {
    const scores = board.filter((row) => /score/i.test(row.title));
    expect(scores).toHaveLength(1);
    expect(scores[0].merged).toBe(1);
    expect(scores[0].schools.sort()).toEqual(["Bright Future College", "Royal Academy", "Unity Model School"]);
    expect(scores[0].owner).toBe("Tunde Bakare");

    const clusters = await run(graph, Q6_DUPLICATE_CLUSTERS);
    expect(clusters).toHaveLength(1);
  });

  it("S1: walks issue → feature → code → owner", async () => {
    const [path] = await run<{ feature: string; files: string[]; codeOwners: string[] }>(graph, Q2_CODE_PATH, { issueId: issue(/score/i).id });
    expect(path.feature).toBe("Score submission");
    expect(path.files).toContain("lib/scores/submit.ts");
    expect(path.codeOwners).toEqual(["Tunde Bakare"]);
  });

  it("S2: closes the timer issue and records the teacher's message as the reason", async () => {
    const timer = issue(/timer/i);
    expect(timer.status).toBe("resolved");
    const history = await run<{ to: string; by: string; because: string }>(graph, Q8_HISTORY, { issueId: timer.id });
    expect(history.at(-1)).toMatchObject({ to: "resolved", by: "Mrs Funke Adeyemi" });
    expect(history.at(-1)!.because).toContain("It's working now");
  });

  it("S7: an ambiguous 'it's working' only marks issues possibly resolved", () => {
    expect(issue(/average/i).status).toBe("possibly_resolved");
    expect(issue(/score/i).status).toBe("possibly_resolved");
  });

  it("S3: the unkept promise goes overdue and the bot reminds once", async () => {
    const followUps = await run<{ text: string; status: string; owner: string }>(graph, Q4_DUE_FOLLOWUPS, { until: Number.MAX_SAFE_INTEGER });
    expect(followUps.find((f) => /student list/i.test(f.text))).toMatchObject({ status: "overdue", owner: "Mr Osaro Igbinedion" });

    const reminders = await run<{ kind: string; followUp: string }>(graph, Q15_REMINDERS);
    const forList = reminders.filter((r) => /student list/i.test(r.followUp));
    expect(forList.map((r) => r.kind).sort()).toEqual(["due_soon", "overdue"]);
    expect(events.some((e) => e.kind === "bot" && /Osaro/.test(e.text))).toBe(true);
  });

  it("S4: records the decision with its source message", async () => {
    const decisions = await run<{ text: string; by: string; feature: string }>(graph, Q16_DECISIONS);
    expect(decisions).toEqual([expect.objectContaining({ by: "Mrs Grace Danjuma", feature: "CBT tests" })]);
  });

  it("serves the graph view", async () => {
    const nodes = await run<{ id: string }>(graph, Q17_GRAPH_NODES);
    const links = await run<{ source: string; target: string }>(graph, Q18_GRAPH_EDGES);
    const ids = new Set(nodes.map((n) => n.id));
    expect(nodes.length).toBeGreaterThan(50);
    expect(links.every((l) => ids.has(l.source) && ids.has(l.target))).toBe(true);
  });
});

describe("agent tools run against the graph", () => {
  const ctx = () => ({ graph, llm, now: Date.parse("2026-10-11T20:00:00+01:00"), repos: [] });
  const call = (name: string, args: Record<string, unknown>) => TOOLS_BY_NAME.get(name)!.execute(args, ctx());

  it("list_open_items filters by school and returns sources", async () => {
    const result = await call("list_open_items", { school: "royal" });
    const rows = result.data as Array<{ title: string; sourceMessages: string[] }>;
    expect(rows.map((r) => r.title)).toContain("Scores not saving after exam");
    expect(rows.every((r) => r.sourceMessages.length > 0)).toBe(true);
    expect(result.nodeIds.length).toBeGreaterThan(0);
  });

  it("get_issue_context, impact_of, who_knows, priority, decisions, follow-ups and search all answer", async () => {
    const scoresId = issue(/score/i).id;
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

    const impact = (await call("impact_of", { issueId: scoresId })).data as { schools: Array<{ school: string; hasReported: boolean }>; dependentCode: Array<{ file: string }> };
    expect(impact.schools).toHaveLength(3);
    expect(impact.dependentCode.map((d) => d.file)).toContain("lib/results/averages.ts");
  });

  it("explain_link finds the path from a teacher to a developer", async () => {
    const result = await call("explain_link", { from: "Mallam Ibrahim Musa", to: "Tunde Bakare" });
    const path = result.data as { hops: string[] };
    expect(path.hops[0]).toBe("Mallam Ibrahim Musa");
    expect(path.hops.at(-1)).toBe("Tunde Bakare");
  });

  it("priority ranking only lists open issues", async () => {
    const rows = (await call("priority_ranking", {})).data as Array<{ id: string }>;
    const openIds = new Set(board.filter((b) => OPEN_STATUSES.includes(b.status)).map((b) => b.id));
    expect(rows.every((r) => openIds.has(r.id))).toBe(true);
  });
});
