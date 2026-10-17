import { query } from "./queries.js";

/**
 * Cypher for the HQ graph (lk_hq): Ednovax itself.
 *   H*   products, features, code, staff, SLA policies and the client registry
 *   X*   cross-client signals and patterns (abstract: no client messages or people)
 *   HG*  GitHub, at product level
 * The same FalkorDB note applies as in queries.ts: keys next to an aggregate are never null.
 */

// ─── Products, features and code ─────────────────────────────────────────────

export const H1_PRODUCTS_SEED = query("H1", "Ednovax products", `
  UNWIND $products AS p
  MERGE (n:Product {key: p.key})
  SET n.name = p.name, n.description = p.description`);

export const H2_FEATURES_SEED = query("H2", "Product features", `
  UNWIND $features AS f
  MATCH (p:Product {key: f.product})
  MERGE (n:Feature {key: f.key})
  SET n.name = f.name, n.description = f.description, n.product = f.product
  MERGE (p)-[:HAS_FEATURE]->(n)`);

export const H3_CODE_SEED = query("H3", "Code files, the feature they implement, and their owner", `
  UNWIND $files AS f
  MERGE (c:CodeFile {id: f.id})
  SET c.path = f.path, c.repo = f.repo
  WITH c, f
  MATCH (feature:Feature {key: f.feature})
  MERGE (feature)-[:IMPLEMENTED_IN]->(c)
  MERGE (owner:Person {id: f.ownerId})
    ON CREATE SET owner.name = f.ownerName, owner.role = 'developer'
  MERGE (owner)-[:OWNS]->(c)`);

export const H4_IMPORTS_SEED = query("H4", "Code import graph", `
  UNWIND $imports AS i
  MATCH (a:CodeFile {id: i.from}), (b:CodeFile {id: i.to})
  MERGE (a)-[:IMPORTS]->(b)`);

export const H5_PRODUCTS = query("H5", "Products with their repos, feature count and clients", `
  MATCH (p:Product)
  OPTIONAL MATCH (p)-[:HAS_REPO]->(r:Repo)
  WITH p, collect(DISTINCT r.id) AS repos
  OPTIONAL MATCH (p)-[:HAS_FEATURE]->(f:Feature)
  WITH p, repos, count(DISTINCT f) AS features
  OPTIONAL MATCH (c:Client)-[:USES]->(p)
  RETURN p.key AS key, p.name AS name, coalesce(p.description, '') AS description, repos, features,
         collect(DISTINCT c.id) AS clients
  ORDER BY name`);

export const H6_PRODUCT_FEATURES = query("H6", "Features of the given products (for copying into a client graph)", `
  MATCH (p:Product)-[:HAS_FEATURE]->(f:Feature)
  WHERE p.key IN $products
  RETURN f.key AS key, f.name AS name, coalesce(f.description, '') AS description, f.product AS product`);

export const H7_PRODUCT_FILES = query("H7", "Code files and owners of the given products", `
  MATCH (p:Product)-[:HAS_FEATURE]->(f:Feature)-[:IMPLEMENTED_IN]->(c:CodeFile)
  WHERE p.key IN $products
  OPTIONAL MATCH (o:Person)-[:OWNS]->(c)
  RETURN f.key AS feature, c.id AS id, c.path AS path, coalesce(c.repo, '') AS repo,
         coalesce(o.id, '') AS ownerId, coalesce(o.name, '') AS ownerName`);

export const H7B_PRODUCT_CODE_CONTENT = query("H7b", "What each file read from the given products' repos defines, with its embedding", `
  MATCH (p:Product)-[:HAS_REPO]->(r:Repo)
  WHERE p.key IN $products
  MATCH (c:CodeFile {repo: r.id})
  WHERE c.outline IS NOT NULL
  RETURN c.id AS id, c.path AS path, c.repo AS repo, coalesce(c.symbols, []) AS symbols, coalesce(c.routes, []) AS routes,
         c.outline AS outline, c.embedding AS embedding`);

export const H8_PRODUCT_IMPORTS = query("H8", "Imports between the given products' files", `
  MATCH (p:Product)-[:HAS_FEATURE]->(:Feature)-[:IMPLEMENTED_IN]->(a:CodeFile)-[:IMPORTS]->(b:CodeFile)
  WHERE p.key IN $products
  RETURN DISTINCT a.id AS from, b.id AS to`);

export const H9_FEATURE_DETAILS = query("H9", "Features of a product with files and owners", `
  MATCH (:Product {key: $product})-[:HAS_FEATURE]->(f:Feature)
  OPTIONAL MATCH (f)-[:IMPLEMENTED_IN]->(c:CodeFile)
  OPTIONAL MATCH (o:Person)-[:OWNS]->(c)
  RETURN f.key AS key, f.name AS name, coalesce(f.description, '') AS description,
         count(DISTINCT c) AS files, collect(DISTINCT o.name) AS owners
  ORDER BY name`);

// ─── Staff, SLA policies, clients ────────────────────────────────────────────

export const H24_STAFF_ENSURE = query("H24", "Staff accounts: create missing ones, update names and roles, never touch a password", `
  UNWIND $staff AS s
  MERGE (n:Staff {id: s.id})
    ON CREATE SET n.passwordHash = s.passwordHash
  SET n.name = s.name, n.email = s.email, n.role = s.role, n.title = s.title`);

export const H11_STAFF_BY_EMAIL = query("H11", "A staff member by email (for login)", `
  MATCH (s:Staff {email: $email})
  RETURN s.id AS id, s.name AS name, s.email AS email, s.role AS role, coalesce(s.title, '') AS title, s.passwordHash AS passwordHash`);

export const H23_STAFF_EXISTS = query("H23", "Is this staff account still there (a session outlives a reset)", `
  MATCH (s:Staff {id: $id})
  RETURN s.id AS id`);

export const H12_STAFF = query("H12", "Staff with the clients assigned to them", `
  MATCH (s:Staff)
  OPTIONAL MATCH (c:Client)-[:ASSIGNED_AGENT]->(s)
  RETURN s.id AS id, s.name AS name, s.email AS email, s.role AS role, coalesce(s.title, '') AS title, collect(c.id) AS clients
  ORDER BY name`);

export const H13_SLA_SEED = query("H13", "SLA policy per plan", `
  UNWIND $policies AS p
  MERGE (n:SlaPolicy {plan: p.plan})
  SET n.firstResponseMins = p.firstResponseMins, n.resolveMins = p.resolveMins`);

export const H14_SLA_POLICIES = query("H14", "SLA policies", `
  MATCH (p:SlaPolicy)
  RETURN p.plan AS plan, p.firstResponseMins AS firstResponseMins, p.resolveMins AS resolveMins
  ORDER BY firstResponseMins`);

export const H15_CLIENT_UPSERT = query("H15", "Create or update a client in the registry", `
  MERGE (c:Client {id: $id})
    ON CREATE SET c.createdAt = $ts
  SET c.name = $name, c.type = $type, c.plan = $plan, c.city = $city, c.aliases = coalesce($aliases, c.aliases, [])`);

export const H21_SEED_VERSION = query("H21", "Which version of the demo data HQ was seeded with", `
  OPTIONAL MATCH (v:SeedVersion)
  RETURN coalesce(v.version, 0) AS version`);

export const H22_MARK_SEED_VERSION = query("H22", "Remember the demo data version", `
  MERGE (v:SeedVersion {id: 'demo'})
  SET v.version = $version`);

export const H16_CLIENT_PRODUCTS = query("H16", "Set which products a client uses", `
  MATCH (c:Client {id: $id})
  OPTIONAL MATCH (c)-[u:USES]->(:Product)
  DELETE u
  WITH DISTINCT c
  UNWIND $products AS key
  MATCH (p:Product {key: key})
  MERGE (c)-[:USES]->(p)`);

export const H17_CLIENT_AGENT = query("H17", "Assign a support agent to a client", `
  MATCH (c:Client {id: $id})
  OPTIONAL MATCH (c)-[a:ASSIGNED_AGENT]->(:Staff)
  DELETE a
  WITH DISTINCT c
  MATCH (s:Staff {id: $agentId})
  MERGE (c)-[:ASSIGNED_AGENT]->(s)`);

export const H18_CLIENTS = query("H18", "The client registry with products and assigned agent", `
  MATCH (c:Client)
  OPTIONAL MATCH (c)-[:USES]->(p:Product)
  WITH c, collect(p.key) AS products
  OPTIONAL MATCH (c)-[:ASSIGNED_AGENT]->(s:Staff)
  WITH c, products, s
  OPTIONAL MATCH (c)-[:DEPLOYED_AS]->(d:Deployment)
  RETURN c.id AS id, c.name AS name, c.type AS type, c.plan AS plan, coalesce(c.city, '') AS city,
         products, coalesce(s.id, '') AS agentId, coalesce(s.name, '') AS agentName, coalesce(c.aliases, []) AS aliases,
         collect(CASE WHEN d IS NULL THEN null ELSE {product: d.product, repo: d.repo, branch: d.branch, tenancy: d.tenancy} END) AS deployments
  ORDER BY name`);

export const HD1_SET_DEPLOYMENTS = query("HD1", "Replace where a client runs: product, repository, branch and kind of tenancy", `
  MATCH (c:Client {id: $id})
  OPTIONAL MATCH (c)-[:DEPLOYED_AS]->(old:Deployment)
  DETACH DELETE old
  WITH DISTINCT c
  UNWIND $deployments AS d
  CREATE (c)-[:DEPLOYED_AS]->(:Deployment {id: c.id + ':' + d.product + ':' + d.repo, product: d.product, repo: d.repo, branch: d.branch, tenancy: d.tenancy})`);

export const HD2_DEPLOYMENTS_ON_REPO = query("HD2", "The clients deployed from a repository (and from which branch)", `
  MATCH (c:Client)-[:DEPLOYED_AS]->(d:Deployment {repo: $repo})
  RETURN c.id AS clientId, c.name AS clientName, d.branch AS branch, d.tenancy AS tenancy`);

export const HD4_CLIENT_DEPLOYMENTS = query("HD4", "Where one client runs", `
  MATCH (:Client {id: $clientId})-[:DEPLOYED_AS]->(d:Deployment)
  RETURN d.product AS product, d.repo AS repo, d.branch AS branch, d.tenancy AS tenancy`);

export const HD3_ALL_DEPLOYMENTS = query("HD3", "Every deployment, for the products page", `
  MATCH (c:Client)-[:DEPLOYED_AS]->(d:Deployment)
  RETURN c.id AS clientId, c.name AS clientName, d.product AS product, d.repo AS repo, d.branch AS branch, d.tenancy AS tenancy
  ORDER BY repo, clientName`);

export const H19_CLIENT_DELETE = query("H19", "Remove a client from the registry", `
  MATCH (c:Client {id: $id})
  DETACH DELETE c`);

// ─── Cross-client signals and patterns ───────────────────────────────────────

export const X1_SIGNAL_UPSERT = query("X1", "Record that a client has a ticket on a feature (abstract: no messages, no people)", `
  MERGE (s:Signal {id: $id})
    ON CREATE SET s.createdAt = $ts
  SET s.clientId = $clientId, s.featureKey = $featureKey, s.severity = $severity, s.status = $status,
      s.title = $title, s.updatedAt = $ts, s.embedding = vecf32($embedding)
  WITH s
  OPTIONAL MATCH (f:Feature {key: $featureKey})
  WITH s, f WHERE f IS NOT NULL
  MERGE (s)-[:ABOUT]->(f)`);

export const X2_SIGNAL_STATUS = query("X2", "Update a signal's status", `
  MATCH (s:Signal {id: $id})
  SET s.status = $status, s.updatedAt = $ts`);

export const X3_SIMILAR_SIGNALS = query("X3", "Signals from OTHER clients on the same feature that read alike (vector index)", `
  MATCH (me:Signal {id: $id})
  CALL db.idx.vector.queryNodes('Signal', 'embedding', 12, me.embedding)
  YIELD node, score
  WHERE node.id <> me.id AND node.clientId <> me.clientId AND node.featureKey = me.featureKey
  RETURN node.id AS id, score AS distance`);

export const X4_LINK_SIGNALS = query("X4", "Mark two signals as the same kind of problem", `
  MATCH (a:Signal {id: $a}), (b:Signal {id: $b})
  MERGE (a)-[r:SIMILAR_TO]->(b)
  SET r.score = $score`);

export const X5_SIGNAL_CLUSTER = query("X5", "The cluster a signal belongs to (WCC over SIMILAR_TO)", `
  CALL algo.WCC({nodeLabels: ['Signal'], relationshipTypes: ['SIMILAR_TO']})
  YIELD node, componentId
  WITH componentId, collect(node) AS signals
  WHERE size(signals) > 1 AND any(x IN signals WHERE x.id = $id)
  UNWIND signals AS s
  RETURN s.id AS id, s.clientId AS clientId, s.title AS title, s.featureKey AS featureKey, s.createdAt AS createdAt
  ORDER BY createdAt`);

export const X6_PATTERN_UPSERT = query("X6", "Create or extend a cross-client pattern", `
  MERGE (p:Pattern {id: $id})
    ON CREATE SET p.createdAt = $ts, p.title = $title, p.featureKey = $featureKey
  SET p.updatedAt = $ts
  WITH p
  UNWIND $signalIds AS signalId
  MATCH (s:Signal {id: signalId})
  MERGE (s)-[:PART_OF]->(p)`);

export const X7_PATTERNS = query("X7", "Every pattern with its signals (for staff in HQ)", `
  MATCH (s:Signal)-[:PART_OF]->(p:Pattern)
  WITH p, collect({issueId: s.id, clientId: s.clientId, status: s.status, severity: s.severity, title: s.title, createdAt: s.createdAt}) AS signals
  OPTIONAL MATCH (f:Feature {key: p.featureKey})
  OPTIONAL MATCH (pr:PullRequest)-[:FIXES]->(:Signal)-[:PART_OF]->(p)
  RETURN p.id AS id, p.title AS title, p.featureKey AS featureKey, coalesce(f.name, '') AS feature,
         coalesce(f.product, '') AS product, p.createdAt AS createdAt, p.updatedAt AS updatedAt, signals,
         collect(DISTINCT {number: pr.number, title: pr.title, url: pr.url, state: pr.state}) AS pullRequests
  ORDER BY updatedAt DESC`);

export const X8_PATTERN_FOR_TICKET = query("X8", "The pattern a ticket is part of, as counts only (safe to show inside a client)", `
  MATCH (:Signal {id: $id})-[:PART_OF]->(p:Pattern)<-[:PART_OF]-(o:Signal)
  WHERE o.clientId <> $clientId
  WITH p, count(DISTINCT o.clientId) AS otherClients, collect(DISTINCT o.status) AS statuses
  OPTIONAL MATCH (pr:PullRequest)-[:FIXES]->(:Signal)-[:PART_OF]->(p)
  RETURN p.id AS id, p.title AS title, otherClients, statuses,
         collect(DISTINCT {number: pr.number, title: pr.title, url: pr.url, state: pr.state}) AS pullRequests`);

export const X9_PATTERN_MEMBERS = query("X9", "Every ticket in the same pattern as a ticket (for broadcasting a fix)", `
  MATCH (:Signal {id: $id})-[:PART_OF]->(p:Pattern)<-[:PART_OF]-(s:Signal)
  RETURN DISTINCT s.id AS issueId, s.clientId AS clientId`);

export const X10_SIGNAL = query("X10", "Which client a ticket belongs to", `
  MATCH (s:Signal {id: $id})
  RETURN s.id AS issueId, s.clientId AS clientId, coalesce(s.githubRepo, '') AS githubRepo, coalesce(s.githubNumber, 0) AS githubNumber`);

export const X11_SIGNAL_GITHUB = query("X11", "Remember the GitHub issue that tracks a ticket", `
  MATCH (s:Signal {id: $id})
  SET s.githubRepo = $repo, s.githubNumber = $number`);

export const X12_SIGNAL_BY_GITHUB = query("X12", "Find the ticket behind a GitHub issue number", `
  MATCH (s:Signal {githubRepo: $repo, githubNumber: $number})
  RETURN s.id AS issueId, s.clientId AS clientId`);

export const X13_PR_FIXES = query("X13", "A pull request fixes a ticket", `
  MATCH (pr:PullRequest {id: $prId}), (s:Signal {id: $issueId})
  MERGE (pr)-[:FIXES]->(s)`);

export const X14_CLIENT_SIGNALS_RESET = query("X14", "Forget one client's signals (when its graph is reset or deleted), and patterns no longer shared", `
  MATCH (s:Signal {clientId: $clientId})
  DETACH DELETE s
  WITH count(*) AS removed
  MATCH (p:Pattern)
  OPTIONAL MATCH (p)<-[:PART_OF]-(o:Signal)
  WITH p, count(DISTINCT o.clientId) AS clients
  WHERE clients < 2
  DETACH DELETE p`);

// ─── GitHub (repos belong to products) ───────────────────────────────────────

export const HG1_REPO = query("HG1", "Connect a repository to a product", `
  MERGE (r:Repo {id: $id})
    ON CREATE SET r.createdAt = $ts
  SET r.url = $url, r.defaultBranch = $defaultBranch
  WITH r
  MATCH (p:Product {key: $product})
  MERGE (p)-[:HAS_REPO]->(r)`);

export const HG2_REPOS = query("HG2", "Connected repositories with their product and activity", `
  MATCH (p:Product)-[:HAS_REPO]->(r:Repo)
  OPTIONAL MATCH (c:CodeFile {repo: r.id})
  WITH p, r, count(c) AS files
  OPTIONAL MATCH (pr:PullRequest {repo: r.id})
  WITH p, r, files, count(pr) AS pullRequests
  OPTIONAL MATCH (cm:Commit {repo: r.id})
  RETURN r.id AS id, r.url AS url, r.defaultBranch AS defaultBranch, p.key AS product, p.name AS productName,
         coalesce(r.indexedAt, 0) AS indexedAt, coalesce(r.syncedAt, 0) AS syncedAt,
         coalesce(r.featureSource, '') AS featureSource, files, pullRequests, count(cm) AS commits
  ORDER BY id`);

export const HG6_REPO_CODE_READ = query("HG6", "How many files of each repository have been read and embedded", `
  MATCH (c:CodeFile)
  WHERE c.outline IS NOT NULL
  RETURN c.repo AS repo, count(c) AS read`);

export const HG7_WEBHOOK_DELIVERY = query("HG7", "GitHub delivered a webhook for a repository (or it was refused)", `
  MERGE (w:WebhookDelivery {repo: $repo})
  SET w.lastAt = $ts, w.lastEvent = $event, w.lastError = $error, w.count = coalesce(w.count, 0) + 1`);

export const HG8_WEBHOOK_DELIVERIES = query("HG8", "The latest webhook delivery per repository", `
  MATCH (w:WebhookDelivery)
  RETURN w.repo AS repo, w.lastAt AS lastAt, w.lastEvent AS lastEvent, coalesce(w.lastError, '') AS lastError, w.count AS count`);

export const HG3_LINK_FEATURES_TO_PRODUCT = query("HG3", "Features found in a product's repo belong to that product", `
  MATCH (p:Product {key: $product})
  UNWIND $keys AS key
  MATCH (f:Feature {key: key})
  SET f.product = $product
  MERGE (p)-[:HAS_FEATURE]->(f)`);

export const HG4_REMOVE_REPO = query("HG4", "Disconnect a repository and forget its files", `
  OPTIONAL MATCH (c:CodeFile {repo: $id})
  DETACH DELETE c
  WITH count(*) AS removed
  MATCH (r:Repo {id: $id})
  DETACH DELETE r`);

export const HG5_PRODUCT_OF_REPO = query("HG5", "Which product a repository belongs to", `
  MATCH (p:Product)-[:HAS_REPO]->(:Repo {id: $id})
  RETURN p.key AS product`);

export const H20_ALL_FEATURES = query("H20", "Every feature with the product it belongs to (for analytics labels)", `
  MATCH (p:Product)-[:HAS_FEATURE]->(f:Feature)
  RETURN f.key AS key, f.name AS name, p.key AS product`);

// ─── WhatsApp groups (Cloud API) ─────────────────────────────────────────────

export const HW1_SEEN_GROUP = query("HW1", "Remember a WhatsApp group the support number is in", `
  MERGE (w:WaGroup {id: $id})
    ON CREATE SET w.firstSeen = $ts, w.clientId = null, w.groupId = null
  SET w.lastSeen = $ts, w.name = coalesce($name, w.name)`);

export const HW2_LINK_GROUP = query("HW2", "Link a WhatsApp group to a client's group", `
  MERGE (w:WaGroup {id: $id})
    ON CREATE SET w.firstSeen = $ts
  SET w.clientId = $clientId, w.groupId = $groupId, w.name = coalesce($name, w.name), w.inviteLink = coalesce($inviteLink, w.inviteLink)`);

export const HW3_GROUP = query("HW3", "Which client a WhatsApp group belongs to", `
  MATCH (w:WaGroup {id: $id})
  RETURN w.clientId AS clientId, w.groupId AS groupId`);

export const HW4_GROUPS = query("HW4", "Every WhatsApp group the support number is in, linked or not", `
  MATCH (w:WaGroup)
  RETURN w.id AS id, coalesce(w.name, '') AS name, coalesce(w.clientId, '') AS clientId, coalesce(w.groupId, '') AS groupId,
         coalesce(w.inviteLink, '') AS inviteLink, coalesce(w.lastSeen, 0) AS lastSeen
  ORDER BY lastSeen DESC`);

export const HW5_GROUP_OF_CLIENT = query("HW5", "A client's WhatsApp group (for sending replies)", `
  MATCH (w:WaGroup {clientId: $clientId})
  RETURN w.id AS id, w.groupId AS groupId
  LIMIT 1`);
