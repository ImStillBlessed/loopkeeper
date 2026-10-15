import type { Graph } from "falkordb";
import type OpenAI from "openai";
import {
  OPEN_STATUSES,
  Q12_EVIDENCE,
  Q13_ISSUE,
  Q16_DECISIONS,
  Q1_OPEN_ITEMS,
  Q2_CODE_PATH,
  Q3B_DEPENDENT_CODE,
  Q3_IMPACT,
  Q4_DUE_FOLLOWUPS,
  Q5_WHO_KNOWS,
  Q7_PRIORITY,
  Q8_HISTORY,
  Q9_EXPLAIN_LINK,
  Q10_SEARCH_ISSUES,
  GH9_CODE_ACTIVITY,
  run,
  type NamedQuery,
} from "../graph/queries.js";
import { openGithubIssue } from "../github/issues.js";
import type { Llm } from "../llm/llm.js";
import { formatLagos, HOUR } from "../pipeline/time.js";

/** What every tool hands back: the data for the model, plus what the UI needs to show its work. */
export interface ToolResult {
  data: unknown;
  /** Graph node ids touched, so the graph view can highlight the path. */
  nodeIds: string[];
  queries: NamedQuery[];
}

export interface ToolContext {
  graph: Graph;
  llm: Llm;
  /** The chat's "now" (latest message time). */
  now: number;
  /** GitHub repositories connected to this project (owner/name). Empty when GitHub isn't set up. */
  repos: string[];
}

type Args = Record<string, unknown>;

interface Tool {
  definition: OpenAI.Chat.Completions.ChatCompletionFunctionTool;
  execute(args: Args, ctx: ToolContext): Promise<ToolResult>;
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const ids = (...lists: unknown[][]) => lists.flat().filter((x): x is string => typeof x === "string" && x !== "");

function tool(name: string, description: string, properties: Record<string, object>, required: string[], execute: Tool["execute"]): Tool {
  return {
    definition: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties: allowNullWhenOptional(properties, required), required, additionalProperties: false } },
    },
    execute,
  };
}

/**
 * Some models fill optional parameters with null instead of leaving them out, and Groq rejects a
 * tool call that doesn't match the schema. Optional parameters therefore accept null too
 * (the tools already treat null as "not given").
 */
function allowNullWhenOptional(properties: Record<string, object>, required: string[]): Record<string, object> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => {
      const type = (schema as { type?: string }).type;
      if (required.includes(key) || !type) return [key, schema];
      const { enum: allowed, ...rest } = schema as { enum?: unknown[] };
      return [key, { ...rest, type: [type, "null"], ...(allowed ? { enum: [...allowed, null] } : {}) }];
    }),
  );
}

const FEATURE_KEY = { type: "string", description: "Product feature key, from the list in your instructions" };
const ISSUE_ID = { type: "string", description: "Issue id, starts with iss_" };

export const TOOLS: Tool[] = [
  tool(
    "list_issues",
    "List issues with their status, reporters, schools, owner and source message ids. By default only open ones (open, in progress, possibly resolved); use status 'resolved' or 'all' for the rest. Filter by school name, person name and/or feature.",
    {
      status: { type: "string", enum: ["open", "resolved", "all"], description: "Which issues: open (default), resolved, or all" },
      school: { type: "string" },
      person: { type: "string" },
      feature: FEATURE_KEY,
    },
    [],
    async (args, { graph }) => {
      const status = str(args.status) ?? "open";
      const statuses = status === "resolved" ? ["resolved"] : status === "all" ? [...OPEN_STATUSES, "resolved"] : OPEN_STATUSES;
      const rows = await run<{ id: string; ownerId: string | null; sourceMessages: string[] }>(graph, Q1_OPEN_ITEMS, {
        openStatuses: statuses,
        school: str(args.school),
        person: str(args.person),
        feature: str(args.feature),
      });
      return {
        data: rows.map(({ ownerId, ...row }) => row),
        nodeIds: ids(rows.map((r) => r.id), rows.map((r) => r.ownerId), rows.flatMap((r) => r.sourceMessages)),
        queries: [Q1_OPEN_ITEMS],
      };
    },
  ),

  tool(
    "get_issue_context",
    "Everything about one issue: summary, the messages behind it, feature, code files, owner, status history and merged duplicates.",
    { issueId: ISSUE_ID },
    ["issueId"],
    async (args, { graph }) => {
      const issueId = String(args.issueId);
      const [issue] = await run(graph, Q13_ISSUE, { issueId });
      const evidence = await run<{ id: string; ts: number }>(graph, Q12_EVIDENCE, { issueId });
      const [code] = await run<{ featureKey: string | null; files: string[] }>(graph, Q2_CODE_PATH, { issueId });
      const history = await run<{ messageId: string | null; at: number }>(graph, Q8_HISTORY, { issueId });
      return {
        data: {
          issue,
          messages: evidence.map((m) => ({ ...m, ts: formatLagos(m.ts) })),
          code,
          history: history.map((h) => ({ ...h, at: formatLagos(h.at) })),
        },
        nodeIds: ids([issueId, code?.featureKey], code?.files ?? [], evidence.map((m) => m.id)),
        queries: [Q13_ISSUE, Q12_EVIDENCE, Q2_CODE_PATH, Q8_HISTORY],
      };
    },
  ),

  tool(
    "search_issues",
    "Semantic search over all issues (open and resolved) by meaning, e.g. 'timer problems on phones'.",
    { query: { type: "string" } },
    ["query"],
    async (args, { graph, llm }) => {
      const [embedding] = await llm.embed([String(args.query)]);
      const rows = await run<{ id: string; distance: number }>(graph, Q10_SEARCH_ISSUES, { embedding });
      const relevant = rows.filter((r) => r.distance < 0.7);
      return { data: relevant, nodeIds: relevant.map((r) => r.id), queries: [Q10_SEARCH_ISSUES] };
    },
  ),

  tool(
    "due_followups",
    "Promises (follow-ups) that are overdue or due within the next N hours, with owner and source message.",
    { withinHours: { type: "number", description: "Look-ahead window in hours, e.g. 48" } },
    [],
    async (args, { graph, now }) => {
      const hours = typeof args.withinHours === "number" ? args.withinHours : 48;
      const rows = await run<{ id: string; dueAt: number; ownerId: string; issueId: string | null; sourceMessage: string | null }>(
        graph,
        Q4_DUE_FOLLOWUPS,
        { until: now + hours * HOUR },
      );
      return {
        data: rows.map(({ ownerId, ...row }) => ({ ...row, dueAt: formatLagos(row.dueAt), overdue: row.dueAt < now })),
        nodeIds: ids(rows.map((r) => r.id), rows.map((r) => r.ownerId), rows.map((r) => r.issueId), rows.map((r) => r.sourceMessage)),
        queries: [Q4_DUE_FOLLOWUPS],
      };
    },
  ),

  tool(
    "who_knows",
    "Who knows a product feature best: code owners and people who fixed issues in it.",
    { featureKey: FEATURE_KEY },
    ["featureKey"],
    async (args, { graph }) => {
      const rows = await run<{ id: string; files: string[] }>(graph, Q5_WHO_KNOWS, { featureKey: String(args.featureKey) });
      return {
        data: rows.map(({ id, ...row }) => row),
        nodeIds: ids([String(args.featureKey)], rows.map((r) => r.id), rows.flatMap((r) => r.files)),
        queries: [Q5_WHO_KNOWS],
      };
    },
  ),

  tool(
    "impact_of",
    "Impact of an issue: which schools use the affected feature (and which have reported it), and which other code depends on it.",
    { issueId: ISSUE_ID },
    ["issueId"],
    async (args, { graph }) => {
      const issueId = String(args.issueId);
      const schools = await run<{ schoolId: string }>(graph, Q3_IMPACT, { issueId });
      const dependents = await run<{ file: string }>(graph, Q3B_DEPENDENT_CODE, { issueId });
      return {
        data: { schools: schools.map(({ schoolId, ...s }) => s), dependentCode: dependents },
        nodeIds: ids([issueId], schools.map((s) => s.schoolId), dependents.map((d) => d.file)),
        queries: [Q3_IMPACT, Q3B_DEPENDENT_CODE],
      };
    },
  ),

  tool(
    "priority_ranking",
    "Open issues ranked by PageRank over the graph: issues with more evidence and connections rank higher.",
    {},
    [],
    async (_args, { graph }) => {
      const rows = await run<{ id: string }>(graph, Q7_PRIORITY, { openStatuses: OPEN_STATUSES });
      return { data: rows, nodeIds: rows.map((r) => r.id), queries: [Q7_PRIORITY] };
    },
  ),

  tool(
    "explain_link",
    "Shortest path between two things in the graph (by id, name or feature key), e.g. a teacher and a developer.",
    { from: { type: "string" }, to: { type: "string" } },
    ["from", "to"],
    async (args, { graph }) => {
      const [path] = await run<{ nodeIds: string[]; hops: string[]; relations: string[] }>(graph, Q9_EXPLAIN_LINK, {
        from: String(args.from),
        to: String(args.to),
      });
      return { data: path ?? "No connection found", nodeIds: path?.nodeIds ?? [], queries: [Q9_EXPLAIN_LINK] };
    },
  ),

  tool(
    "list_decisions",
    "Decisions agreed in the group, with who made them and the source message.",
    {},
    [],
    async (_args, { graph }) => {
      const rows = await run<{ id: string; messageId: string; ts: number }>(graph, Q16_DECISIONS);
      return {
        data: rows.map((r) => ({ ...r, ts: formatLagos(r.ts) })),
        nodeIds: ids(rows.map((r) => r.id), rows.map((r) => r.messageId)),
        queries: [Q16_DECISIONS],
      };
    },
  ),
];

/** Tools that touch GitHub. Reading code activity is safe; opening an issue writes to GitHub (never to code). */
TOOLS.push(
  tool(
    "code_activity",
    "Pull requests and commits linked to an issue, and its GitHub issue if one exists.",
    { issueId: ISSUE_ID },
    ["issueId"],
    async (args, { graph }) => {
      const issueId = String(args.issueId);
      const [row] = await run<{ pullRequests: unknown[]; commits: unknown[] }>(graph, GH9_CODE_ACTIVITY, { issueId });
      return { data: row ?? "No code activity", nodeIds: [issueId], queries: [GH9_CODE_ACTIVITY] };
    },
  ),
  tool(
    "open_github_issue",
    "Open a GitHub issue for a Loopkeeper issue, with the teachers' messages, files and owner from the graph. Only when the user asks for it.",
    { issueId: ISSUE_ID, repo: { type: "string", description: "owner/name; defaults to the first connected repository" } },
    ["issueId"],
    async (args, { graph, repos }) => {
      const repo = str(args.repo) ?? repos[0];
      if (!repo) return { data: "No GitHub repository is connected to this project.", nodeIds: [], queries: [] };
      const created = await openGithubIssue(graph, repo, String(args.issueId));
      return { data: { opened: true, ...created }, nodeIds: [String(args.issueId)], queries: [] };
    },
  ),
);

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.definition.function.name, t]));
