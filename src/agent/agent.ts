import type { Graph } from "falkordb";
import type OpenAI from "openai";
import { C13_FEATURES, P6_REPOS, Q0_STATS, Q14_MESSAGES, run } from "../graph/queries.js";
import { chatClient, completeWithFallback, modelOptions, type Llm } from "../llm/llm.js";
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
}

/** A previous question and the answer text, from the same conversation. */
export interface EarlierTurn {
  question: string;
  answer: string;
}

const MAX_STEPS = 6;
const CITATION = /\[(msg_[a-f0-9]+)\]/g;

/**
 * Answers a question by letting the model call graph-query tools until it has what it needs.
 * `now` is the chat clock, so "overdue" means overdue in the chat's time.
 */
export async function ask(graph: Graph, llm: Llm, question: string, now?: number, earlier: EarlierTurn[] = []): Promise<Answer> {
  const [stats] = await run<{ clock: number }>(graph, Q0_STATS);
  const features = await run<{ key: string; name: string }>(graph, C13_FEATURES);
  const repos = await run<{ id: string }>(graph, P6_REPOS);
  const ctx: ToolContext = { graph, llm, now: now ?? (stats?.clock || Date.now()), repos: repos.map((r) => r.id) };

  const context = [
    `now = ${formatLagos(ctx.now)}`,
    `Product features (feature keys): ${features.map((f) => `${f.key} (${f.name})`).join(", ") || "none yet"}`,
    `Connected GitHub repositories: ${ctx.repos.join(", ") || "none"}`,
  ].join("\n");

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: `${prompt("agent")}\n\n${context}` },
    // Earlier turns of the conversation, so follow-ups ("and who owns it?") make sense.
    ...earlier.flatMap((turn): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ]),
    { role: "user", content: question },
  ];
  const nodeIds = new Set<string>();
  const queries = new Map<string, Answer["queriesRun"][number]>();
  const toolCalls: Answer["toolCalls"] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await completeWithFallback("smart", (model, effort) =>
      chatClient().chat.completions.create({ model, ...modelOptions(model, effort), messages, tools: TOOLS.map((t) => t.definition) }),
    );
    const reply = response.choices[0].message;
    // Echo back only the standard fields: reasoning models add extras the API won't accept as input.
    messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });

    if (!reply.tool_calls?.length) {
      return finalise(graph, reply.content ?? "", nodeIds, queries, toolCalls);
    }

    for (const call of reply.tool_calls) {
      if (call.type !== "function") continue;
      const args = JSON.parse(call.function.arguments || "{}");
      toolCalls.push({ tool: call.function.name, args });
      const tool = TOOLS_BY_NAME.get(call.function.name);
      const result = tool
        ? await tool.execute(args, ctx)
        : { data: `Unknown tool ${call.function.name}`, nodeIds: [], queries: [] };

      result.nodeIds.forEach((id) => nodeIds.add(id));
      result.queries.forEach((q) => queries.set(q.id, { id: q.id, title: q.title, cypher: q.cypher.trim() }));
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) });
    }
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
  };
}
