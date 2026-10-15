/**
 * A chat message after normalisation, whatever the source (export file, simulator, WhatsApp API).
 * This is the only shape the rest of the pipeline sees.
 */
export interface ChatMessage {
  /** Deterministic id, so re-importing the same export never creates duplicates. */
  id: string;
  groupId: string;
  /** Hashed sender id. Raw phone numbers are never kept. */
  senderId: string;
  /** Display name, or a masked number ("+234 ••• 0142") if the sender is not a saved contact. */
  senderName: string;
  /** ISO-8601 timestamp with offset, e.g. "2026-09-21T08:05:00+01:00". */
  ts: string;
  text: string;
  hasMedia: boolean;
  /** Only set by sources that know about quoted replies (exports don't include them). */
  replyToId?: string;
  /** Staff added this on purpose (from Ask): always kept, never filtered out as small talk. */
  trusted?: boolean;
}

export interface ParseStats {
  lines: number;
  messages: number;
  /** "X added Y", encryption notices, subject changes, and so on. */
  systemLines: number;
  /** "This message was deleted": nothing left to use. */
  deleted: number;
  withMedia: number;
}

export interface ParseResult {
  messages: ChatMessage[];
  stats: ParseStats;
}
