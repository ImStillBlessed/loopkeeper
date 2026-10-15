import type { MessageType } from "./message-types.js";

export interface Person {
  id: string;
  name: string;
  role: string;
  schoolId: string | null;
  school: string | null;
}

export interface TriageResult {
  id: string;
  relevant: boolean;
  type?: MessageType;
  confidence: number;
}

export type IssueKind = "bug" | "feature_request" | "question";
export type Severity = "low" | "medium" | "high" | "critical";
export type UpdateKind = "confirmed" | "more_info" | "in_progress" | "resolved" | "answered" | "reopened";

/** What the extraction model returns for one relevant message (see prompts/extract.md). */
export interface Extraction {
  new_issues: Array<{
    title: string;
    summary: string;
    kind: IssueKind;
    feature_key: string | null;
    severity: Severity;
  }>;
  issue_updates: Array<{ issue_id: string; kind: UpdateKind; confidence: number }>;
  new_followups: Array<{ text: string; owner_name: string; due: string; issue_id: string | null }>;
  completed_followups: Array<{ followup_id: string }>;
  decisions: Array<{ text: string; feature_key: string | null }>;
}

/** A product area, found in the repo (features.yaml or folders) or seeded for the demo. */
export interface Feature {
  key: string;
  name: string;
  description: string | null;
}

/** One line in the live feed. Noise shows up here but is never written to the graph. */
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

/** Everything a project tells the dashboard (and the CLI) as it happens. */
export type PipelineEvent =
  | { kind: "message"; message: FeedMessage }
  | { kind: "activity"; text: string; issueId?: string; ts: string; source?: "chat" | "github" }
  | { kind: "bot"; text: string; ts: string; groupId?: string }
  | { kind: "stats"; seen: number; ignored: number; used: number }
  /** The live connection: is the simulated group sending, and what time is it in the chat. */
  | { kind: "live"; running: boolean; clock: number; groupId?: string }
  | { kind: "run"; state: "started" | "finished" | "stopped" | "failed"; error?: string };
