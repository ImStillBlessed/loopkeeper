import { castMember } from "./cast.js";
import { createRandom, generateNoise } from "./noise.js";
import { SCRIPTED_EVENTS, type ChatEvent } from "./scenarios.js";

export const GROUP_NAME = "Ednovax Schools Support";
/** Monday 21 Sep 2026. */
export const START_DATE = { year: 2026, month: 9, day: 21 };
export const CHAT_DAYS = 21;

export interface TimedEvent extends ChatEvent {
  date: Date; // local wall-clock time, stored in UTC fields (no timezone maths needed)
}

/** Scripted work + seeded noise, sorted the way WhatsApp would show it. */
export function buildChat(seed = 42): TimedEvent[] {
  const random = createRandom(seed);
  const events = [...SCRIPTED_EVENTS, ...generateNoise(CHAT_DAYS, random)];

  const timed = events.map((event, order) => ({ event, order, date: localDate(event) }));
  timed.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);

  // The iOS format shows seconds: make them look natural but keep messages within one minute in order.
  let previousMinute = -1;
  let positionInMinute = 0;
  return timed.map(({ event, date }, index) => {
    positionInMinute = date.getTime() === previousMinute ? positionInMinute + 1 : 0;
    previousMinute = date.getTime();
    const seconds = Math.min(59, positionInMinute * 9 + (index % 9));
    return { ...event, date: new Date(date.getTime() + seconds * 1000) };
  });
}

function localDate(event: ChatEvent): Date {
  const [hour, minute] = event.time.split(":").map(Number);
  return new Date(Date.UTC(START_DATE.year, START_DATE.month - 1, START_DATE.day + event.day, hour, minute));
}

export type ExportFormat = "android" | "ios";

/** Renders the chat exactly like WhatsApp's "Export chat → Without media". */
export function formatExport(events: TimedEvent[], format: ExportFormat): string {
  const header = systemLines(format);
  const lines = events.map((event) => {
    const sender = castMember(event.sender).whatsappLabel;
    return `${timestamp(event.date, format)}${sender}: ${messageBody(event, format)}`;
  });
  return [...header, ...lines].join("\n") + "\n";
}

function messageBody(event: ChatEvent, format: ExportFormat): string {
  if (!event.hasMedia) return event.text;
  const placeholder = format === "android" ? "<Media omitted>" : "‎image omitted";
  // When a caption comes with media, WhatsApp exports them as two lines.
  return event.text ? `${placeholder}\n${event.text}` : placeholder;
}

function systemLines(format: ExportFormat): string[] {
  const created = new Date(Date.UTC(START_DATE.year, START_DATE.month - 1, START_DATE.day - 30, 9, 0));
  const prefix = (minutes: number) => timestamp(new Date(created.getTime() + minutes * 60_000), format);
  return [
    `${prefix(0)}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
    `${prefix(0)}Ngozi Eze created group "${GROUP_NAME}"`,
    `${prefix(1)}Ngozi Eze added Tunde Bakare, Kemi Ojo`,
    `${prefix(5)}Ngozi Eze added Mrs Adaeze Okafor, Mrs Efe Omoregie, Mr Osaro Igbinedion`,
    `${prefix(6)}Ngozi Eze added Mr Chidi Nwosu, Miss Bisi Lawal, Mrs Funke Adeyemi`,
    `${prefix(7)}Ngozi Eze added Mrs Grace Danjuma, +234 803 555 0142`,
  ];
}

function timestamp(date: Date, format: ExportFormat): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return format === "android"
    ? `${day}, ${time} - `
    : `[${day}, ${time}:${pad(date.getUTCSeconds())}] `;
}
