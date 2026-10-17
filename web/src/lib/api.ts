/** Typed calls to the support desk API. Shapes mirror the RETURN aliases in src/graph/*queries.ts. */

// ─── Shared shapes ───────────────────────────────────────────────────────────

export type Role = "admin" | "lead" | "agent" | "developer" | "demo";
export type Plan = "premium" | "standard";
export type ClientType = "school" | "lecture_centre";
export type Sentiment = "calm" | "concerned" | "frustrated";
export type MessageType = "bug" | "feature_request" | "question" | "promise" | "resolution" | "status_update" | "decision";
export type TicketStatus = "open" | "in_progress" | "possibly_resolved" | "resolved";
export type SlaState = "on_track" | "due_soon" | "breached" | "met" | "missed";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Their job, e.g. "Tech lead". */
  title: string;
}

export interface FeedMessage {
  id: string;
  groupId: string;
  ts: string;
  senderName: string;
  text: string;
  hasMedia: boolean;
  relevant: boolean;
  type?: MessageType;
  sentiment?: Sentiment;
}

export type DeskEvent = (
  | { kind: "message"; message: FeedMessage }
  | { kind: "activity"; text: string; issueId?: string; ts: string; source?: "chat" | "github" }
  | { kind: "bot"; text: string; ts: string; groupId?: string }
  | { kind: "stats"; seen: number; ignored: number; used: number }
  | { kind: "live"; running: boolean; clock: number }
  | { kind: "run"; state: "started" | "finished" | "stopped" | "failed"; error?: string; at?: number }
  | { kind: "hub"; entry: HubEntry }
  | { kind: "import"; progress: ImportProgress }
) & { clientId?: string };

/** An exported hub chat being imported in the background. */
export interface ImportProgress {
  state: "running" | "done" | "stopped" | "failed";
  total: number;
  done: number;
  skipped: number;
  routed: number;
  pending: number;
  ignored: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export type Tenancy = "own_repo" | "branch" | "multi_tenant";

/** Where a client's product runs: its own repo, its branch of a shared repo, or a tenant of the multi-tenant platform. */
export interface Deployment {
  product: string;
  repo: string;
  branch: string | null;
  tenancy: Tenancy;
}

export interface ClientRecord {
  id: string;
  name: string;
  type: ClientType;
  plan: Plan;
  city: string;
  products: string[];
  agentId: string;
  agentName: string;
  aliases: string[];
  deployments: Deployment[];
}

/** A message in the central support hub and where it went. */
export interface HubEntry {
  id: string;
  ts: number;
  sender: string;
  text: string;
  status: "routed" | "pending" | "ignored";
  clientIds: string[];
  method: "named" | "contact" | "thread" | "model" | "manual" | "";
  reason: string;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
  clientId: string;
  groupId: string;
  inviteLink: string;
  lastSeen: number;
}

export interface TeamNote {
  id: string;
  text: string;
  by: string;
  role: string;
  ts: number;
}

export interface Health {
  score: number;
  band: "healthy" | "watch" | "at_risk";
  reasons: Array<{ text: string; points: number }>;
}

export interface ClientSummary extends ClientRecord {
  health: Health;
  openTickets: number;
  breached: number;
  seen: number;
  ignored: number;
  lastMessageAt: number;
}

export interface SlaPolicy {
  plan: Plan;
  firstResponseMins: number;
  resolveMins: number;
}

export interface Sla {
  state: SlaState;
  stage: "response" | "resolution";
  dueAt: number;
  firstResponseDue: number;
  resolveDue: number;
}

export interface Ticket {
  id: string;
  title: string;
  kind: string;
  status: TicketStatus | "merged";
  severity: string;
  feature: string;
  createdAt: number;
  updatedAt: number;
  firstResponseAt: number;
  resolvedAt: number;
  messages: number;
  merged: number;
  owner: string;
  escalated: boolean;
  moods: Sentiment[];
  clientId: string;
  clientName: string;
  plan: Plan;
  sla: Sla;
}

export interface PatternSummary {
  id: string;
  title: string;
  clients: number;
  statuses: string[];
  affected: string[];
  pullRequests: string[];
}

export interface Overview {
  now: number;
  kpis: { openTickets: number; breached: number; dueSoon: number; escalated: number; atRisk: number; frustrated: number; sharedProblems: number };
  attention: Ticket[];
  clients: ClientSummary[];
  patterns: PatternSummary[];
}

export interface Pattern {
  id: string;
  title: string;
  feature: string;
  featureKey: string;
  product: string;
  createdAt: number;
  updatedAt: number;
  clients: number;
  signals: Array<{ issueId: string; clientId: string; clientName: string; status: string; severity: string; title: string; createdAt: number }>;
  pullRequests: Array<{ number: number; title: string; url: string; state: string }>;
}

export interface Analytics {
  from: number;
  to: number;
  daily: Array<{ day: number; opened: number; resolved: number }>;
  totals: { opened: number; resolved: number; open: number };
  medianFirstResponseMins: number | null;
  medianResolveHours: number | null;
  slaCompliance: number | null;
  byFeature: Array<{ label: string; value: number }>;
  byClient: Array<{ label: string; value: number }>;
  byKind: Array<{ label: string; value: number }>;
}

export interface Product {
  key: string;
  name: string;
  description: string;
  repos: string[];
  features: number;
  clients: string[];
}

export interface Feature {
  key: string;
  name: string;
  description: string;
  files: number;
  owners: string[];
}

export interface Repo {
  id: string;
  url: string;
  defaultBranch: string;
  product: string;
  productName: string;
  indexedAt: number;
  syncedAt: number;
  featureSource: string;
  files: number;
  pullRequests: number;
  commits: number;
}

export type CheckState = "ok" | "warn" | "fail";

/** Is a repository really connected: access, issues, webhook and code, each with what to do. */
export interface RepoHealth {
  repo: string;
  product: string | null;
  clients: string[];
  deployedProducts: string[];
  access: { state: CheckState; text: string };
  issues: { state: CheckState; text: string };
  webhook: { state: CheckState; text: string };
  code: { state: CheckState; text: string };
}

/** One FalkorDB query as it ran (see the Database page). */
export interface QueryRun {
  seq: number;
  id: string;
  title: string;
  graph: string;
  ts: number;
  engineMs: number;
  totalMs: number;
  rows: number;
  writes: Record<string, number>;
  cached: boolean;
  vector: boolean;
  error?: string;
}

export interface DbGraph {
  name: string;
  kind: "hq" | "client" | "hub" | "desk";
  title: string;
  holds: string;
  nodes: number;
  relationships: number;
  labels: Array<{ label: string; count: number }>;
  relationshipTypes: Array<{ type: string; count: number }>;
  indexes: Array<{ label: string; property: string; type: string; entity: string; status: string; options: Record<string, unknown> }>;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  clients: string[];
}

export interface Group {
  id: string;
  name: string;
  source: "simulator" | "whatsapp_export" | "wa_cloud";
  seen: number;
  used: number;
  lastMessageAt: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  schoolId: string | null;
  school: string | null;
}

export interface StoredMessage {
  id: string;
  groupId: string;
  ts: number;
  senderName: string;
  text: string;
  hasMedia: boolean;
  type: MessageType;
  sentiment: Sentiment;
  evidence: Array<{ kind: string; issueId: string; title: string }>;
}

export interface TicketDetail {
  issue: {
    id: string;
    title: string;
    summary: string;
    kind: string;
    status: TicketStatus;
    severity: string;
    createdAt: number;
    feature: string;
    firstResponseAt: number;
    resolvedAt: number;
    escalated: boolean;
    escalationNote: string;
    escalatedBy: string;
    mergedTitles: string[];
    followUps: string[];
  };
  code: { feature: string; featureKey: string; files: string[]; codeOwners: string[]; assignee: string } | undefined;
  github:
    | {
        githubRepo: string;
        githubNumber: number;
        githubUrl: string;
        pullRequests: Array<{ number: number; title: string; url: string; state: string; author: string }>;
        commits: Array<{ sha: string; message: string; url: string; author: string; ts: number }>;
      }
    | undefined;
  pattern: { id: string; title: string; otherClients: number; statuses: string[]; pullRequests: Array<{ number: number | null; title: string; url: string; state: string }> } | null;
  messages: Array<{ id: string; text: string; ts: number; hasMedia: boolean; kind: string; sentiment: Sentiment | ""; sender: string; school: string | null }>;
  history: Array<{ from: string; to: string; at: number; confidence: number; by: string; messageId: string | null; because: string | null }>;
  impact: Array<{ schoolId: string; school: string; hasReported: boolean }>;
  dependentCode: Array<{ file: string; feature: string | null }>;
  /** Where the problem most likely lives, found by the model reading the code. */
  likelyCode: Array<{ path: string; repo: string; functions: string[]; why: string; confidence: number; readSource: boolean }>;
}

export interface FollowUps {
  now: number;
  followUps: Array<{ id: string; text: string; dueAt: number; status: string; owner: string; issueId: string | null; issue: string | null; sourceMessage: string | null }>;
  reminders: Array<{ id: string; kind: string; sentAt: number; text: string; followUp: string; to: string }>;
  decisions: Array<{ id: string; text: string; ts: number; by: string; messageId: string; feature: string | null }>;
}

export interface GraphData {
  nodes: Array<{ id: string; label: string; name: string; status: string | null }>;
  links: Array<{ source: string; target: string; type: string }>;
}

export interface Answer {
  answer: string;
  sources: Array<{ messageId: string; sender: string; ts: string; excerpt: string }>;
  graphPath: { nodeIds: string[] };
  queriesRun: Array<{ id: string; title: string; cypher: string }>;
  toolCalls: Array<{ tool: string; args: unknown }>;
  /** What the AI stored in the graph from this turn. */
  remembered?: string[];
}

export interface Turn {
  id: string;
  question: string;
  askedAt: number;
  /** Who asked (or added) it. */
  askedBy?: string;
  /** A question with the agent's answer, or information someone added to the graph. */
  kind?: "question" | "note";
  answer: Answer;
}

export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
  createdBy: string;
  lastBy: string;
  clientIds: string[];
}

/** A conversation in the shared list: "hq" for across clients, else the client's id. */
export interface SharedConversation extends ConversationSummary {
  scope: string;
  scopeName: string;
}

export interface SecretSetting {
  configured: boolean;
  source: "app" | "env" | null;
  hint: string | null;
}

export interface Settings {
  anthropicApiKey: SecretSetting;
  githubToken: SecretSetting;
  githubWebhookSecret: SecretSetting;
  fastModel: string;
  smartModel: string;
  anthropicWorkspaceId: string;
  whatsappAccessToken: SecretSetting;
  whatsappAppSecret: SecretSetting;
  whatsappVerifyToken: SecretSetting;
  whatsappPhoneNumberId: string;
  whatsappHubGroupId: string;
}

/** Where a simulated teacher's problem stands, from the school's side. */
export type TeacherCaseState = "waiting_reply" | "waiting_fix" | "checking" | "settled";

/** The demo school: its teachers (played by the model) and what each is waiting on. */
export interface TeachersView {
  running: boolean;
  teachers: Array<{ key: string; name: string; job: string }>;
  cases: Array<{
    problemId: string;
    teacher: string;
    kind: "bug" | "question" | "feature_request";
    situation: string;
    state: TeacherCaseState;
    ticketId: string | null;
    ticketTitle: string | null;
    reportedAt: number;
  }>;
  next: { teacher: string; situation: string } | null;
  remaining: number;
}

export interface ClientInput {
  name: string;
  type: ClientType;
  plan: Plan;
  city: string;
  products: string[];
  agentId: string;
  aliases?: string[];
  deployments?: Deployment[];
}

export type SettingKey =
  | "anthropicApiKey"
  | "githubToken"
  | "githubWebhookSecret"
  | "fastModel"
  | "smartModel"
  | "anthropicWorkspaceId"
  | "whatsappAccessToken"
  | "whatsappAppSecret"
  | "whatsappVerifyToken"
  | "whatsappPhoneNumberId"
  | "whatsappHubGroupId";

// ─── Transport ───────────────────────────────────────────────────────────────

/** Called when the server says the session ended, so the app can show the login screen. */
let onSignedOut: () => void = () => undefined;
export function whenSignedOut(callback: () => void): void {
  onSignedOut = callback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/auth/")) onSignedOut();
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

// ─── The API ─────────────────────────────────────────────────────────────────

export const api = {
  // Sign-in
  me: () => request<User>("/auth/me"),
  logIn: (email: string, password: string) => send<User>("POST", "/auth/login", { email, password }),
  logOut: () => send("POST", "/auth/logout"),
  demoAccounts: () => request<{ accounts: Array<{ name: string; email: string; role: Role; title: string; password: string }> }>("/auth/demo-accounts"),

  // The desk
  status: () => request<{ hasApiKey: boolean; githubConfigured: boolean; publicUrl: string }>("/status"),
  overview: () => request<Overview>("/overview"),
  tickets: () => request<Ticket[]>("/tickets"),
  clients: () => request<ClientSummary[]>("/clients"),
  patterns: () => request<Pattern[]>("/patterns"),
  analytics: (filter: { client?: string; product?: string } = {}) =>
    request<Analytics>(`/analytics?${new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as Array<[string, string]>)}`),
  askHq: (question: string, conversationId?: string) => send<{ conversationId: string; title: string; turn: Turn }>("POST", "/ask", { question, conversationId }),
  conversations: () => request<SharedConversation[]>("/ask/conversations"),
  hqConversation: (id: string) => request<{ id: string; title: string; turns: Turn[]; createdBy: string }>(`/ask/conversations/hq/${id}`),
  deleteHqConversation: (id: string) => request(`/ask/conversations/hq/${id}`, { method: "DELETE" }),

  // Live demo controls
  live: () => request<{ running: boolean; clock: number }>("/live"),
  goLive: () => send<{ running: boolean; clock: number }>("POST", "/live/start"),
  pause: () => send<{ running: boolean; clock: number }>("POST", "/live/stop"),
  advanceClock: (hours: number) => send<{ running: boolean; clock: number }>("POST", "/clock/advance", { hours }),
  startOver: () => send("POST", "/demo/start-over"),

  // HQ admin
  addClient: (input: ClientInput) => send<ClientRecord>("POST", "/clients", input),
  updateClient: (id: string, input: ClientInput) => send("PATCH", `/clients/${id}`, input),
  removeClient: (id: string) => request(`/clients/${id}`, { method: "DELETE" }),
  products: () => request<Product[]>("/products"),
  features: (product: string) => request<Feature[]>(`/products/${product}/features`),
  repos: () => request<{ githubConfigured: boolean; lastError: string | null; repos: Repo[] }>("/repos"),
  connectRepo: (repo: string, product: string) =>
    send<{ repo: string; files: number; read: number; features: number; owners: number; featureSource: string; health?: RepoHealth }>("POST", "/repos", { repo, product }),
  repoHealth: (refresh = false) => request<RepoHealth[]>(`/repos/health${refresh ? "?refresh=1" : ""}`),

  // The database (FalkorDB) at work
  database: () => request<{ graphs: DbGraph[] }>("/db"),
  queryText: (id: string) => request<{ id: string; title: string; cypher: string }>(`/db/queries/${id}`),
  queries: (onRun: (run: QueryRun) => void) => {
    const source = new EventSource("/api/db/queries");
    source.onmessage = (message) => onRun(JSON.parse(message.data));
    return () => source.close();
  },
  removeRepo: (repo: string) => request(`/repos/${repo}`, { method: "DELETE" }),
  syncRepos: () => send("POST", "/repos/sync"),
  staff: () => request<StaffMember[]>("/staff"),
  sla: () => request<SlaPolicy[]>("/sla"),
  settings: () => request<Settings>("/settings"),
  saveSettings: (changes: Partial<Record<SettingKey, string>>) =>
    send<Settings>("PUT", "/settings", changes),

  // The central support hub (leads, admins, developers)
  hub: () => request<{ entries: HubEntry[]; pending: number }>("/hub"),
  sayInHub: (sender: string, text: string) => send("POST", "/hub/send", { sender, text }),
  routeHubMessage: (id: string, clientIds: string[]) => send("POST", `/hub/${id}/assign`, { clientIds }),
  ignoreHubMessage: (id: string) => send("POST", `/hub/${id}/ignore`),
  importHub: (text: string) => request<ImportProgress>("/hub/import", { method: "POST", body: text }),
  hubImport: () => request<ImportProgress | null>("/hub/import"),
  stopHubImport: () => send("POST", "/hub/import/stop"),

  // WhatsApp (Cloud API) and where clients run
  whatsapp: () => request<{ configured: boolean; hubGroupId: string; groups: WhatsAppGroup[] }>("/whatsapp"),
  linkWhatsAppGroup: (waGroupId: string, clientId: string) => send("POST", `/whatsapp/groups/${waGroupId}/link`, { clientId }),
  useAsHub: (waGroupId: string) => send("POST", `/whatsapp/groups/${waGroupId}/hub`),
  deployments: () => request<Array<Deployment & { clientId: string; clientName: string }>>("/deployments"),

  /** The desk's live event stream: every client this person can see. */
  /**
   * The desk's event stream. After a dropped connection (e.g. the server restarted) the browser
   * reconnects and the server sends its history again, so `onReconnect` lets the caller start afresh.
   */
  events: (onEvent: (event: DeskEvent) => void, onReconnect?: () => void, withHistory = true) => {
    const source = new EventSource(`/api/events${withHistory ? "" : "?history=none"}`);
    let dropped = false;
    source.onerror = () => {
      dropped = true;
    };
    source.onopen = () => {
      if (dropped) onReconnect?.();
      dropped = false;
    };
    source.onmessage = (message) => onEvent(JSON.parse(message.data));
    return () => source.close();
  },
};

/** Everything inside one client. */
export function clientApi(client: string) {
  const c = `/clients/${client}`;
  return {
    summary: () => request<ClientSummary & { sla: SlaPolicy | null; now: number }>(`${c}/summary`),
    tickets: () => request<Ticket[]>(`${c}/tickets`),
    ticket: (id: string) => request<TicketDetail>(`${c}/issues/${id}`),
    setStatus: (id: string, to: TicketStatus) => send("POST", `${c}/issues/${id}/status`, { to }),
    assign: (id: string, personId: string) => send<{ owner: string }>("POST", `${c}/issues/${id}/assign`, { personId }),
    escalate: (id: string, note: string) => send("POST", `${c}/issues/${id}/escalate`, { note }),
    suggestReply: (id: string) => send<{ reply: string; why: string; source: "model" | "template" }>("POST", `${c}/issues/${id}/suggest-reply`),
    openGithubIssue: (id: string) => send<{ number: number; url: string }>("POST", `${c}/issues/${id}/github`),
    reply: (text: string) => send<{ sender: string; sentToWhatsApp: boolean }>("POST", `${c}/reply`, { text }),
    notes: (id: string) => request<TeamNote[]>(`${c}/issues/${id}/notes`),
    addNote: (id: string, text: string) => send("POST", `${c}/issues/${id}/notes`, { text }),
    createWhatsAppGroup: () => send<{ waGroupId: string; groupId: string; inviteLink: string | null }>("POST", `${c}/whatsapp/create`),
    feed: (limit = 200) => request<StoredMessage[]>(`${c}/feed?limit=${limit}`),
    followUps: () => request<FollowUps>(`${c}/followups`),
    graph: () => request<GraphData>(`${c}/graph`),
    people: () => request<{ people: Person[] }>(`${c}/people`),
    groups: () => request<Group[]>(`${c}/groups`),
    addGroup: (name: string, source: Group["source"]) => send<{ id: string }>("POST", `${c}/groups`, { name, source }),
    renameGroup: (id: string, name: string) => send("PATCH", `${c}/groups/${id}`, { name }),
    removeGroup: (id: string) => request(`${c}/groups/${id}`, { method: "DELETE" }),
    importExport: (groupId: string, text: string) => request<{ messages: number }>(`${c}/groups/${groupId}/import`, { method: "POST", body: text }),
    teachers: () => request<TeachersView>(`${c}/teachers`),
    raiseNextProblem: () => send<{ teacher: string }>("POST", `${c}/teachers/next`),
    reset: () => send("POST", `${c}/reset`),
    ask: (question: string, conversationId?: string) => send<{ conversationId: string; title: string; turn: Turn }>("POST", `${c}/ask`, { question, conversationId }),
    conversations: () => request<ConversationSummary[]>(`${c}/conversations`),
    conversation: (id: string) => request<{ id: string; title: string; turns: Turn[]; createdBy: string }>(`${c}/conversations/${id}`),
    deleteConversation: (id: string) => request(`${c}/conversations/${id}`, { method: "DELETE" }),
  };
}

export type ClientApi = ReturnType<typeof clientApi>;
