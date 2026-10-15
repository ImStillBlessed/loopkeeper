const TIME_ZONE = "Africa/Lagos";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatTime(value: number | string): string {
  return new Date(value).toLocaleTimeString("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value: number | string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
}

export function formatShortDay(value: number | string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
}

export function formatDateTime(value: number | string): string {
  return `${formatShortDay(value)}, ${formatTime(value)}`;
}

/** "3 h ago", "yesterday", "5 days ago", measured on the chat clock. */
export function ago(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  return `${Math.floor(diff / DAY)} days ago`;
}

/** "in 2 h 10 min" / "4 h overdue": time left to an SLA deadline. */
export function until(dueAt: number, now: number): string {
  const diff = dueAt - now;
  const span = duration(Math.abs(diff));
  return diff >= 0 ? `${span} left` : `${span} over`;
}

export function duration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes && hours < 10 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

/** SLA policy minutes as words: 60 → "1 hour", 4320 → "3 days". */
export function minutesAsWords(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 1440) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / 1440), "day");
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

/** "Mrs Funke Adeyemi" → "FA", for avatars. */
export function initials(name: string): string {
  const words = name.replace(/^(Mr|Mrs|Miss|Ms|Mallam|Dr)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/** "Mrs Funke Adeyemi" → "Mrs Funke". */
export function shortName(name: string): string {
  const parts = name.split(/\s+/);
  return /^(Mr|Mrs|Miss|Ms|Mallam|Dr)\.?$/i.test(parts[0] ?? "") ? parts.slice(0, 2).join(" ") : (parts[0] ?? name);
}
