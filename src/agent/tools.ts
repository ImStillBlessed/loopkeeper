import type { Graph } from "falkordb";
import type Anthropic from "@anthropic-ai/sdk";
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
  Q20_SEARCH_MESSAGES,
  GH9_CODE_ACTIVITY,
  run,
  type NamedQuery,
  C14_CODE_NEAR,
  Q21_LIKELY_CODE,
} from "../graph/queries.js";
import { readSource } from "../github/api.js";
import { openGithubIssue } from "../github/issues.js";
import { X8_PATTERN_FOR_TICKET } from "../graph/hq-queries.js";
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
  /** GitHub repositories of this client's products (owner/name). Empty when GitHub isn't set up. */
  repos: string[];
  /** HQ graph and this client's id, for the cross-client view (counts only). */
  hq?: Graph;
  clientId?: string;
  /** Stores something the person said into this client's graph (through its normal pipeline, as their message). */
  remember?: (text: string) => Promise<void>;
  /** Whether this person may have the agent open GitHub issues. */
  mayWriteGithub?: boolean;
}

type Args = Record<string, unknown>;

interface Tool {
  definition: Anthropic.Tool;
  execute(args: Args, ctx: ToolContext): Promise<ToolResult>;
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const ids = (...lists: unknown[][]) => lists.flat().filter((x): x is string => typeof x === "string" && x !== "");

function tool(name: string, description: string, properties: Record<string, object>, required: string[], execute: Tool["execute"]): Tool {
  return {
    definition: { name, description, input_schema: { type: "object", properties: allowNullWhenOptional(properties, required), required } },
    execute,
  };
}

/**
 * Models sometimes fill optional parameters with null instead of leaving them out. Optional
 * parameters therefore accept null too (the tools already treat null as "not given").
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
      const likelyCode = await run(graph, Q21_LIKELY_CODE, { issueId });
      return {
        data: {
          issue,
          messages: evidence.map((m) => ({ ...m, ts: formatLagos(m.ts) })),
          code,
          likelyCode,
          history: history.map((h) => ({ ...h, at: formatLagos(h.at) })),
        },
        nodeIds: ids([issueId, code?.featureKey], code?.files ?? [], evidence.map((m) => m.id)),
        queries: [Q13_ISSUE, Q12_EVIDENCE, Q2_CODE_PATH, Q21_LIKELY_CODE, Q8_HISTORY],
      };
    },
  ),

  tool(
    "remember",
    "Store information the person just told you that the graph should keep: a new problem, a promise, a decision, or a useful fact (a contact, a setup, an agreement). Write it as one plain statement in their words, naming who and what. Don't store questions, your own answers, or things already in the graph.",
    { text: { type: "string", description: "The information, as one plain statement" } },
    ["text"],
    async (args, { remember }) => {
      const text = str(args.text);
      if (!text || !remember) return { data: "Nothing stored", nodeIds: [], queries: [] };
      await remember(text);
      return { data: `Stored: ${text}. It becomes a ticket, promise or decision if it is one, and can be found from now on.`, nodeIds: [], queries: [] };
    },
  ),

  tool(
    "search_messages",
    "Semantic search over everything said in this client's groups and everything the team noted from Ask (place 'Ask notes'). Use it for facts that aren't tickets: contacts, setups, agreements, background.",
    { query: { type: "string" } },
    ["query"],
    async (args, { graph, llm, now }) => {
      const [embedding] = await llm.embed([String(args.query)]);
      const rows = await run<{ id: string; text: string; ts: number; sender: string; place: string; distance: number }>(graph, Q20_SEARCH_MESSAGES, { embedding });
      const relevant = rows.filter((r) => r.distance < 0.75).map((r) => ({ ...r, when: formatLagos(r.ts), daysAgo: Math.floor((now - r.ts) / (24 * HOUR)) }));
      return { data: relevant, nodeIds: relevant.map((r) => r.id), queries: [Q20_SEARCH_MESSAGES] };
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
    "same_problem_elsewhere",
    "Whether other Ednovax clients have reported the same problem as an issue, and whether a fix is in progress. Gives counts only, never which clients.",
    { issueId: ISSUE_ID },
    ["issueId"],
    async (args, { hq, clientId }) => {
      if (!hq || !clientId) return { data: "Not available here", nodeIds: [], queries: [] };
      const issueId = String(args.issueId);
      const [pattern] = await run<{ title: string; otherClients: number; statuses: string[]; pullRequests: Array<{ number: number | null; state: string; url: string }> }>(hq, X8_PATTERN_FOR_TICKET, { id: issueId, clientId });
      const data = pattern
        ? { otherClients: pattern.otherClients, problem: pattern.title, theirStatuses: pattern.statuses, fixes: pattern.pullRequests.filter((pr) => pr.number !== null) }
        : { otherClients: 0 };
      return { data, nodeIds: [issueId], queries: [X8_PATTERN_FOR_TICKET] };
    },
  ),
  tool(
    "find_code",
    "Search the product's code by meaning (the code vector index): which files and functions deal with something, e.g. 'saving scores' or 'report card averages'. Returns paths, what each file defines and an outline. Only files whose source was read when the repo was connected are searchable.",
    { query: { type: "string" } },
    ["query"],
    async (args, { graph, llm }) => {
      const [embedding] = await llm.embed([String(args.query)]);
      const files = await run<{ id: string; path: string; repo: string; symbols: string[]; outline: string }>(graph, C14_CODE_NEAR, { embedding, k: 6 });
      return {
        data: files.length ? files.map(({ path, repo, symbols, outline }) => ({ path, repo, defines: symbols.slice(0, 20), outline })) : "No code has been read yet: connect the product's repository first.",
        nodeIds: files.map((f) => f.id),
        queries: [C14_CODE_NEAR],
      };
    },
  ),
  tool(
    "read_code",
    "Read a source file from the product's GitHub repository, to see what the code really does before naming a cause. Use a path from find_code or an issue's code files.",
    { path: { type: "string" }, repo: { type: "string", description: "owner/name; defaults to this client's repositories, tried in order" } },
    ["path"],
    async (args, { repos }) => {
      const path = String(args.path).replace(/^\/+/, "");
      for (const repo of str(args.repo) ? [String(args.repo)] : repos) {
        const source = await readSource(repo, path).catch(() => undefined);
        if (source) return { data: { repo, path, source: source.slice(0, 12_000), truncated: source.length > 12_000 }, nodeIds: [], queries: [] };
      }
      return { data: `Couldn't read ${path}: no GitHub access, or no such file in ${repos.join(", ") || "any connected repository"}.`, nodeIds: [], queries: [] };
    },
  ),
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
    async (args, { graph, repos, mayWriteGithub }) => {
      if (mayWriteGithub === false) return { data: "This account can't open GitHub issues (it is the demo account). Say so, and offer the issue's details instead.", nodeIds: [], queries: [] };
      const repo = str(args.repo) ?? repos[0];
      if (!repo) return { data: "No GitHub repository is connected to this project.", nodeIds: [], queries: [] };
      const created = await openGithubIssue(graph, repo, String(args.issueId));
      return { data: { opened: true, ...created }, nodeIds: [String(args.issueId)], queries: [] };
    },
  ),
);

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.definition.name, t]));
