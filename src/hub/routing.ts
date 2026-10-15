/**
 * Working out which client a message in the central support hub is about, without a model where
 * possible. Staff forward messages from many schools into one WhatsApp group, usually in a few
 * familiar shapes:
 *
 *   Mrs Okafor (Royal Academy): the broadsheet averages are wrong
 *   [Unity] Mallam Ibrahim: students can't log in
 *   Forwarded: report cards are cutting off
 *   Tunde please check the Apex receipts again
 */

export interface DirectoryEntry {
  id: string;
  name: string;
  aliases: string[];
}

export interface ParsedHubMessage {
  /** The words of the message without the forwarding wrapper. */
  body: string;
  /** Who originally said it, when the forwarder wrote it down. */
  speaker?: string;
  /** The client named in the wrapper ("(Royal Academy)", "[Unity]"). */
  clientHint?: string;
  /** Staff passed on someone else's words (rather than speaking for themselves). */
  forwarded: boolean;
}

const FORWARD_PREFIX = /^\s*(?:fwd|fw|forwarded(?: message)?)\s*(?:from\s+)?[:\-–]\s*/i;
/** "Mrs Okafor (Royal Academy): …" */
const SPEAKER_AND_CLIENT = /^([^():\n]{2,40}?)\s*\(([^)]{2,60})\)\s*[:\-–]\s*([\s\S]+)$/;
/** "[Royal Academy] Mrs Okafor: …" or "[Royal Academy] …" */
const BRACKETED_CLIENT = /^\[([^\]]{2,60})\]\s*(?:([^:\n]{2,40}?)\s*:\s*)?([\s\S]+)$/;
/** "Mrs Okafor: …", only when it starts with a title, so staff writing "Note: …" isn't read as a person. */
const TITLED_SPEAKER = /^((?:Mr|Mrs|Miss|Ms|Mallam|Dr|Prof|Pastor|Alhaji|Sir|Madam)\.?\s+[^:\n]{2,35}?)\s*:\s*([\s\S]+)$/i;

export function parseHubMessage(text: string): ParsedHubMessage {
  let body = text.trim();
  let forwarded = false;
  if (FORWARD_PREFIX.test(body)) {
    body = body.replace(FORWARD_PREFIX, "");
    forwarded = true;
  }

  const bracketed = BRACKETED_CLIENT.exec(body);
  if (bracketed) return { body: bracketed[3].trim(), speaker: bracketed[2]?.trim(), clientHint: bracketed[1].trim(), forwarded: true };

  const withClient = SPEAKER_AND_CLIENT.exec(body);
  if (withClient) return { body: withClient[3].trim(), speaker: withClient[1].trim(), clientHint: withClient[2].trim(), forwarded: true };

  const titled = TITLED_SPEAKER.exec(body);
  if (titled) return { body: titled[2].trim(), speaker: titled[1].trim(), forwarded: true };

  return { body, forwarded };
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Clients whose name or alias appears in the text, as whole words. Longer names are tried first,
 * so "Unity Model School" wins over a stray "unity".
 */
export function clientsNamedIn(text: string, directory: DirectoryEntry[]): string[] {
  const haystack = ` ${normalise(text)} `;
  const found = new Set<string>();
  const names = directory
    .flatMap((client) => [client.name, ...client.aliases].map((name) => ({ id: client.id, name: normalise(name) })))
    .filter((n) => n.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  for (const { id, name } of names) {
    if (haystack.includes(` ${name} `)) found.add(id);
  }
  return [...found];
}

/** Greetings, thanks and prayers: team chatter, not about a client. */
const GREETING = String.raw`(?:good\s+(?:morning|afternoon|evening|day)|morning|hello|hi|hey|thanks?|thank\s+you|amen|ok(?:ay)?|noted|alright|god\s+bless)(?:\s+(?:team|all|everyone|guys|people|sir|ma|o))?`;
/** Only a greeting (or only emoji): anything more is a real message. */
const CHATTER = new RegExp(String.raw`^(?:${GREETING})?[\s!.,\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}]*$`, "iu");

export function isChatter(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && CHATTER.test(trimmed);
}

/** Words that carry on the previous topic ("he says…", "still…") rather than start a new one. */
const FOLLOW_UP = /\b(he|she|they|it|still|again|also|same|too|their|her|his)\b/i;
/** "A school called…": explicitly some other, unnamed client. */
const SOME_OTHER_CLIENT = /\b(a|another|one|some|other)\s+(school|client|centre|center|customer)\b/i;

export function continuesThread(text: string): boolean {
  return FOLLOW_UP.test(text) && !SOME_OTHER_CLIENT.test(text);
}
