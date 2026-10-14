/** Typed calls to the Loopkeeper API. Shapes mirror the RETURN aliases in src/graph/queries.ts. */

export type MessageType = "bug" | "feature_request" | "question" | "promise" | "resolution" | "status_update" | "decision";

export interface FeedMessage {
  id: string;
  ts: string;
  senderName: string;
  text: string;
  hasMedia: boolean;
  relevant: boolean;
  type?: MessageType;
}

export type PipelineEvent =
  | { kind: "message"; message: FeedMessage }
  | { kind: "activity"; text: string; issueId?: string; ts: string }
  | { kind: "bot"; text: string; ts: string }
  | { kind: "stats"; seen: number; ignored: number; used: number }
  | { kind: "run"; state: "started" | "finished" | "stopped" | "failed"; error?: string };

export interface Stats {
  seen: number;
  ignored: number;
  used: number;
  clock: number;
  running: boolean;
  hasApiKey: boolean;
}

export interface BoardIssue {
  id: string;
  title: string;
  kind: string;
  status: string;
  severity: string;
  feature: string | null;
  updatedAt: number;
  messages: number;
  schools: string[];
  merged: number;
  owner: string | null;
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
  code: { feature: string | null; featureKey: string | null; files: string[]; codeOwners: string[]; assignee: string | null };
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const api = {
  stats: () => request<Stats>("/stats"),
  board: () => request<BoardIssue[]>("/board"),
  issue: (id: string) => request<IssueDetail>(`/issues/${id}`),
  setStatus: (id: string, to: string) => post(`/issues/${id}/status`, { to }),
  followUps: () => request<FollowUpsResponse>("/followups"),
  graph: () => request<GraphData>("/graph"),
  ask: (question: string) => post<Answer>("/ask", { question }),
  replay: (speed: string) => post("/replay", { speed }),
  importExport: (text: string) => request("/import", { method: "POST", body: text }),
  stop: () => post("/stop"),
  reset: () => post("/reset"),
  events: (onEvent: (event: PipelineEvent) => void) => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => onEvent(JSON.parse(message.data));
    return () => source.close();
  },
};
