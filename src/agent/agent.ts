import type { Graph } from "falkordb";
import type Anthropic from "@anthropic-ai/sdk";
import { C13_FEATURES, Q0_STATS, Q14_MESSAGES, run } from "../graph/queries.js";
import { anthropic, completeWithFallback, MAX_TOKENS, textOf, type Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";
import { formatLagos } from "../pipeline/time.js";
import { TOOLS, TOOLS_BY_NAME, type ToolContext } from "./tools.js";

/** The "show your work" contract: every answer comes with its sources, path and queries. */
export interface Answer {
  answer: string;
  sources: Array<{ messageId: string; sender: string; ts: string; excerpt: string }>;
  graphPath: { nodeIds: string[] };
  queriesRun: Array<{ id: string; title: string; cypher: string }>;
  toolCalls: Array<{ tool: string; args: unknown }>;
  /** What the agent stored in the graph from this turn. */
  remembered?: string[];
}

/** A previous question and the answer text, from the same conversation. */
export interface EarlierTurn {
  question: string;
  answer: string;
}

const MAX_STEPS = 6;
const CITATION = /\[(msg_[a-f0-9]+)\]/g;

/** Where a question is asked: one client's graph, plus what that client may learn from HQ. */
export interface AskScope {
  /** The chat clock, so "overdue" means overdue in the chat's time. */
  now?: number;
  /** Earlier turns of the conversation. */
  earlier?: EarlierTurn[];
  /** GitHub repositories of the client's products (owner/name). */
  repos?: string[];
  /** HQ graph and the client's id, for the abstract cross-client view. */
  hq?: Graph;
  clientId?: string;
  clientName?: string;
  /** Stores what the person told the agent (see the remember tool). Without it, nothing is stored. */
  remember?: (text: string) => Promise<void>;
  /** May the agent open GitHub issues for this person (not for the demo account). */
  mayWriteGithub?: boolean;
}

/**
 * Answers a question about one client by letting the model call graph-query tools until it has what
 * it needs. The tools only read this client's graph, plus HQ counts that never name other clients.
 */
export async function ask(graph: Graph, llm: Llm, question: string, scope: AskScope = {}): Promise<Answer> {
  const [stats] = await run<{ clock: number }>(graph, Q0_STATS);
  const features = await run<{ key: string; name: string }>(graph, C13_FEATURES);
  const earlier = scope.earlier ?? [];
  const ctx: ToolContext = { graph, llm, now: scope.now ?? (stats?.clock || Date.now()), repos: scope.repos ?? [], hq: scope.hq, clientId: scope.clientId, remember: scope.remember, mayWriteGithub: scope.mayWriteGithub ?? true };

  const context = [
    scope.clientName ? `You are answering about one client: ${scope.clientName}. Never guess about other clients; same_problem_elsewhere gives counts only.` : "",
    `now = ${formatLagos(ctx.now)}`,
    `Product features (feature keys): ${features.map((f) => `${f.key} (${f.name})`).join(", ") || "none yet"}`,
    `Connected GitHub repositories: ${ctx.repos.join(", ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `${prompt("agent")}\n\n${context}`;
  const messages: Anthropic.MessageParam[] = [
    // Earlier turns of the conversation, so follow-ups ("and who owns it?") make sense.
    ...earlier.flatMap((turn): Anthropic.MessageParam[] => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ]),
    { role: "user", content: question },
  ];
  const nodeIds = new Set<string>();
  const queries = new Map<string, Answer["queriesRun"][number]>();
  const toolCalls: Answer["toolCalls"] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await completeWithFallback("smart", (model) =>
      anthropic().messages.create({ model, max_tokens: MAX_TOKENS, system, messages, tools: TOOLS.map((t) => t.definition) }),
    );
    const uses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      return finalise(graph, textOf(response), nodeIds, queries, toolCalls);
    }

    // Claude asked for tools: run them all, then hand every result back in one turn.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      toolCalls.push({ tool: use.name, args });
      const tool = TOOLS_BY_NAME.get(use.name);
      const result = tool ? await tool.execute(args, ctx) : { data: `Unknown tool ${use.name}`, nodeIds: [], queries: [] };

      result.nodeIds.forEach((id) => nodeIds.add(id));
      result.queries.forEach((q) => queries.set(q.id, { id: q.id, title: q.title, cypher: q.cypher.trim() }));
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result.data) });
    }
    messages.push({ role: "user", content: results });
  }

  return finalise(graph, "I couldn't finish that within my step limit. Try asking a narrower question.", nodeIds, queries, toolCalls);
}

async function finalise(
  graph: Graph,
  text: string,
  nodeIds: Set<string>,
  queries: Map<string, Answer["queriesRun"][number]>,
  toolCalls: Answer["toolCalls"],
): Promise<Answer> {
  // Sources are the messages the answer actually cites. Unknown ids are dropped, so nothing is invented.
  const cited = [...new Set([...text.matchAll(CITATION)].map((m) => m[1]))];
  const rows = cited.length
    ? await run<{ id: string; text: string; ts: number; sender: string }>(graph, Q14_MESSAGES, { ids: cited })
    : [];
  const known = new Map(rows.map((r) => [r.id, r]));
  const sources = cited.filter((id) => known.has(id)).map((id) => {
    const row = known.get(id)!;
    return { messageId: id, sender: row.sender, ts: formatLagos(row.ts), excerpt: row.text.slice(0, 160) };
  });
  sources.forEach((s) => nodeIds.add(s.messageId));

  return {
    answer: text,
    sources,
    graphPath: { nodeIds: [...nodeIds] },
    queriesRun: [...queries.values()],
    toolCalls,
    remembered: toolCalls.filter((c) => c.tool === "remember").map((c) => String((c.args as { text?: string }).text ?? "")).filter(Boolean),
  };
}
