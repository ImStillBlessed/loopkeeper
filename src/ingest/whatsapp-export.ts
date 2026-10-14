import { looksLikePhoneNumber, maskPhoneNumber, personId, stableId } from "./ids.js";
import type { ChatMessage, ParseResult, ParseStats } from "./types.js";

/**
 * Parser for WhatsApp "Export chat" .txt files.
 *
 * Supported line formats:
 *   Android: 21/09/2026, 08:05 - Mrs Adaeze Okafor: Good morning all
 *   Android: 21/09/26, 8:05 am - Mrs Adaeze Okafor: Good morning all
 *   iOS:     [21/09/2026, 08:05:33] Mrs Adaeze Okafor: Good morning all
 *
 * Lines that don't start with a timestamp continue the previous message (multi-line messages).
 */

export interface ParseOptions {
  groupId: string;
  /** Salt for hashing sender ids. */
  salt: string;
  /** Exports use local wall-clock time; this offset turns it into a real instant. */
  utcOffset?: string;
  /** Nigerian phones write dates day-first. Set "MDY" for US-locale exports. */
  dateOrder?: "DMY" | "MDY";
}

const DATE = String.raw`(\d{1,2})/(\d{1,2})/(\d{2,4})`;
const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[\s ]?([AaPp])\.?[Mm]\.?)?`;
const ANDROID_HEADER = new RegExp(`^${DATE},? ${TIME} - (.*)$`);
const IOS_HEADER = new RegExp(`^\\[${DATE},? ${TIME}\\] (.*)$`);

/** Invisible direction marks WhatsApp (mostly iOS) sprinkles into exports. */
const INVISIBLE_MARKS = /[‎‏﻿]/g;

/** Lines with a timestamp but no human sender, e.g. "Ada added Tunde". */
const SYSTEM_PATTERNS = [
  /end-to-end encrypted/i,
  /\bcreated (this )?group\b/i,
  /\badded\b/i,
  /\bremoved\b/i,
  /\bleft$/i,
  /\bjoined using\b/i,
  /\bchanged (the|this) (subject|group)/i,
  /\bchanged this group's (icon|settings)/i,
  /\bchanged the group description\b/i,
  /\bchanged their phone number\b/i,
  /\bdeleted this group's icon\b/i,
  /\bis now an admin\b/i,
];

const MEDIA_PATTERNS = [
  /<Media omitted>/gi,
  /<attached: [^>]+>/gi,
  /^.*\(file attached\)$/gim,
  /^.*\b(image|video|audio|sticker|GIF|document|Contact card) omitted$/gim,
];

const DELETED_PATTERN = /^(This message was deleted|You deleted this message)\.?$/i;
const EDITED_SUFFIX = /\s*<This message was edited>$/i;

interface RawMessage {
  ts: string;
  senderLabel: string;
  lines: string[];
}

export function parseWhatsAppExport(content: string, options: ParseOptions): ParseResult {
  const stats: ParseStats = { lines: 0, messages: 0, systemLines: 0, deleted: 0, withMedia: 0 };
  const rawMessages: RawMessage[] = [];
  let current: RawMessage | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    stats.lines++;
    const line = rawLine.replace(INVISIBLE_MARKS, "");
    const header = matchHeader(line, options);

    if (!header) {
      // Continuation of a multi-line message. Text before the first header (or after a system line) is dropped.
      current?.lines.push(line);
      continue;
    }

    const sender = splitSender(header.rest);
    if (!sender) {
      stats.systemLines++;
      current = undefined;
      continue;
    }

    current = { ts: header.ts, senderLabel: sender.label, lines: [sender.text] };
    rawMessages.push(current);
  }

  const occurrences = new Map<string, number>();
  const messages: ChatMessage[] = [];

  for (const raw of rawMessages) {
    const { text, hasMedia } = cleanText(raw.lines.join("\n"));
    if (DELETED_PATTERN.test(text)) {
      stats.deleted++;
      continue;
    }

    const senderId = personId(raw.senderLabel, options.salt);
    const senderName = looksLikePhoneNumber(raw.senderLabel)
      ? maskPhoneNumber(raw.senderLabel)
      : raw.senderLabel.trim();

    // Same sender + same minute + same text ("🙏🏾" twice) still gets distinct, stable ids.
    const key = [options.groupId, raw.ts, senderId, text].join("|");
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);

    messages.push({
      id: stableId("msg", [key, String(occurrence)]),
      groupId: options.groupId,
      senderId,
      senderName,
      ts: raw.ts,
      text,
      hasMedia,
    });
    if (hasMedia) stats.withMedia++;
  }

  stats.messages = messages.length;
  return { messages, stats };
}

function matchHeader(line: string, options: ParseOptions): { ts: string; rest: string } | undefined {
  const match = ANDROID_HEADER.exec(line) ?? IOS_HEADER.exec(line);
  if (!match) return undefined;

  const [, first, second, year, hour, minute, secondsPart, meridiem, rest] = match;
  const [day, month] = options.dateOrder === "MDY" ? [second, first] : [first, second];
  const ts = toIsoTimestamp(
    {
      year: year.length === 2 ? 2000 + Number(year) : Number(year),
      month: Number(month),
      day: Number(day),
      hour: to24Hour(Number(hour), meridiem),
      minute: Number(minute),
      second: Number(secondsPart ?? 0),
    },
    options.utcOffset ?? "+01:00",
  );
  return ts ? { ts, rest } : undefined;
}

function splitSender(rest: string): { label: string; text: string } | undefined {
  const separator = rest.indexOf(": ");
  // "Name:" with an empty message body is also valid.
  const colonAtEnd = separator === -1 && rest.endsWith(":") ? rest.length - 1 : -1;
  const cut = separator !== -1 ? separator : colonAtEnd;
  if (cut === -1) return undefined;

  const label = rest.slice(0, cut);
  if (SYSTEM_PATTERNS.some((pattern) => pattern.test(label))) return undefined;
  return { label, text: rest.slice(cut + 2) };
}

function cleanText(text: string): { text: string; hasMedia: boolean } {
  let cleaned = text.replace(EDITED_SUFFIX, "");
  let hasMedia = false;
  for (const pattern of MEDIA_PATTERNS) {
    cleaned = cleaned.replace(pattern, () => {
      hasMedia = true;
      return "";
    });
  }
  return { text: cleaned.trim(), hasMedia };
}

function to24Hour(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const isPm = meridiem.toLowerCase() === "p";
  if (hour === 12) return isPm ? 12 : 0;
  return isPm ? hour + 12 : hour;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toIsoTimestamp(t: LocalDateTime, utcOffset: string): string | undefined {
  const valid =
    t.month >= 1 && t.month <= 12 && t.day >= 1 && t.day <= 31 &&
    t.hour <= 23 && t.minute <= 59 && t.second <= 59;
  if (!valid) return undefined;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}${utcOffset}`;
}
