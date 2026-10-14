/** What a relevant (non-noise) chat message is doing. Noise never gets a type: it is dropped. */
export const MESSAGE_TYPES = [
  "bug",
  "feature_request",
  "question",
  "promise",
  "resolution",
  "status_update",
  "decision",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];
