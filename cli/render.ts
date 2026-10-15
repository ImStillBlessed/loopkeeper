import type { HubEvent } from "../src/pipeline/types.js";

/** The dashboard's colour language, in the terminal (24-bit colour). */
const rgb = (hex: string) => (text: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
};
export const color = {
  coral: rgb("#FF6B6B"),
  sunflower: rgb("#FFC845"),
  sky: rgb("#5AC8FA"),
  mint: rgb("#4CD7A5"),
  lilac: rgb("#B39DFF"),
  muted: rgb("#9A9AA3"),
  faint: rgb("#5C5C66"),
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

const KIND: Record<string, [string, (t: string) => string]> = {
  bug: ["problem", color.coral],
  feature_request: ["request", color.lilac],
  question: ["question", color.sky],
  promise: ["promise", color.sunflower],
  resolution: ["fixed", color.mint],
  status_update: ["update", color.muted],
  decision: ["decision", color.mint],
};

export function time(iso: string | number): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
}

export function day(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One live event as a terminal line, or undefined to stay quiet. */
export function renderEvent(event: HubEvent, showSmallTalk: boolean): string | undefined {
  switch (event.kind) {
    case "message": {
      const m = event.message;
      const text = m.hasMedia ? `📷 ${m.text}`.trim() : m.text;
      if (!m.relevant) return showSmallTalk ? color.faint(`  ${time(m.ts)}  ${m.senderName}: ${text}   (small talk)`) : undefined;
      const [label, paint] = KIND[m.type ?? ""] ?? ["work", color.muted];
      return `  ${color.faint(time(m.ts))}  ${color.sky(m.senderName)}: ${text}  ${paint(`[${label}]`)}`;
    }
    case "activity":
      return color.lilac(`      ◆ ${event.text}`);
    case "bot":
      return `  ${color.faint(time(event.ts))}  ${color.mint("Loopkeeper")}: ${event.text}`;
    case "run":
      return event.state === "failed" ? color.coral(`  ✗ ${event.error}`) : undefined;
    case "hub": {
      const e = event.entry;
      const where = e.status === "routed" ? color.mint(`→ ${e.clientIds.join(", ")} (${e.reason})`) : e.status === "pending" ? color.sunflower("→ waiting for a person to route it") : color.faint("(team chatter)");
      return `  ${color.faint(time(e.ts))}  ${color.lilac("hub")} ${color.sky(e.sender)}: ${e.text}  ${where}`;
    }
    default:
      return undefined;
  }
}
