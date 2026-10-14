/**
 * Smoke test against a running FalkorDB: proves the Cypher features Loopkeeper depends on
 * (indexes, vector search, WCC, PageRank, shortest path) work with this server version.
 * Runs on a throwaway graph that is deleted afterwards.
 *
 * Usage: npm run db:check
 */
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { EMBEDDING_DIMENSION, ensureSchema } from "../src/graph/schema.js";

const GRAPH_NAME = "lk_smoketest";

/** A unit vector pointing mostly along one axis, so we know which issues are "similar". */
function vector(axis: number, wobble = 0): number[] {
  const v = new Array(EMBEDDING_DIMENSION).fill(0);
  v[axis] = 1;
  v[axis + 1] = wobble;
  return v;
}

async function main() {
  const db = await getFalkorDB();
  const graph = db.selectGraph(GRAPH_NAME);

  try {
    await ensureSchema(graph);
    await ensureSchema(graph); // second run must be a no-op
    console.log("✓ schema + indexes (idempotent)");

    await graph.query(
      `UNWIND $issues AS row
       CREATE (:Issue {id: row.id, title: row.title, status: 'open', embedding: vecf32(row.embedding)})`,
      {
        params: {
          issues: [
            { id: "iss_a", title: "Scores not saving", embedding: vector(0) },
            { id: "iss_b", title: "Marks no dey save", embedding: vector(0, 0.2) },
            { id: "iss_c", title: "CBT timer missing", embedding: vector(10) },
          ],
        },
      },
    );

    const similar = await graph.query<{ id: string; score: number }>(
      `CALL db.idx.vector.queryNodes('Issue', 'embedding', 2, vecf32($embedding))
       YIELD node, score
       RETURN node.id AS id, score`,
      { params: { embedding: vector(0, 0.1) } },
    );
    console.log("✓ vector search:", similar.data);

    await graph.query(
      `MATCH (a:Issue {id: 'iss_a'}), (b:Issue {id: 'iss_b'}) CREATE (a)-[:SIMILAR_TO {score: 0.95}]->(b)`,
    );
    const clusters = await graph.query(
      `CALL algo.WCC({nodeLabels: ['Issue'], relationshipTypes: ['SIMILAR_TO']})
       YIELD node, componentId
       RETURN componentId, collect(node.id) AS issueIds`,
    );
    console.log("✓ WCC clusters:", clusters.data);

    const ranks = await graph.query(
      `CALL algo.pageRank('Issue', 'SIMILAR_TO') YIELD node, score RETURN node.id AS id, score`,
    );
    console.log("✓ PageRank:", ranks.data);

    const path = await graph.query(
      `MATCH (a:Issue {id: 'iss_a'}), (b:Issue {id: 'iss_b'})
       WITH shortestPath((a)-[*..6]-(b)) AS p
       RETURN [n IN nodes(p) | n.id] AS hops`,
    );
    console.log("✓ shortestPath:", path.data);
  } finally {
    await graph.delete().catch(() => {});
    await closeFalkorDB();
  }
}

main().catch((error) => {
  console.error("✗ FalkorDB check failed:", error);
  process.exit(1);
});
