import { config } from "../config.js";

const LAGOS = new Intl.DateTimeFormat("en-GB", {
  timeZone: config.timeZone,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const LAGOS_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: config.timeZone,
  weekday: "long",
  day: "numeric",
  month: "short",
});

/** "Thu, 24 Sept 2026, 09:40": what the models see, in Lagos time. */
export function formatLagos(ms: number): string {
  return LAGOS.format(new Date(ms));
}

/** "Thursday 1 Oct": friendly enough for a teacher-facing message. */
export function formatLagosDay(ms: number): string {
  return LAGOS_DAY.format(new Date(ms));
}

/** Parses a model-supplied date. Times without an offset are taken as Lagos time. */
export function parseLagosDate(value: string): number | undefined {
  if (!value) return undefined;
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const withTime = /T\d{2}:\d{2}/.test(value) ? value : `${value}T17:00`;
  const ms = Date.parse(hasOffset ? withTime : `${withTime}${config.chatUtcOffset}`);
  return Number.isNaN(ms) ? undefined : ms;
}

export const HOUR = 60 * 60 * 1000;
