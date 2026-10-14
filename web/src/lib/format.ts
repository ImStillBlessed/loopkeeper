const TIME_ZONE = "Africa/Lagos";

export function formatTime(value: number | string): string {
  return new Date(value).toLocaleTimeString("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value: number | string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
}

export function formatShortDay(value: number | string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
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
  return /^(Mr|Mrs|Miss|Ms|Mallam|Dr)\.?$/i.test(parts[0] ?? "") ? parts.slice(0, 2).join(" ") : parts[0] ?? name;
}
