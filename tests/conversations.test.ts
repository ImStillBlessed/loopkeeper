import type { Graph } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteConversation, getConversation, listConversations, migrateLegacyQuestions } from "../src/agent/conversations.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { ensureSchema } from "../src/graph/schema.js";

const answer = (text: string) => ({ answer: text, sources: [], graphPath: { nodeIds: [] }, queriesRun: [], toolCalls: [] });

describe("Ask conversations in the graph", () => {
  let graph: Graph;

  beforeAll(async () => {
    graph = (await getFalkorDB()).selectGraph("lk_test_conversations");
    await graph.delete().catch(() => undefined);
    await ensureSchema(graph);
    // Two questions saved the old way, one node each.
    await graph.query(
      `CREATE (:Question {id: 'q1', text: 'What is open?', answerJson: $a1, askedAt: 1000}),
              (:Question {id: 'q2', text: 'And who owns it?', answerJson: $a2, askedAt: 2000})`,
      { params: { a1: JSON.stringify(answer("Two issues.")), a2: JSON.stringify(answer("Tunde.")) } },
    );
  });

  afterAll(async () => {
    await graph.delete().catch(() => undefined);
    await closeFalkorDB();
  });

  it("turns old one-question-per-node history into a single conversation, in order", async () => {
    await migrateLegacyQuestions(graph);
    const [conversation] = await listConversations(graph);
    expect(conversation).toMatchObject({ title: "What is open?", turnCount: 2 });

    const full = await getConversation(graph, conversation.id);
    expect(full?.turns.map((t) => [t.question, t.answer.answer])).toEqual([
      ["What is open?", "Two issues."],
      ["And who owns it?", "Tunde."],
    ]);

    const leftovers = await graph.query(`MATCH (q:Question) RETURN count(q) AS n`);
    expect((leftovers.data?.[0] as { n: number }).n).toBe(0);
  });

  it("migrating again changes nothing", async () => {
    await migrateLegacyQuestions(graph);
    expect(await listConversations(graph)).toHaveLength(1);
  });

  it("deletes a conversation", async () => {
    const [conversation] = await listConversations(graph);
    await deleteConversation(graph, conversation.id);
    expect(await listConversations(graph)).toEqual([]);
  });
});
