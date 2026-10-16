import type { Graph } from "falkordb";

/** Embedding size of all-MiniLM-L6-v2, the local embedding model we plan to use. */
export const EMBEDDING_DIMENSION = 384;

/**
 * Range indexes on the properties we look nodes up by.
 * Without them, every MERGE during ingest would scan all nodes of that label.
 */
const RANGE_INDEXES: Array<[label: string, property: string]> = [
  // Client graphs
  ["Client", "id"],
  ["Repo", "id"],
  ["CodeFile", "id"],
  ["PullRequest", "id"],
  ["Commit", "id"],
  ["Group", "id"],
  ["Person", "id"],
  ["School", "id"],
  ["Message", "id"],
  ["Issue", "id"],
  ["Issue", "status"],
  ["FollowUp", "id"],
  ["FollowUp", "status"],
  ["Decision", "id"],
  ["Feature", "key"],
  ["CodeFile", "path"],
  ["Conversation", "id"],
  // HQ graph
  ["Staff", "id"],
  ["Staff", "email"],
  ["Product", "key"],
  ["SlaPolicy", "plan"],
  ["Signal", "id"],
  ["Signal", "clientId"],
  ["Pattern", "id"],
  ["PullRequest", "number"],
];

/** Vector indexes for duplicate detection and semantic search. */
const VECTOR_INDEXES: Array<[label: string, property: string]> = [
  ["Issue", "embedding"],
  ["Message", "embedding"],
  ["Signal", "embedding"],
  ["CodeFile", "embedding"],
];

/**
 * Creates every index the app needs. Safe to run on every startup:
 * FalkorDB rejects an index that already exists, so we skip that error.
 */
export async function ensureSchema(graph: Graph): Promise<void> {
  for (const [label, property] of RANGE_INDEXES) {
    await createIndexIfMissing(graph, `CREATE INDEX FOR (n:${label}) ON (n.${property})`);
  }
  for (const [label, property] of VECTOR_INDEXES) {
    await createIndexIfMissing(
      graph,
      `CREATE VECTOR INDEX FOR (n:${label}) ON (n.${property}) ` +
        `OPTIONS {dimension: ${EMBEDDING_DIMENSION}, similarityFunction: 'cosine'}`,
    );
  }
}

async function createIndexIfMissing(graph: Graph, statement: string): Promise<void> {
  try {
    await graph.query(statement);
  } catch (error) {
    if (error instanceof Error && /already indexed/i.test(error.message)) return;
    throw error;
  }
}
