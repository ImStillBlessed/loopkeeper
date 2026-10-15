import { looksLikePhoneNumber, maskPhoneNumber, personId, stableId } from "./ids.js";
import type { ChatMessage } from "./types.js";

let counter = 0;

/** Turns a milliseconds timestamp into an ISO string in Lagos time, like the export parser produces. */
export function toLagosIso(ms: number, utcOffset = "+01:00"): string {
  const [sign, hours, minutes] = /([+-])(\d{2}):(\d{2})/.exec(utcOffset)!.slice(1);
  const shift = (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
  return new Date(ms + shift).toISOString().replace(/\.\d{3}Z$/, utcOffset);
}

/**
 * Normalises a message arriving live (simulator, CLI, or a WhatsApp webhook) into the same
 * ChatMessage shape the export parser produces, with the same privacy rules: hashed id, masked number.
 */
export function makeLiveMessage(input: {
  groupId: string;
  senderLabel: string;
  text: string;
  ts: number;
  hasMedia?: boolean;
  salt: string;
}): ChatMessage {
  const senderId = personId(input.senderLabel, input.salt);
  return {
    id: stableId("msg", [input.groupId, String(input.ts), senderId, input.text, String(counter++)]),
    groupId: input.groupId,
    senderId,
    senderName: looksLikePhoneNumber(input.senderLabel) ? maskPhoneNumber(input.senderLabel) : input.senderLabel.trim(),
    ts: toLagosIso(input.ts),
    text: input.text.trim(),
    hasMedia: Boolean(input.hasMedia),
  };
}
