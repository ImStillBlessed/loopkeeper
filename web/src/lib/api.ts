/** Typed calls to the Loopkeeper API. Shapes mirror the RETURN aliases in src/graph/queries.ts. */

export type MessageType = "bug" | "feature_request" | "question" | "promise" | "resolution" | "status_update" | "decision";

export interface FeedMessage {
  id: string;
  groupId: string;
  ts: string;
  senderName: string;
  text: string;
  hasMedia: boolean;
  relevant: boolean;
  type?: MessageType;
}

export type PipelineEvent =
  | { kind: "message"; message: FeedMessage }
  | { kind: "activity"; text: string; issueId?: string; ts: string; source?: "chat" | "github" }
  | { kind: "bot"; text: string; ts: string; groupId?: string }
  | { kind: "stats"; seen: number; ignored: number; used: number }
  | { kind: "live"; running: boolean; clock: number; groupId?: string }
  | { kind: "run"; state: "started" | "finished" | "stopped" | "failed"; error?: string };

export interface AppStatus {
  hasApiKey: boolean;
  githubConfigured: boolean;
  defaultProject: string;
}

export interface Project {
  id: string;
  name: string;
  seen: number;
  groups: number;
  repos: number;
}

export interface Stats {
  seen: number;
  ignored: number;
  used: number;
  clock: number;
  live: boolean;
  liveGroupId: string | null;
}

export type GroupSource = "simulator" | "whatsapp_export" | "wa_cloud";

export interface Group {
  id: string;
  name: string;
  source: GroupSource;
  seen: number;
  used: number;
  lastMessageAt: number;
}

export interface Repo {
  id: string;
  url: string;
  defaultBranch: string;
  indexedAt: number;
  syncedAt: number;
  featureSource: string;
  files: number;
  pullRequests: number;
  commits: number;
}

export interface SecretSetting {
  configured: boolean;
  source: "app" | "env" | null;
  hint: string | null;
}

export interface Settings {
  groqApiKey: SecretSetting;
  githubToken: SecretSetting;
  githubWebhookSecret: SecretSetting;
  fastModel: string;
  smartModel: string;
}

export interface CastMember {
  key: string;
  name: string;
  role: string;
}

export interface BoardIssue {
  id: string;
  title: string;
  kind: string;
  status: string;
  severity: string;
  /** '' when no feature. */
  feature: string;
  updatedAt: number;
  messages: number;
  schools: string[];
  merged: number;
  /** '' when nobody is assigned. */
  owner: string;
  priorityRank: number | null;
}

export interface IssueDetail {
  issue: {
    id: string;
    title: string;
    summary: string;
    kind: string;
    status: string;
    severity: string;
    createdAt: number;
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
  messages: Array<{ id: string; text: string; ts: number; hasMedia: boolean; kind: string; sender: string; school: string | null }>;
  history: Array<{ from: string; to: string; at: number; confidence: number; by: string; messageId: string | null; because: string | null }>;
  impact: Array<{ schoolId: string; school: string; hasReported: boolean }>;
  dependentCode: Array<{ file: string; feature: string | null }>;
}

export interface FollowUpsResponse {
  now: number;
  followUps: Array<{ id: string; text: string; dueAt: number; status: string; owner: string; issue: string | null; sourceMessage: string | null }>;
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
}

/** One question and its answer inside an Ask conversation. */
export interface Turn {
  id: string;
  question: string;
  askedAt: number;
  answer: Answer;
}

/** An Ask conversation, remembered in the project's graph. */
export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
}

export type PreparedKind = "issue" | "greeting" | "question" | "promise" | "fixed";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** App-level calls: settings and the list of projects. */
export const appApi = {
  status: () => request<AppStatus>("/status"),
  settings: () => request<Settings>("/settings"),
  saveSettings: (changes: Partial<Record<"groqApiKey" | "githubToken" | "githubWebhookSecret" | "fastModel" | "smartModel", string>>) =>
    send<Settings>("PUT", "/settings", changes),
  projects: () => request<Project[]>("/projects"),
  createProject: (name: string, firstGroup?: { name: string; source: GroupSource }) => send<Project>("POST", "/projects", { name, firstGroup }),
  renameProject: (id: string, name: string) => send("PATCH", `/projects/${id}`, { name }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: "DELETE" }),
};

/** Everything inside one project. */
export function projectApi(project: string) {
  const p = `/projects/${project}`;
  return {
    stats: () => request<Stats>(`${p}/stats`),
    board: () => request<BoardIssue[]>(`${p}/board`),
    issue: (id: string) => request<IssueDetail>(`${p}/issues/${id}`),
    setStatus: (id: string, to: string) => send("POST", `${p}/issues/${id}/status`, { to }),
    openGithubIssue: (id: string) => send<{ number: number; url: string }>("POST", `${p}/issues/${id}/github`),
    followUps: () => request<FollowUpsResponse>(`${p}/followups`),
    graph: () => request<GraphData>(`${p}/graph`),
    ask: (question: string, conversationId?: string) =>
      send<{ conversationId: string; title: string; turn: Turn }>("POST", `${p}/ask`, { question, conversationId }),
    conversations: () => request<ConversationSummary[]>(`${p}/conversations`),
    conversation: (id: string) => request<{ id: string; title: string; turns: Turn[] }>(`${p}/conversations/${id}`),
    deleteConversation: (id: string) => request(`${p}/conversations/${id}`, { method: "DELETE" }),
    reset: () => send("POST", `${p}/reset`),

    groups: () => request<Group[]>(`${p}/groups`),
    addGroup: (name: string, source: GroupSource) => send<{ id: string }>("POST", `${p}/groups`, { name, source }),
    renameGroup: (id: string, name: string) => send("PATCH", `${p}/groups/${id}`, { name }),
    removeGroup: (id: string) => request(`${p}/groups/${id}`, { method: "DELETE" }),
    importExport: (groupId: string, text: string) => request<{ messages: number }>(`${p}/groups/${groupId}/import`, { method: "POST", body: text }),
    people: () => request<{ cast: CastMember[] }>(`${p}/people`),

    goLive: (groupId?: string, paceMs?: number) => send<Stats>("POST", `${p}/live/start`, { groupId, paceMs }),
    pause: () => send<Stats>("POST", `${p}/live/stop`),
    say: (groupId: string | undefined, sender: string, text: string) => send("POST", `${p}/live/send`, { groupId, sender, text }),
    sendPrepared: (groupId: string | undefined, kind: PreparedKind, sender?: string) => send("POST", `${p}/live/send`, { groupId, kind, sender }),
    playStory: (groupId: string | undefined, scenario: string) => send("POST", `${p}/live/story`, { groupId, scenario }),
    advanceClock: (hours: number) => send<Stats>("POST", `${p}/clock/advance`, { hours }),

    repos: () => request<{ githubConfigured: boolean; lastError: string | null; repos: Repo[] }>(`${p}/repos`),
    connectRepo: (repo: string) => send<{ repo: string; files: number; features: number; owners: number; featureSource: string }>("POST", `${p}/repos`, { repo }),
    removeRepo: (repo: string) => request(`${p}/repos/${repo}`, { method: "DELETE" }),
    syncRepos: () => send("POST", `${p}/repos/sync`),

    events: (onEvent: (event: PipelineEvent) => void) => {
      const source = new EventSource(`/api${p}/events`);
      source.onmessage = (message) => onEvent(JSON.parse(message.data));
      return () => source.close();
    },
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;
