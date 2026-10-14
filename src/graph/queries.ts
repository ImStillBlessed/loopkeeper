import type { Graph } from "falkordb";

/**
 * Every Cypher query Loopkeeper runs, in one place, each with a stable id.
 *   S*  seed the static world (people, schools, features, code)
 *   W*  writes done by the ingest pipeline
 *   Q*  reads used by the dashboard and as agent tools
 */

export interface NamedQuery {
  id: string;
  title: string;
  cypher: string;
}

const query = (id: string, title: string, cypher: string): NamedQuery => ({ id, title, cypher });

/** Statuses that still need someone's attention. */
export const OPEN_STATUSES = ["open", "in_progress", "possibly_resolved"];

/** Run a named query and return its rows as plain objects keyed by the RETURN aliases. */
export async function run<T = Record<string, unknown>>(
  graph: Graph,
  named: NamedQuery,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const reply = await graph.query<T>(named.cypher, { params: params as never });
  return reply.data ?? [];
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export const S1_TENANT = query("S1", "Tenant and group", `
  MERGE (t:Tenant {id: $tenantId})
    ON CREATE SET t.seen = 0, t.ignored = 0, t.clock = 0
  SET t.name = $tenantName
  MERGE (g:Group {id: $groupId})
  SET g.name = $groupName, g.source = $source`);

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
  MATCH (t:Tenant)
  SET t.seen = t.seen + 1,
      t.ignored = t.ignored + $ignored,
      t.clock = CASE WHEN $ts > t.clock THEN $ts ELSE t.clock END`);

export const W2_MESSAGE = query("W2", "Store a relevant message and who sent it", `
  MATCH (g:Group {id: $groupId})
  MERGE (p:Person {id: $senderId})
    ON CREATE SET p.name = $senderName, p.role = 'unknown'
  MERGE (p)-[:MEMBER_OF]->(g)
  MERGE (m:Message {id: $id})
    ON CREATE SET m.text = $text, m.ts = $ts, m.type = $type, m.hasMedia = $hasMedia,
                  m.embedding = vecf32($embedding)
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
  SET i.status = $to, i.updatedAt = $ts`);

export const W7_CHANGE_STATUS_BY_HUMAN = query("W7", "Change an issue's status from the dashboard", `
  MATCH (i:Issue {id: $issueId})
  CREATE (sc:StatusChange {id: $id, from: i.status, to: $to, at: $ts, by: $by, confidence: 1.0})
  CREATE (i)-[:HAS_CHANGE]->(sc)
  SET i.status = $to, i.updatedAt = $ts`);

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

export const C5_ISSUE_CARDS = query("C5", "Compact issue summaries for a set of ids", `
  MATCH (i:Issue)
  WHERE i.id IN $ids
  OPTIONAL MATCH (m:Message)-[:EVIDENCE_OF]->(i)
  OPTIONAL MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN i.id AS id, i.title AS title, i.kind AS kind, i.status AS status, i.featureKey AS feature,
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

export const C12_PEOPLE = query("C12", "Everyone the graph knows, with role and school", `
  MATCH (p:Person)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN p.id AS id, p.name AS name, p.role AS role, s.id AS schoolId, s.name AS school`);

// ─── Reads for the dashboard and the agent ───────────────────────────────────

export const Q0_STATS = query("Q0", "Ingest counters", `
  MATCH (t:Tenant)
  OPTIONAL MATCH (m:Message)
  RETURN t.seen AS seen, t.ignored AS ignored, count(m) AS used, t.clock AS clock`);

export const Q1_OPEN_ITEMS = query("Q1", "Open items, optionally for one school / person / feature, with sources", `
  MATCH (p:Person)-[:SENT]->(m:Message)-[:EVIDENCE_OF]->(i:Issue)
  WHERE i.status IN $openStatuses
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(owner:Person)
  WITH i, owner, collect(DISTINCT p.name) AS reporters, collect(DISTINCT s.name) AS schools,
       collect(DISTINCT m.id) AS sourceMessages
  WHERE ($school IS NULL OR any(x IN schools WHERE toLower(x) CONTAINS toLower($school)))
    AND ($person IS NULL OR any(x IN reporters WHERE toLower(x) CONTAINS toLower($person))
         OR toLower(coalesce(owner.name, '')) CONTAINS toLower($person))
    AND ($feature IS NULL OR i.featureKey = $feature)
  RETURN i.id AS id, i.title AS title, i.kind AS kind, i.status AS status, i.severity AS severity,
         owner.name AS owner, owner.id AS ownerId, reporters, schools, sourceMessages
  ORDER BY i.updatedAt DESC`);

export const Q2_CODE_PATH = query("Q2", "Issue → feature → code files → owners (multi-hop)", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (i)-[:AFFECTS]->(f:Feature)
  OPTIONAL MATCH (f)-[:IMPLEMENTED_IN]->(c:CodeFile)
  OPTIONAL MATCH (d:Person)-[:OWNS]->(c)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(a:Person)
  RETURN f.key AS featureKey, f.name AS feature, collect(DISTINCT c.path) AS files,
         collect(DISTINCT d.name) AS codeOwners, a.name AS assignee`);

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

export const Q11_BOARD = query("Q11", "Board: every canonical issue with reporters, schools and owner", `
  MATCH (i:Issue)
  WHERE i.status <> 'merged'
  OPTIONAL MATCH (m:Message)-[:EVIDENCE_OF]->(i)
  OPTIONAL MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  OPTIONAL MATCH (dup:Issue)-[:DUPLICATE_OF]->(i)
  OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(owner:Person)
  RETURN i.id AS id, i.title AS title, i.kind AS kind, i.status AS status, i.severity AS severity,
         i.featureKey AS feature, i.createdAt AS createdAt, i.updatedAt AS updatedAt,
         count(DISTINCT m) AS messages, collect(DISTINCT s.name) AS schools,
         count(DISTINCT dup) AS merged, owner.name AS owner
  ORDER BY updatedAt DESC`);

export const Q12_EVIDENCE = query("Q12", "The messages behind an issue", `
  MATCH (m:Message)-[e:EVIDENCE_OF]->(i:Issue {id: $issueId})
  MATCH (p:Person)-[:SENT]->(m)
  OPTIONAL MATCH (p)-[:WORKS_AT]->(s:School)
  RETURN m.id AS id, m.text AS text, m.ts AS ts, m.hasMedia AS hasMedia, e.kind AS kind,
         p.name AS sender, s.name AS school
  ORDER BY ts`);

export const Q13_ISSUE = query("Q13", "One issue's own fields and merged duplicates", `
  MATCH (i:Issue {id: $issueId})
  OPTIONAL MATCH (dup:Issue)-[:DUPLICATE_OF]->(i)
  OPTIONAL MATCH (f:FollowUp)-[:ABOUT]->(i)
  RETURN i.id AS id, i.title AS title, i.summary AS summary, i.kind AS kind, i.status AS status,
         i.severity AS severity, i.createdAt AS createdAt,
         collect(DISTINCT dup.title) AS mergedTitles, collect(DISTINCT dup.id) AS mergedIds,
         collect(DISTINCT f.text) AS followUps`);

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
  WHERE NOT n:Tenant
  RETURN coalesce(n.id, n.key, n.path) AS id, labels(n)[0] AS label,
         coalesce(n.title, n.name, n.path, n.text, n.to) AS name, n.status AS status`);

export const Q18_GRAPH_EDGES = query("Q18", "Whole tenant graph: relationships (for the graph view)", `
  MATCH (a)-[r]->(b)
  WHERE NOT a:Tenant AND NOT b:Tenant
  RETURN coalesce(a.id, a.key, a.path) AS source, coalesce(b.id, b.key, b.path) AS target, type(r) AS type`);
