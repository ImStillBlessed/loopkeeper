/**
 * What each status, severity, SLA state and kind of message looks like. Colours are CSS variables
 * from index.css, so light and dark mode both work. `tone` picks a Badge style.
 */
export type Tone = "red" | "amber" | "green" | "blue" | "violet" | "sky" | "neutral" | "navy";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "red" },
  in_progress: { label: "In progress", tone: "sky" },
  possibly_resolved: { label: "Awaiting client", tone: "violet" },
  resolved: { label: "Resolved", tone: "green" },
  merged: { label: "Merged", tone: "neutral" },
};

export const SEVERITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  critical: { label: "Critical", tone: "red", rank: 0 },
  high: { label: "High", tone: "red", rank: 1 },
  medium: { label: "Medium", tone: "amber", rank: 2 },
  low: { label: "Low", tone: "neutral", rank: 3 },
};

export const SLA: Record<string, { label: string; tone: Tone }> = {
  breached: { label: "Breached", tone: "red" },
  due_soon: { label: "Due soon", tone: "amber" },
  on_track: { label: "On track", tone: "green" },
  met: { label: "Met", tone: "neutral" },
  missed: { label: "Missed", tone: "neutral" },
};

export const HEALTH: Record<string, { label: string; tone: Tone; color: string }> = {
  healthy: { label: "Healthy", tone: "green", color: "var(--green)" },
  watch: { label: "Watch", tone: "amber", color: "var(--amber)" },
  at_risk: { label: "At risk", tone: "red", color: "var(--red)" },
};

export const KIND: Record<string, string> = {
  bug: "Problem",
  feature_request: "Request",
  question: "Question",
  promise: "Promise",
  resolution: "Fixed",
  status_update: "Update",
  decision: "Decision",
};

export const MOOD: Record<string, { label: string; tone: Tone }> = {
  frustrated: { label: "Frustrated", tone: "red" },
  concerned: { label: "Concerned", tone: "amber" },
  calm: { label: "Calm", tone: "neutral" },
};

export const PLAN: Record<string, string> = { premium: "Premium", standard: "Standard" };
export const CLIENT_TYPE: Record<string, string> = { school: "School", lecture_centre: "Lecture centre" };
export const ROLE: Record<string, string> = { admin: "Admin", lead: "Support lead", agent: "Support agent", developer: "Developer", demo: "Demo" };

export const PRODUCT_NAMES: Record<string, string> = {
  sms_v1: "Ednovax SMS v1",
  ednovax: "Ednovax",
};

/** Graph node label → colour on the Network page (works on both themes). */
export const NODE_COLORS: Record<string, string> = {
  Issue: "#D2402C",
  School: "#B0761A",
  FollowUp: "#E0A63A",
  Person: "#1348E6",
  Message: "#1A7F5A",
  Decision: "#2FA57A",
  Feature: "#6B4FD8",
  CodeFile: "#0EA5E9",
  Group: "#0D9488",
  Question: "#C25BA8",
  Conversation: "#C25BA8",
  StatusChange: "#8A8F9C",
  Reminder: "#8A8F9C",
};

export const TENANCY: Record<string, { label: string; hint: string }> = {
  own_repo: { label: "Own repo", hint: "The school has a repository of its own" },
  branch: { label: "Branch", hint: "Deployed from its own branch of a shared repository" },
  multi_tenant: { label: "Multi-tenant", hint: "One of many tenants in a shared codebase and database" },
};
