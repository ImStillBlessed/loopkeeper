import type { Graph } from "falkordb";
import { queryLog, readStatistics } from "./activity.js";
import { graphName } from "./client.js";

/**
 * Every Cypher query Loopkeeper runs, in one place, each with a stable id.
 *   P*  the client, its WhatsApp groups (this file is the per-client graph; HQ queries are in hq-queries.ts)
 *   S*  seed the static world (people, schools, features, code)
 *   IX* index a GitHub repository (files, features, owners, imports)
 *   GH* GitHub activity (issues, pull requests, commits)
 *   W*  writes done by the ingest pipeline
 *   Q*  reads used by the dashboard and as agent tools
 *   SIM* the simulated school in the demo
 */

export interface NamedQuery {
  id: string;
  title: string;
  cypher: string;
}

/** Every named query by id, so the dashboard can show the Cypher behind a query it saw run. */
export const QUERIES = new Map<string, NamedQuery>();

export const query = (id: string, title: string, cypher: string): NamedQuery => {
  const named = { id, title, cypher };
  QUERIES.set(id, named);
  return named;
};

/*
 * FalkorDB note: grouping an aggregation (count/collect) by a key that is null (a missing property, or a
 * property of an OPTIONAL MATCH that found nothing) can crash the server. Every such key next to an
 * aggregate is wrapped in coalesce(...), and the API turns '' back into "none".
 */

/** Statuses that still need someone's attention. */
export const OPEN_STATUSES = ["open", "in_progress", "possibly_resolved"];

/**
 * Run a named query and return its rows as plain objects keyed by the RETURN aliases. Each run is
 * logged with FalkorDB's own statistics, for the Database page.
 */
export async function run<T = Record<string, unknown>>(
  graph: Graph,
  named: NamedQuery,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const started = performance.now();
  const entry = { id: named.id, title: named.title, graph: graphName(graph), ts: Date.now(), vector: named.cypher.includes("db.idx.vector") };
  try {
    const reply = await graph.query<T>(named.cypher, { params: params as never });
    queryLog.record({ ...entry, ...readStatistics(reply.metadata), totalMs: performance.now() - started, rows: reply.data?.length ?? 0 });
    return reply.data ?? [];
  } catch (error) {
    queryLog.record({ ...entry, engineMs: 0, cached: false, writes: {}, totalMs: performance.now() - started, rows: 0, error: (error as Error).message });
    throw error;
  }
}

// ─── The client, its groups, repos ───────────────────────────────────────────

export const P1_CLIENT = query("P1", "Create or rename the client this graph belongs to", `
  MERGE (p:Client {id: $id})
    ON CREATE SET p.seen = 0, p.ignored = 0, p.clock = 0, p.createdAt = $ts
  SET p.name = $name`);

export const P2_CLIENT_SUMMARY = query("P2", "Client name, counters, and how many groups it has", `
  MATCH (p:Client)
  OPTIONAL MATCH (g:Group)
  WITH p, count(DISTINCT g) AS groups
  OPTIONAL MATCH (r:Repo)
  RETURN p.id AS id, p.name AS name, p.seen AS seen, p.clock AS clock, groups, count(DISTINCT r) AS repos`);

export const P3_GROUP = query("P3", "Add a WhatsApp group to the project", `
  MERGE (g:Group {id: $id})
    ON CREATE SET g.createdAt = $ts, g.seen = 0
  SET g.name = $name, g.source = $source`);

export const P4_GROUPS = query("P4", "The project's WhatsApp groups with message counts", `
  MATCH (g:Group)
  OPTIONAL MATCH (m:Message)-[:IN]->(g)
  RETURN g.id AS id, g.name AS name, coalesce(g.source, 'whatsapp_export') AS source, coalesce(g.seen, 0) AS seen,
         count(m) AS used, coalesce(g.lastMessageAt, 0) AS lastMessageAt, coalesce(g.createdAt, 0) AS createdAt
  ORDER BY createdAt`);

export const P5_REPO = query("P5", "Connect a GitHub repository", `
  MERGE (r:Repo {id: $id})
    ON CREATE SET r.createdAt = $ts
  SET r.url = $url, r.defaultBranch = $defaultBranch`);

export const P6_REPOS = query("P6", "Connected repositories with what Loopkeeper knows about each", `
  MATCH (r:Repo)
  OPTIONAL MATCH (c:CodeFile {repo: r.id})
  WITH r, count(c) AS files
  OPTIONAL MATCH (pr:PullRequest {repo: r.id})
  WITH r, files, count(pr) AS pullRequests
  OPTIONAL MATCH (cm:Commit {repo: r.id})
  RETURN r.id AS id, r.url AS url, r.defaultBranch AS defaultBranch, coalesce(r.indexedAt, 0) AS indexedAt,
         coalesce(r.syncedAt, 0) AS syncedAt, coalesce(r.featureSource, '') AS featureSource,
         files, pullRequests, count(cm) AS commits, coalesce(r.createdAt, 0) AS createdAt
  ORDER BY createdAt`);

export const P7_REPO_MARK = query("P7", "Remember when a repo was last indexed or synced", `
  MATCH (r:Repo {id: $id})
  SET r.indexedAt = coalesce($indexedAt, r.indexedAt),
      r.syncedAt = coalesce($syncedAt, r.syncedAt),
      r.featureSource = coalesce($featureSource, r.featureSource)`);

// ─── Seed ────────────────────────────────────────────────────────────────────

export const S2_SCHOOLS = query("S2", "Schools", `
  UNWIND $schools AS s
  MERGE (n:School {id: s.id})
  SET n.name = s.name, n.city = s.city`);

export const S3_PEOPLE = query("S3", "People and group membership", `
  UNWIND $people AS p
  MERGE (n:Person {id: p.id})
  SET n.name = p.name, n.role = p.role
  WITH n
  MATCH (g:Group {id: $groupId})
  MERGE (n)-[:MEMBER_OF]->(g)`);

export const S4_WORKS_AT = query("S4", "Who works at which school", `
  UNWIND $links AS l
  MATCH (p:Person {id: l.personId}), (s:School {id: l.schoolId})
  MERGE (p)-[:WORKS_AT]->(s)`);

export const S5_FEATURES = query("S5", "Product features and which schools use them", `
  UNWIND $features AS f
  MERGE (n:Feature {key: f.key})
  SET n.name = f.name, n.description = f.description
  WITH n, f
  UNWIND f.schoolIds AS schoolId
  MATCH (s:School {id: schoolId})
  MERGE (s)-[:USES]->(n)`);

export const S6_CODE = query("S6", "Code files, the feature they implement, and their owner", `
  UNWIND $files AS f
  MERGE (c:CodeFile {path: f.path})
  SET c.repo = $repo
  WITH c, f
  MATCH (feature:Feature {key: f.feature}), (owner:Person {id: f.ownerId})
  MERGE (feature)-[:IMPLEMENTED_IN]->(c)
  MERGE (owner)-[:OWNS]->(c)`);

export const S7_IMPORTS = query("S7", "Code import graph", `
  UNWIND $imports AS i
  MATCH (a:CodeFile {path: i.from}), (b:CodeFile {path: i.to})
  MERGE (a)-[:IMPORTS]->(b)`);

// ─── Ingest writes ───────────────────────────────────────────────────────────

export const W1_COUNT_MESSAGE = query("W1", "Count a message (noise is only ever counted, never stored)", `
  MATCH (p:Client), (g:Group {id: $groupId})
  SET p.seen = p.seen + 1,
      p.ignored = p.ignored + $ignored,
      p.clock = CASE WHEN $ts > p.clock THEN $ts ELSE p.clock END,
      g.seen = coalesce(g.seen, 0) + 1,
      g.lastMessageAt = $ts`);

export const W2_MESSAGE = query("W2", "Store a relevant message and who sent it", `
  MATCH (g:Group {id: $groupId})
  MERGE (p:Person {id: $senderId})
    ON CREATE SET p.name = $senderName, p.role = 'unknown'
  MERGE (p)-[:MEMBER_OF]->(g)
  MERGE (m:Message {id: $id})
    ON CREATE SET m.text = $text, m.ts = $ts, m.type = $type, m.hasMedia = $hasMedia,
                  m.sentiment = $sentiment, m.embedding = vecf32($embedding)
  MERGE (p)-[:SENT]->(m)
  MERGE (m)-[:IN]->(g)`);

export const W3_CREATE_ISSUE = query("W3", "Open a new issue from the message that reported it", `
  MATCH (m:Message {id: $messageId})
  CREATE (i:Issue {
    id: $id, title: $title, summary: $summary, kind: $kind, status: 'open',
    severity: $severity, featureKey: $featureKey, createdAt: $ts, updatedAt: $ts,
    embedding: vecf32($embedding)
  })
  CREATE (m)-[:EVIDENCE_OF {kind: 'reported'}]->(i)`);

export const W4_LINK_FEATURE_AND_OWNER = query("W4", "Link an issue to its feature and assign the owner of that feature's code", `
  MATCH (i:Issue {id: $issueId}), (f:Feature {key: $featureKey})
  MERGE (i)-[:AFFECTS]->(f)
  WITH i, f
  MATCH (f)-[:IMPLEMENTED_IN]->(:CodeFile)<-[:OWNS]-(dev:Person)
  WITH i, dev, count(*) AS filesOwned
  ORDER BY filesOwned DESC
  LIMIT 1
  MERGE (i)-[:ASSIGNED_TO]->(dev)
  RETURN dev.name AS owner`);

export const W5_ADD_EVIDENCE = query("W5", "Attach a message to an existing issue", `
  MATCH (m:Message {id: $messageId}), (i:Issue {id: $issueId})
  MERGE (m)-[e:EVIDENCE_OF]->(i)
    ON CREATE SET e.kind = $kind
  SET i.updatedAt = $ts`);

export const W6_CHANGE_STATUS = query("W6", "Change an issue's status, recording which message caused it", `
  MATCH (i:Issue {id: $issueId}), (m:Message {id: $messageId})
  CREATE (sc:StatusChange {id: $id, from: i.status, to: $to, at: $ts, confidence: $confidence})
  CREATE (i)-[:HAS_CHANGE]->(sc)
  CREATE (m)-[:CAUSED]->(sc)
  SET i.status = $to, i.updatedAt = $ts,
      i.resolvedAt = CASE WHEN $to = 'resolved' THEN $ts ELSE i.resolvedAt END`);

export const W7_CHANGE_STATUS_BY_HUMAN = query("W7", "Change an issue's status from outside the chat (dashboard, GitHub)", `
  MATCH (i:Issue {id: $issueId})
  CREATE (sc:StatusChange {id: $id, from: i.status, to: $to, at: $ts, by: $by, confidence: 1.0})
  CREATE (i)-[:HAS_CHANGE]->(sc)
  SET i.status = $to, i.updatedAt = $ts,
      i.resolvedAt = CASE WHEN $to = 'resolved' THEN $ts ELSE i.resolvedAt END`);

export const W20_LIKELY_CODE = query("W20", "Where a ticket most likely lives in the code, and why", `
  UNWIND $links AS l
  MATCH (i:Issue {id: $issueId}), (c:CodeFile {id: l.fileId})
  MERGE (i)-[r:LIKELY_IN]->(c)
  SET r.functions = l.functions, r.why = l.why, r.confidence = l.confidence, r.readSource = l.readSource, r.at = $ts`);

export const W15_FIRST_RESPONSE = query("W15", "The first time Ednovax staff replied on a ticket (for SLA)", `
  MATCH (i:Issue {id: $issueId})
  WHERE i.firstResponseAt IS NULL
  SET i.firstResponseAt = $ts`);

export const W16_UNASSIGN = query("W16", "Take an issue off whoever it is assigned to", `
  MATCH (i:Issue {id: $issueId})-[r:ASSIGNED_TO]->(:Person)
  DELETE r`);

export const W17_ASSIGN = query("W17", "Assign an issue to a person", `
  MATCH (i:Issue {id: $issueId}), (p:Person {id: $personId})
  MERGE (i)-[:ASSIGNED_TO]->(p)
  SET i.updatedAt = $ts
  RETURN p.name AS name`);

export const W18_ESCALATE = query("W18", "Escalate an issue: flag it for the lead and raise low severities to high", `
  MATCH (i:Issue {id: $issueId})
  SET i.escalated = true, i.escalatedAt = $ts, i.escalatedBy = $by, i.escalationNote = $note, i.updatedAt = $ts,
      i.severity = CASE WHEN i.severity IN ['low', 'medium'] THEN 'high' ELSE i.severity END
  RETURN i.title AS title`);

export const W19_TEAM_NOTE = query("W19", "A team note on a ticket: developers and support talking, never sent to the client", `
  MATCH (i:Issue {id: $issueId})
  CREATE (n:Note {id: $id, text: $text, by: $by, role: $role, ts: $ts})-[:ON]->(i)`);

export const Q19_TEAM_NOTES = query("Q19", "The team's notes on a ticket", `
  MATCH (n:Note)-[:ON]->(:Issue {id: $issueId})
  RETURN n.id AS id, n.text AS text, n.by AS by, n.role AS role, n.ts AS ts
  ORDER BY ts`);

export const W8_LINK_SIMILAR = query("W8", "Mark two issues as possible duplicates", `
  MATCH (a:Issue {id: $a}), (b:Issue {id: $b})
  MERGE (a)-[r:SIMILAR_TO]->(b)
  SET r.score = $score`);

export const W9_MERGE_DUPLICATE = query("W9", "Merge a duplicate into the canonical issue and move its evidence over", `
  MATCH (dup:Issue {id: $duplicateId}), (canon:Issue {id: $canonicalId})
  MERGE (dup)-[:DUPLICATE_OF]->(canon)
  SET dup.status = 'merged', canon.updatedAt = $ts
  WITH dup, canon
  MATCH (m:Message)-[e:EVIDENCE_OF]->(dup)
  MERGE (m)-[e2:EVIDENCE_OF]->(canon)
    ON CREATE SET e2.kind = e.kind`);

export const W10_CREATE_FOLLOWUP = query("W10", "Record a promise: who owes what, by when", `
  MATCH (m:Message {id: $messageId}), (owner:Person {id: $ownerId})
  CREATE (f:FollowUp {id: $id, text: $text, status: 'open', dueAt: $dueAt, createdAt: $ts})
  CREATE (m)-[:CREATED]->(f)
  CREATE (f)-[:ASSIGNED_TO]->(owner)`);

export const W11_FOLLOWUP_ABOUT = query("W11", "Link a follow-up to the issue it is about", `
  MATCH (f:FollowUp {id: $followUpId}), (i:Issue {id: $issueId})
  MERGE (f)-[:ABOUT]->(i)`);

export const W12_COMPLETE_FOLLOWUP = query("W12", "Mark a promise as kept", `
  MATCH (f:FollowUp {id: $followUpId}), (m:Message {id: $messageId})
  SET f.status = 'done', f.doneAt = $ts
  MERGE (m)-[:COMPLETES]->(f)`);

export const W13_DECISION = query("W13", "Record a decision and the message it came from", `
  MATCH (m:Message {id: $messageId})
  CREATE (d:Decision {id: $id, text: $text, ts: $ts})
  CREATE (m)-[:RECORDS]->(d)
  WITH d
  OPTIONAL MATCH (f:Feature {key: $featureKey})
  WITH d, f WHERE f IS NOT NULL
  MERGE (d)-[:ABOUT]->(f)`);

export const W14_REMINDER = query("W14", "Log a reminder so the bot never nags twice", `
  MATCH (f:FollowUp {id: $followUpId})-[:ASSIGNED_TO]->(p:Person)
  CREATE (r:Reminder {id: $id, kind: $kind, sentAt: $ts, text: $text})
  CREATE (r)-[:FOR]->(f)
  CREATE (r)-[:TO]->(p)
  SET f.status = CASE WHEN $kind = 'overdue' THEN 'overdue' ELSE f.status END`);

// ─── Context the pipeline pulls from the graph ───────────────────────────────

export const C1_SENDER = query("C1", "Who sent this message, and which school are they from", `
  MATCH (p:Person {id: $personId})
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN p.name AS name, p.role AS role, s.id AS schoolId, s.name AS school`);

export const C2_OPEN_ISSUES_FOR_SCHOOL = query("C2", "Open issues reported by people from a school", `
  MATCH (:School {id: $schoolId})<-[:WORKS_AT]-(:Person)-[:SENT]->(:Message)-[:EVIDENCE_OF]->(i:Issue)
  WHERE i.status IN $openStatuses
  RETURN DISTINCT i.id AS id`);

export const C3_OPEN_ISSUES_NEAR = query("C3", "Open issues semantically close to a text (vector index)", `
  CALL db.idx.vector.queryNodes('Issue', 'embedding', 10, vecf32($embedding))
  YIELD node, score
  WHERE node.status IN $openStatuses
  RETURN node.id AS id, score AS distance
  ORDER BY distance
  LIMIT $limit`);

export const C4_RECENT_ISSUES = query("C4", "Most recently active open issues", `
  MATCH (i:Issue)
  WHERE i.status IN $openStatuses
  RETURN i.id AS id
  ORDER BY i.updatedAt DESC
  LIMIT $limit`);

export const C4B_RECENTLY_RESOLVED = query("C4B", "Issues resolved recently (the school may confirm the fix, or say it still fails)", `
  MATCH (i:Issue)
  WHERE i.status = 'resolved' AND i.updatedAt >= $since
  RETURN i.id AS id
  ORDER BY i.updatedAt DESC
  LIMIT $limit`);

export const C14_CODE_NEAR = query("C14", "Code files closest in meaning to a problem (code vector index)", `
  CALL db.idx.vector.queryNodes('CodeFile', 'embedding', $k, vecf32($embedding))
  YIELD node, score
  RETURN node.id AS id, node.path AS path, node.repo AS repo, coalesce(node.symbols, []) AS symbols,
         coalesce(node.outline, '') AS outline, score AS distance
  ORDER BY distance`);

export const C15_FEATURE_CODE = query("C15", "Files of a product area whose source has been read", `
  MATCH (:Feature {key: $featureKey})-[:IMPLEMENTED_IN]->(c:CodeFile)
  WHERE c.outline IS NOT NULL
  RETURN c.id AS id, c.path AS path, c.repo AS repo, coalesce(c.symbols, []) AS symbols, c.outline AS outline
  LIMIT 6`);

export const C5_ISSUE_CARDS = query("C5", "Compact issue summaries for a set of ids", `
  MATCH (i:Issue)
  WHERE i.id IN $ids
  OPTIONAL MATCH (m:Message)-[:EVIDENCE_OF]->(i)
  OPTIONAL MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN i.id AS id, i.title AS title, coalesce(i.kind, 'bug') AS kind, i.status AS status, coalesce(i.featureKey, '') AS feature,
         collect(DISTINCT p.name) AS people, collect(DISTINCT s.name) AS schools`);

export const C6_OPEN_FOLLOWUPS = query("C6", "Promises not yet kept", `
  MATCH (f:FollowUp)-[:ASSIGNED_TO]->(p:Person)
  WHERE f.status IN ['open', 'overdue']
  RETURN f.id AS id, f.text AS text, f.dueAt AS dueAt, p.name AS owner, p.id AS ownerId`);

export const C7_FIND_PERSON = query("C7", "Find a person by (part of) their name", `
  MATCH (p:Person)
  WHERE toLower(p.name) CONTAINS toLower($name)
  RETURN p.id AS id, p.name AS name
  LIMIT 1`);

export const C8_CANONICAL = query("C8", "Follow DUPLICATE_OF to the canonical issue", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (i)-[:DUPLICATE_OF]->(c:Issue)
  RETURN coalesce(c.id, i.id) AS id, coalesce(c.status, i.status) AS status`);

export const C9_SIMILAR_TO_ISSUE = query("C9", "Open issues close to a given issue (vector index)", `
  MATCH (me:Issue {id: $issueId})
  CALL db.idx.vector.queryNodes('Issue', 'embedding', 6, me.embedding)
  YIELD node, score
  WHERE node.id <> me.id AND node.status IN $openStatuses
  RETURN node.id AS id, score AS distance`);

export const C10_DUPLICATE_CLUSTER = query("C10", "Duplicate cluster of an issue (WCC over SIMILAR_TO)", `
  CALL algo.WCC({nodeLabels: ['Issue'], relationshipTypes: ['SIMILAR_TO']})
  YIELD node, componentId
  WITH componentId, collect(node) AS issues
  WHERE size(issues) > 1 AND any(x IN issues WHERE x.id = $issueId)
  UNWIND issues AS i
  WITH i WHERE i.status IN $openStatuses
  RETURN i.id AS id, i.title AS title, i.summary AS summary, i.createdAt AS createdAt
  ORDER BY createdAt`);

export const C11_FOLLOWUPS_TO_REMIND = query("C11", "Promises due soon or overdue that haven't had this kind of reminder yet", `
  MATCH (f:FollowUp)-[:ASSIGNED_TO]->(p:Person)
  WHERE f.status IN ['open', 'overdue'] AND f.dueAt >= $from AND f.dueAt < $to
    AND NOT (:Reminder {kind: $kind})-[:FOR]->(f)
  RETURN f.id AS id, f.text AS text, f.dueAt AS dueAt, p.name AS owner, p.role AS ownerRole`);

export const C13_FEATURES = query("C13", "The product features of this project", `
  MATCH (f:Feature)
  RETURN f.key AS key, f.name AS name, f.description AS description
  ORDER BY key`);

export const C12_PEOPLE = query("C12", "Everyone the graph knows, with role and school", `
  MATCH (p:Person)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN p.id AS id, p.name AS name, p.role AS role, s.id AS schoolId, s.name AS school`);

// ─── Reads for the dashboard and the agent ───────────────────────────────────

export const Q0_STATS = query("Q0", "Ingest counters", `
  MATCH (p:Client)
  OPTIONAL MATCH (m:Message)
  RETURN p.seen AS seen, p.ignored AS ignored, count(m) AS used, p.clock AS clock`);

export const Q1_OPEN_ITEMS = query("Q1", "Open items, optionally for one school / person / feature, with sources", `
  MATCH (p:Person)-[:SENT]->(m:Message)-[:EVIDENCE_OF]->(i:Issue)
  WHERE i.status IN $openStatuses
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(owner:Person)
  WITH i, coalesce(owner.name, '') AS ownerName, coalesce(owner.id, '') AS ownerId,
       collect(DISTINCT p.name) AS reporters, collect(DISTINCT s.name) AS schools,
       collect(DISTINCT m.id) AS sourceMessages
  WHERE ($school IS NULL OR any(x IN schools WHERE toLower(x) CONTAINS toLower($school)))
    AND ($person IS NULL OR any(x IN reporters WHERE toLower(x) CONTAINS toLower($person))
         OR toLower(ownerName) CONTAINS toLower($person))
    AND ($feature IS NULL OR i.featureKey = $feature)
  RETURN i.id AS id, i.title AS title, i.kind AS kind, i.status AS status, i.severity AS severity,
         ownerName AS owner, ownerId, reporters, schools, sourceMessages
  ORDER BY i.updatedAt DESC`);

export const Q2_CODE_PATH = query("Q2", "Issue → feature → code files → owners (multi-hop)", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (i)-[:AFFECTS]->(f:Feature)
  OPTIONAL MATCH (f)-[:IMPLEMENTED_IN]->(c:CodeFile)
  OPTIONAL MATCH (d:Person)-[:OWNS]->(c)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(a:Person)
  RETURN coalesce(f.key, '') AS featureKey, coalesce(f.name, '') AS feature, collect(DISTINCT c.path) AS files,
         collect(DISTINCT d.name) AS codeOwners, coalesce(a.name, '') AS assignee`);

export const Q21_LIKELY_CODE = query("Q21", "Where a ticket most likely lives in the code (read by the model)", `
  MATCH (:Issue {id: $issueId})-[r:LIKELY_IN]->(c:CodeFile)
  RETURN c.path AS path, c.repo AS repo, coalesce(r.functions, []) AS functions, coalesce(r.why, '') AS why,
         coalesce(r.confidence, 0) AS confidence, coalesce(r.readSource, false) AS readSource
  ORDER BY confidence DESC`);

export const Q3_IMPACT = query("Q3", "Which schools use the affected feature, and which have reported it", `
  MATCH (i:Issue {id: $issueId})-[:AFFECTS]->(f:Feature)<-[:USES]-(s:School)
  OPTIONAL MATCH (s)<-[:WORKS_AT]-(:Person)-[:SENT]->(m:Message)-[:EVIDENCE_OF]->(i)
  WITH s, count(m) AS reports
  RETURN s.id AS schoolId, s.name AS school, reports > 0 AS hasReported
  ORDER BY hasReported DESC, school`);

export const Q3B_DEPENDENT_CODE = query("Q3b", "Code that imports the affected feature's files (what else could break)", `
  MATCH (:Issue {id: $issueId})-[:AFFECTS]->(f:Feature)-[:IMPLEMENTED_IN]->(c:CodeFile)
  MATCH (dependent:CodeFile)-[:IMPORTS*1..3]->(c)
  WHERE NOT (f)-[:IMPLEMENTED_IN]->(dependent)
  OPTIONAL MATCH (other:Feature)-[:IMPLEMENTED_IN]->(dependent)
  RETURN DISTINCT dependent.path AS file, other.name AS feature`);

export const Q4_DUE_FOLLOWUPS = query("Q4", "Promises due within a time window, or overdue", `
  MATCH (f:FollowUp)-[:ASSIGNED_TO]->(p:Person)
  WHERE f.status IN ['open', 'overdue'] AND f.dueAt <= $until
  OPTIONAL MATCH (f)-[:ABOUT]->(i:Issue)
  OPTIONAL MATCH (src:Message)-[:CREATED]->(f)
  RETURN f.id AS id, f.text AS text, f.dueAt AS dueAt, f.status AS status,
         p.name AS owner, p.id AS ownerId, i.id AS issueId, i.title AS issue, src.id AS sourceMessage
  ORDER BY f.dueAt`);

export const Q5_WHO_KNOWS = query("Q5", "Who knows a feature: code owners and people who fixed issues in it", `
  MATCH (f:Feature {key: $featureKey})-[:IMPLEMENTED_IN]->(c:CodeFile)<-[:OWNS]-(d:Person)
  OPTIONAL MATCH (f)<-[:AFFECTS]-(fixed:Issue {status: 'resolved'})-[:ASSIGNED_TO]->(d)
  RETURN d.id AS id, d.name AS name, count(DISTINCT c) AS filesOwned, count(DISTINCT fixed) AS issuesFixed,
         collect(DISTINCT c.path) AS files
  ORDER BY filesOwned DESC`);

export const Q6_DUPLICATE_CLUSTERS = query("Q6", "All duplicate clusters (WCC over SIMILAR_TO)", `
  CALL algo.WCC({nodeLabels: ['Issue'], relationshipTypes: ['SIMILAR_TO']})
  YIELD node, componentId
  WITH componentId, collect(node) AS issues
  WHERE size(issues) > 1
  RETURN componentId, [x IN issues | x.id] AS issueIds, [x IN issues | x.title] AS titles`);

export const Q7_PRIORITY = query("Q7", "Open issues ranked by PageRank (more evidence and links → higher)", `
  CALL algo.pageRank(null, null)
  YIELD node, score
  WHERE node:Issue AND node.status IN $openStatuses
  RETURN node.id AS id, node.title AS title, node.severity AS severity, score
  ORDER BY score DESC
  LIMIT 10`);

export const Q8_HISTORY = query("Q8", "Status history of an issue, with the message (or person) behind each change", `
  MATCH (i:Issue {id: $issueId})-[:HAS_CHANGE]->(sc:StatusChange)
  OPTIONAL MATCH (m:Message)-[:CAUSED]->(sc)
  OPTIONAL MATCH (p:Person)-[:SENT]->(m)
  RETURN sc.from AS from, sc.to AS to, sc.at AS at, sc.confidence AS confidence,
         coalesce(p.name, sc.by) AS by, m.id AS messageId, m.text AS because
  ORDER BY at`);

export const Q9_EXPLAIN_LINK = query("Q9", "Shortest path between two things in the graph", `
  MATCH (a), (b)
  WHERE (a.id = $from OR a.name = $from OR a.key = $from) AND (b.id = $to OR b.name = $to OR b.key = $to)
  WITH a, b LIMIT 1
  WITH shortestPath((a)-[*..6]-(b)) AS p
  RETURN [n IN nodes(p) | coalesce(n.id, n.key, n.path)] AS nodeIds,
         [n IN nodes(p) | coalesce(n.name, n.title, n.path, n.text)] AS hops,
         [r IN relationships(p) | type(r)] AS relations`);

export const Q10_SEARCH_ISSUES = query("Q10", "Semantic search over all issues (vector index)", `
  CALL db.idx.vector.queryNodes('Issue', 'embedding', 8, vecf32($embedding))
  YIELD node, score
  WHERE node.status <> 'merged'
  RETURN node.id AS id, node.title AS title, node.status AS status, score AS distance
  ORDER BY distance`);

export const Q20_SEARCH_MESSAGES = query("Q20", "Semantic search over stored messages and team notes (vector index)", `
  CALL db.idx.vector.queryNodes('Message', 'embedding', 8, vecf32($embedding))
  YIELD node, score
  MATCH (p:Person)-[:SENT]->(node)-[:IN]->(g:Group)
  RETURN node.id AS id, node.text AS text, node.ts AS ts, p.name AS sender, g.name AS place, score AS distance
  ORDER BY distance`);

export const Q11_BOARD = query("Q11", "Board: every canonical issue with reporters, schools and owner", `
  MATCH (i:Issue)
  WHERE i.status <> 'merged'
  OPTIONAL MATCH (m:Message)-[:EVIDENCE_OF]->(i)
  OPTIONAL MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  OPTIONAL MATCH (dup:Issue)-[:DUPLICATE_OF]->(i)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(owner:Person)
  RETURN i.id AS id, i.title AS title, coalesce(i.kind, 'bug') AS kind, i.status AS status, coalesce(i.severity, 'medium') AS severity,
         coalesce(i.featureKey, '') AS feature, coalesce(i.createdAt, 0) AS createdAt, coalesce(i.updatedAt, 0) AS updatedAt,
         count(DISTINCT m) AS messages, collect(DISTINCT s.name) AS schools,
         count(DISTINCT dup) AS merged, coalesce(owner.name, '') AS owner,
         coalesce(i.firstResponseAt, 0) AS firstResponseAt, coalesce(i.resolvedAt, 0) AS resolvedAt,
         coalesce(i.escalated, false) AS escalated, collect(DISTINCT m.sentiment) AS moods
  ORDER BY updatedAt DESC`);

export const Q12_EVIDENCE = query("Q12", "The messages behind an issue", `
  MATCH (m:Message)-[e:EVIDENCE_OF]->(i:Issue {id: $issueId})
  MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN m.id AS id, m.text AS text, m.ts AS ts, m.hasMedia AS hasMedia, e.kind AS kind, coalesce(m.sentiment, '') AS sentiment,
         p.name AS sender, s.name AS school
  ORDER BY ts`);

export const Q13_ISSUE = query("Q13", "One issue's own fields and merged duplicates", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (dup:Issue)-[:DUPLICATE_OF]->(i)
  OPTIONAL MATCH (f:FollowUp)-[:ABOUT]->(i)
  RETURN i.id AS id, i.title AS title, coalesce(i.summary, '') AS summary, coalesce(i.kind, 'bug') AS kind, i.status AS status,
         coalesce(i.severity, 'medium') AS severity, coalesce(i.createdAt, 0) AS createdAt,
         collect(DISTINCT dup.title) AS mergedTitles, collect(DISTINCT dup.id) AS mergedIds,
         collect(DISTINCT f.text) AS followUps,
         coalesce(i.featureKey, '') AS feature, coalesce(i.firstResponseAt, 0) AS firstResponseAt,
         coalesce(i.resolvedAt, 0) AS resolvedAt, coalesce(i.escalated, false) AS escalated,
         coalesce(i.escalationNote, '') AS escalationNote, coalesce(i.escalatedBy, '') AS escalatedBy`);

export const Q14_MESSAGES = query("Q14", "Messages by id (for source chips)", `
  MATCH (p:Person)-[:SENT]->(m:Message)
  WHERE m.id IN $ids
  RETURN m.id AS id, m.text AS text, m.ts AS ts, p.name AS sender`);

export const Q15_REMINDERS = query("Q15", "Reminders the bot has sent", `
  MATCH (r:Reminder)-[:FOR]->(f:FollowUp), (r)-[:TO]->(p:Person)
  RETURN r.id AS id, r.kind AS kind, r.sentAt AS sentAt, r.text AS text, f.text AS followUp, p.name AS to
  ORDER BY sentAt DESC`);

export const Q16_DECISIONS = query("Q16", "Decisions and where they came from", `
  MATCH (m:Message)-[:RECORDS]->(d:Decision)
  MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (d)-[:ABOUT]->(f:Feature)
  RETURN d.id AS id, d.text AS text, d.ts AS ts, p.name AS by, m.id AS messageId, f.name AS feature
  ORDER BY ts`);

export const Q17_GRAPH_NODES = query("Q17", "Whole tenant graph: nodes (for the graph view)", `
  MATCH (n)
  WHERE NOT n:Client AND NOT n:Repo
  RETURN coalesce(n.id, n.key, n.path) AS id, labels(n)[0] AS label,
         coalesce(n.title, n.name, n.path, n.text, n.to) AS name, n.status AS status`);

export const Q18_GRAPH_EDGES = query("Q18", "Whole tenant graph: relationships (for the graph view)", `
  MATCH (a)-[r]->(b)
  WHERE NOT a:Client AND NOT b:Client AND NOT a:Repo AND NOT b:Repo
  RETURN coalesce(a.id, a.key, a.path) AS source, coalesce(b.id, b.key, b.path) AS target, type(r) AS type`);

// ─── Repository index ────────────────────────────────────────────────────────

export const IX1_FILES = query("IX1", "Code files of a repository", `
  UNWIND $files AS f
  MERGE (c:CodeFile {id: f.id})
  SET c.path = f.path, c.repo = $repo, c.language = f.language`);

export const IX6_CODE_CONTENT = query("IX6", "What each file defines, and its embedding for the code vector index", `
  UNWIND $files AS f
  MATCH (c:CodeFile {id: f.id})
  SET c.symbols = f.symbols, c.routes = f.routes, c.outline = f.outline, c.embedding = vecf32(f.embedding), c.readAt = $ts`);

export const IX2_FEATURES = query("IX2", "Product features found in a repository", `
  UNWIND $features AS f
  MERGE (n:Feature {key: f.key})
  SET n.name = f.name, n.description = coalesce(f.description, n.description)`);

export const IX3_FEATURE_FILES = query("IX3", "Which feature each file implements", `
  UNWIND $links AS l
  MATCH (feature:Feature {key: l.feature}), (c:CodeFile {id: l.fileId})
  MERGE (feature)-[:IMPLEMENTED_IN]->(c)`);

export const IX4_OWNERS = query("IX4", "Code owners from CODEOWNERS (GitHub handles become developers)", `
  UNWIND $owners AS o
  MERGE (p:Person {id: o.personId})
    ON CREATE SET p.name = o.handle, p.role = 'developer'
  SET p.githubHandle = o.handle
  WITH p, o
  MATCH (c:CodeFile {id: o.fileId})
  MERGE (p)-[:OWNS]->(c)`);

export const IX5_IMPORTS = query("IX5", "Import graph between files", `
  UNWIND $imports AS i
  MATCH (a:CodeFile {id: i.from}), (b:CodeFile {id: i.to})
  MERGE (a)-[:IMPORTS]->(b)`);

// ─── GitHub activity ─────────────────────────────────────────────────────────

export const GH1_LINK_ISSUE = query("GH1", "Remember the GitHub issue that tracks a Loopkeeper issue", `
  MATCH (i:Issue {id: $issueId})
  SET i.githubRepo = $repo, i.githubNumber = $number, i.githubUrl = $url`);

export const GH2_ISSUE_BY_NUMBER = query("GH2", "Find the Loopkeeper issue behind a GitHub issue number", `
  MATCH (i:Issue {githubRepo: $repo, githubNumber: $number})
  OPTIONAL MATCH (i)-[:DUPLICATE_OF]->(c:Issue)
  RETURN coalesce(c.id, i.id) AS id`);

export const GH3_GITHUB_LINK = query("GH3", "The GitHub issue linked to a Loopkeeper issue, if any", `
  MATCH (i:Issue {id: $issueId})
  RETURN i.githubRepo AS repo, i.githubNumber AS number, i.githubUrl AS url, i.title AS title`);

export const GH4_PULL_REQUEST = query("GH4", "Record a pull request and who opened it (returns its previous state)", `
  OPTIONAL MATCH (old:PullRequest {id: $id})
  WITH old.state AS previousState
  MERGE (pr:PullRequest {id: $id})
    ON CREATE SET pr.createdAt = $createdAt
  SET pr.repo = $repo, pr.number = $number, pr.title = $title, pr.url = $url,
      pr.state = $state, pr.author = $author, pr.updatedAt = $updatedAt
  MERGE (a:Person {id: $authorId})
    ON CREATE SET a.name = $author, a.role = 'developer', a.githubHandle = $author
  MERGE (a)-[:AUTHORED]->(pr)
  RETURN previousState`);

export const GH5_FIXED_BY = query("GH5", "Link an issue to the pull request that fixes it", `
  MATCH (i:Issue {id: $issueId}), (pr:PullRequest {id: $prId})
  MERGE (i)-[:FIXED_BY]->(pr)`);

export const GH6_TOUCHES = query("GH6", "Files a pull request or commit changed", `
  MATCH (x) WHERE (x:PullRequest OR x:Commit) AND x.id = $id
  UNWIND $paths AS path
  MATCH (c:CodeFile {repo: $repo, path: path})
  MERGE (x)-[:TOUCHES]->(c)`);

export const GH7_COMMIT = query("GH7", "Record a pushed commit (returns whether it was new)", `
  OPTIONAL MATCH (old:Commit {id: $id})
  WITH old IS NULL AS isNew
  MERGE (c:Commit {id: $id})
  SET c.sha = $sha, c.repo = $repo, c.message = $message, c.url = $url, c.author = $author, c.ts = $ts
  MERGE (a:Person {id: $authorId})
    ON CREATE SET a.name = $author, a.role = 'developer', a.githubHandle = $author
  MERGE (a)-[:AUTHORED]->(c)
  RETURN isNew`);

export const GH8_COMMIT_REFERENCES = query("GH8", "Link a commit to the issue it mentions", `
  MATCH (i:Issue {id: $issueId}), (c:Commit {id: $commitId})
  MERGE (c)-[:REFERENCES]->(i)`);

export const GH9_CODE_ACTIVITY = query("GH9", "Pull requests and commits linked to an issue", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (i)-[:FIXED_BY]->(pr:PullRequest)
  WITH i, collect(DISTINCT CASE WHEN pr IS NULL THEN null ELSE
    {number: pr.number, title: pr.title, url: pr.url, state: pr.state, author: pr.author} END) AS pullRequests
  OPTIONAL MATCH (c:Commit)-[:REFERENCES]->(i)
  RETURN coalesce(i.githubRepo, '') AS githubRepo, coalesce(i.githubNumber, 0) AS githubNumber, coalesce(i.githubUrl, '') AS githubUrl, pullRequests,
         collect(DISTINCT CASE WHEN c IS NULL THEN null ELSE
           {sha: c.sha, message: c.message, url: c.url, author: c.author, ts: c.ts} END) AS commits`);

export const GH10_ISSUE_STATUS = query("GH10", "Current status of an issue (following merges)", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (i)-[:DUPLICATE_OF]->(c:Issue)
  RETURN coalesce(c.id, i.id) AS id, coalesce(c.status, i.status) AS status, coalesce(c.title, i.title) AS title`);

// ─── Housekeeping ────────────────────────────────────────────────────────────

export const R1_RESET_CHAT = query("R1", "Forget everything learned from chats and GitHub; keep the project's setup", `
  OPTIONAL MATCH (n)
  WHERE n:Message OR n:Issue OR n:FollowUp OR n:Decision OR n:StatusChange OR n:Reminder OR n:Note
     OR n:PullRequest OR n:Commit OR n:Question OR n:Conversation OR (n:Person AND n.role = 'unknown')
  DETACH DELETE n
  WITH count(*) AS removed
  MATCH (p:Client)
  SET p.seen = 0, p.ignored = 0, p.clock = 0
  WITH p
  OPTIONAL MATCH (g:Group)
  SET g.seen = 0
  WITH p
  OPTIONAL MATCH (r:Repo)
  SET r.syncedAt = null`);

// ─── Managing projects, groups and repos ─────────────────────────────────────

export const M2_RENAME_CLIENT = query("M2", "Rename the client", `
  MATCH (p:Client)
  SET p.name = $name`);

export const M3_RENAME_GROUP = query("M3", "Rename a WhatsApp group", `
  MATCH (g:Group {id: $id})
  SET g.name = $name`);

export const M4_REMOVE_GROUP = query("M4", "Disconnect a WhatsApp group (what was learned from it stays)", `
  MATCH (g:Group {id: $id})
  DETACH DELETE g`);

export const M5_REMOVE_REPO_FILES = query("M5", "Forget a repository's files", `
  MATCH (c:CodeFile {repo: $id})
  DETACH DELETE c`);

export const M6_REMOVE_REPO = query("M6", "Disconnect a repository", `
  MATCH (r:Repo {id: $id})
  DETACH DELETE r`);

// ─── Restoring the feed after a restart ──────────────────────────────────────

export const F1_RECENT_MESSAGES = query("F1", "The latest stored messages with what Loopkeeper did with each (small talk is never stored)", `
  MATCH (p:Person)-[:SENT]->(m:Message)-[:IN]->(g:Group)
  WITH p, m, g
  ORDER BY m.ts DESC
  LIMIT $limit
  OPTIONAL MATCH (m)-[e:EVIDENCE_OF]->(i:Issue)
  RETURN m.id AS id, g.id AS groupId, m.ts AS ts, p.name AS senderName, coalesce(m.text, '') AS text,
         coalesce(m.hasMedia, false) AS hasMedia, coalesce(m.type, 'status_update') AS type, coalesce(m.sentiment, 'calm') AS sentiment,
         collect(CASE WHEN i IS NULL THEN null ELSE {kind: e.kind, issueId: i.id, title: i.title} END) AS evidence`);

export const F2_RECENT_REMINDERS = query("F2", "Reminders the bot posted, for the restored feed", `
  MATCH (r:Reminder)
  RETURN r.text AS text, r.sentAt AS sentAt
  ORDER BY sentAt DESC
  LIMIT $limit`);

// ─── Ask conversations (the agent's memory of what it was asked) ─────────────

export const CV1_CREATE_CONVERSATION = query("CV1", "Start a conversation", `
  CREATE (:Conversation {id: $id, title: $title, startedAt: $ts, updatedAt: $ts, turnCount: 0, turnsJson: '[]', createdBy: $by, lastBy: $by, clientIds: $clientIds})`);

export const CV2_SAVE_TURNS = query("CV2", "Save a conversation's turns (questions and answers, in order)", `
  MATCH (c:Conversation {id: $id})
  SET c.turnsJson = $turnsJson, c.turnCount = $turnCount, c.updatedAt = $ts, c.lastBy = $by,
      c.clientIds = [x IN coalesce(c.clientIds, []) WHERE NOT x IN $clientIds] + $clientIds`);

export const CV3_LINK_CONVERSATION = query("CV3", "Link a conversation to the messages, issues and people its answers used", `
  MATCH (c:Conversation {id: $id})
  MATCH (n)
  WHERE n.id IN $nodeIds AND (n:Message OR n:Issue OR n:Person OR n:FollowUp OR n:Decision OR n:School)
  MERGE (c)-[:USED]->(n)`);

export const CV4_CONVERSATIONS = query("CV4", "Recent conversations", `
  MATCH (c:Conversation)
  RETURN c.id AS id, c.title AS title, c.startedAt AS startedAt, c.updatedAt AS updatedAt, c.turnCount AS turnCount,
         coalesce(c.createdBy, '') AS createdBy, coalesce(c.lastBy, '') AS lastBy, coalesce(c.clientIds, []) AS clientIds
  ORDER BY updatedAt DESC
  LIMIT $limit`);

export const CV5_CONVERSATION = query("CV5", "One conversation with all its turns", `
  MATCH (c:Conversation {id: $id})
  RETURN c.id AS id, c.title AS title, c.turnsJson AS turnsJson, coalesce(c.clientIds, []) AS clientIds, coalesce(c.createdBy, '') AS createdBy`);

export const CV6_DELETE_CONVERSATION = query("CV6", "Delete a conversation", `
  MATCH (c:Conversation {id: $id})
  DETACH DELETE c`);

/** Older graphs stored each question on its own; these are read once and turned into conversations. */
export const CV7_LEGACY_QUESTIONS = query("CV7", "Questions stored before conversations existed", `
  MATCH (q:Question)
  RETURN q.id AS id, q.text AS question, q.answerJson AS answerJson, q.askedAt AS askedAt
  ORDER BY askedAt`);

export const CV8_DELETE_LEGACY_QUESTIONS = query("CV8", "Remove migrated questions", `
  MATCH (q:Question)
  DETACH DELETE q`);


// ─── Product reference, copied from HQ into a client graph ───────────────────
// Product data (features, code, owners) isn't client-sensitive. Each client graph keeps a read-only
// copy for the products it uses, so "ticket → feature → code → owner" works inside the client's graph.

export const RP1_FEATURES = query("RP1", "Product features this client uses", `
  UNWIND $features AS f
  MERGE (n:Feature {key: f.key})
  SET n.name = f.name, n.description = f.description, n.product = f.product
  WITH n
  MATCH (s:School)
  MERGE (s)-[:USES]->(n)`);

export const RP2_FILES = query("RP2", "Code files behind those features", `
  UNWIND $files AS f
  MERGE (c:CodeFile {id: f.id})
  SET c.path = f.path, c.repo = f.repo
  WITH c, f
  MATCH (feature:Feature {key: f.feature})
  MERGE (feature)-[:IMPLEMENTED_IN]->(c)`);

export const RP4_CODE_CONTENT = query("RP4", "What each file defines, with its embedding, for this client's code search", `
  UNWIND $files AS f
  MERGE (c:CodeFile {id: f.id})
  SET c.path = f.path, c.repo = f.repo, c.symbols = f.symbols, c.routes = f.routes, c.outline = f.outline,
      c.embedding = vecf32(f.embedding)`);

export const RP5_FORGET_REPO = query("RP5", "Forget a repository's files (it was disconnected or replaced)", `
  MATCH (c:CodeFile {repo: $repo})
  DETACH DELETE c`);

export const RP3_OWNERS = query("RP3", "Who owns those files", `
  UNWIND $owners AS o
  MERGE (p:Person {id: o.id})
    ON CREATE SET p.name = o.name, p.role = 'developer'
  WITH p, o
  MATCH (c:CodeFile {id: o.fileId})
  MERGE (p)-[:OWNS]->(c)`);

// ─── Insights (SLA, health, analytics) ───────────────────────────────────────

export const I1_SENTIMENT_SINCE = query("I1", "How many work messages sounded frustrated or concerned since a time", `
  MATCH (m:Message)
  WHERE m.ts >= $since AND m.sentiment IN ['frustrated', 'concerned']
  RETURN m.sentiment AS sentiment, count(m) AS messages`);

export const I2_LAST_STAFF_REPLY = query("I2", "When Ednovax staff last wrote in this client's groups", `
  MATCH (p:Person)-[:SENT]->(m:Message)
  WHERE p.role IN ['developer', 'support']
  RETURN max(m.ts) AS lastReply`);

export const I3_LAST_CLIENT_MESSAGE = query("I3", "When the client last wrote anything that mattered", `
  MATCH (p:Person)-[:SENT]->(m:Message)
  WHERE NOT p.role IN ['developer', 'support']
  RETURN max(m.ts) AS lastMessage`);

// ─── The simulated school (demo): teachers played by the model ──────────────

export const SIM1_SAVE = query("SIM1", "Save where the simulated teachers are", `
  MERGE (s:Simulation {id: 'teachers'})
  SET s.stateJson = $stateJson`);

export const SIM2_LOAD = query("SIM2", "Where the simulated teachers are", `
  MATCH (s:Simulation {id: 'teachers'})
  RETURN s.stateJson AS stateJson`);

export const SIM3_TICKET_OF_MESSAGE = query("SIM3", "The ticket a message reported or joined (after any merge), with its status", `
  MATCH (m:Message {id: $messageId})-[:EVIDENCE_OF]->(i:Issue)
  OPTIONAL MATCH (i)-[:DUPLICATE_OF]->(c:Issue)
  RETURN coalesce(c.id, i.id) AS id, coalesce(c.status, i.status) AS status, coalesce(c.title, i.title) AS title
  LIMIT 1`);

// ─── The database itself (for the Database page) ────────────────────────────

export const DB1_LABELS = query("DB1", "How many nodes of each label", `
  MATCH (n)
  RETURN coalesce(labels(n)[0], '') AS label, count(n) AS count
  ORDER BY count DESC`);

export const DB2_RELATIONSHIPS = query("DB2", "How many relationships of each type", `
  MATCH ()-[r]->()
  RETURN type(r) AS type, count(r) AS count
  ORDER BY count DESC`);

export const DB3_INDEXES = query("DB3", "The graph's indexes (range and vector)", `
  CALL db.indexes() YIELD label, properties, types, options, entitytype, status
  RETURN label, properties, types, options, entitytype AS entity, status`);
