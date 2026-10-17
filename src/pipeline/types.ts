import type { ImportProgress } from "../hub/import.js";
import type { MessageType } from "./message-types.js";

export interface Person {
  id: string;
  name: string;
  role: string;
  schoolId: string | null;
  school: string | null;
}

export type Sentiment = "calm" | "concerned" | "frustrated";

export interface TriageResult {
  id: string;
  relevant: boolean;
  type?: MessageType;
  /** How the sender sounds; only for work messages. Feeds the client health score. */
  sentiment?: Sentiment;
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
  sentiment?: Sentiment;
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

/** A message in the central support hub, and where it was routed. */
export interface HubEntry {
  id: string;
  ts: number;
  sender: string;
  text: string;
  status: "routed" | "pending" | "ignored";
  clientIds: string[];
  /** How the client was worked out: named in the message, a known contact, the same thread, the model, or a person. */
  method: "named" | "contact" | "thread" | "model" | "manual" | "";
  reason: string;
}

/**
 * An event on the app-wide stream: the same events, tagged with the client they belong to (none for HQ),
 * plus the central support hub's own events (shown only to staff who see every client).
 */
export type HubEvent = (PipelineEvent | { kind: "hub"; entry: HubEntry } | { kind: "import"; progress: ImportProgress }) & { clientId?: string };
