/**
 * The colour language. One colour per kind of thing, used everywhere:
 * chat tags, issue sheets, and the points on the globe.
 */
export const COLORS = {
  coral: "#FF6B6B",
  sunflower: "#FFC845",
  sky: "#5AC8FA",
  mint: "#4CD7A5",
  lilac: "#B39DFF",
  muted: "#9A9AA3",
} as const;

/** Graph node label → colour. */
export const NODE_COLORS: Record<string, string> = {
  Issue: COLORS.coral,
  School: COLORS.sunflower,
  FollowUp: COLORS.sunflower,
  Person: COLORS.sky,
  Message: COLORS.mint,
  Decision: COLORS.mint,
  Feature: COLORS.lilac,
  CodeFile: COLORS.lilac,
  Group: COLORS.sky,
  StatusChange: "#6E6E78",
  Reminder: "#6E6E78",
};

/** Friendly names for the globe legend. */
export const NODE_NAMES: Array<{ label: string; name: string; color: string }> = [
  { label: "Issue", name: "Issues", color: COLORS.coral },
  { label: "School", name: "Schools & promises", color: COLORS.sunflower },
  { label: "Person", name: "People", color: COLORS.sky },
  { label: "Message", name: "Messages & decisions", color: COLORS.mint },
  { label: "Feature", name: "Features & code", color: COLORS.lilac },
];

/** What each kind of chat message is, in plain words, with its colour. */
export const MESSAGE_KINDS: Record<string, { label: string; color: string }> = {
  bug: { label: "Problem", color: COLORS.coral },
  feature_request: { label: "Request", color: COLORS.lilac },
  question: { label: "Question", color: COLORS.sky },
  promise: { label: "Promise", color: COLORS.sunflower },
  resolution: { label: "Fixed", color: COLORS.mint },
  status_update: { label: "Update", color: COLORS.muted },
  decision: { label: "Decision", color: COLORS.mint },
};

export const STATUS = {
  open: { label: "Open", color: COLORS.coral },
  in_progress: { label: "Being worked on", color: COLORS.sky },
  possibly_resolved: { label: "Check with school", color: COLORS.sunflower },
  resolved: { label: "Resolved", color: COLORS.mint },
} as const;

export type StatusKey = keyof typeof STATUS;
