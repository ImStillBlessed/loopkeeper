import { Clock, Flame, TriangleAlert } from "lucide-react";
import type { Health, Sla, Ticket } from "@/lib/api";
import { initials, until } from "@/lib/format";
import { HEALTH, MOOD, SEVERITY, SLA, STATUS } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Tooltip } from "./ui/tooltip";

/** Small building blocks used across the desk: SLA timers, health, status and people. */

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? { label: severity, tone: "neutral" as const };
  return <Badge tone={s.tone === "red" && severity === "high" ? "amber" : s.tone}>{s.label}</Badge>;
}

/** The SLA as a countdown: "2 h left" / "4 h over", coloured by state. Finished tickets say whether it was met. */
export function SlaTimer({ sla, now, compact }: { sla: Sla; now: number; compact?: boolean }) {
  const state = SLA[sla.state];
  const finished = sla.state === "met" || sla.state === "missed";
  const stage = sla.stage === "response" ? "First reply" : "Fix";
  const color = { breached: "text-red", due_soon: "text-amber", on_track: "text-green", met: "text-muted", missed: "text-muted" }[sla.state];
  return (
    <Tooltip content={finished ? `${stage}: SLA ${state.label.toLowerCase()}` : `${stage} due by ${new Date(sla.dueAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit" })}`}>
      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap tabular", color)}>
        {sla.state === "breached" ? <TriangleAlert className="size-3.5" /> : <Clock className="size-3.5" />}
        {finished ? `${state.label}` : until(sla.dueAt, now)}
        {!compact && !finished && <span className="text-faint">· {stage.toLowerCase()}</span>}
      </span>
    </Tooltip>
  );
}

/** Health as a number and a bar of 20 square segments. */
export function HealthMeter({ health, size = "md" }: { health: Health; size?: "sm" | "md" }) {
  const band = HEALTH[health.band];
  const lit = Math.round(health.score / 5);
  return (
    <Tooltip
      content={
        health.reasons.length ? (
          <ul className="flex flex-col gap-1">
            {health.reasons.map((r) => (
              <li key={r.text} className="flex justify-between gap-4">
                <span>{r.text}</span>
                <span className="font-mono tabular opacity-70">−{r.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          "Nothing is pulling this client's health down."
        )
      }
    >
      <span className="inline-flex items-center gap-2.5">
        <span className={cn("font-display font-semibold tabular", size === "sm" ? "w-7 text-[17px]" : "w-9 text-[22px]")} style={{ color: band.color }}>
          {health.score}
        </span>
        <span className="flex gap-[2px]" aria-label={`Health ${health.score} of 100, ${band.label}`}>
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} className={cn("rounded-full", size === "sm" ? "h-3.5 w-[3px]" : "h-4.5 w-1")} style={{ backgroundColor: i < lit ? band.color : "var(--line-soft)" }} />
          ))}
        </span>
      </span>
    </Tooltip>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  const band = HEALTH[health.band];
  return <Badge tone={band.tone}>{band.label}</Badge>;
}

/** A round avatar with initials. Ednovax staff are blue, client contacts are sky. */
export function Avatar({ name, staff, className }: { name: string; staff?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-bold",
        staff ? "bg-primary text-white" : "bg-sky-soft text-sky",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** The client's mood on a ticket: only shown when it's not calm. */
export function MoodMark({ moods }: { moods: string[] }) {
  const worst = moods.includes("frustrated") ? "frustrated" : moods.includes("concerned") ? "concerned" : undefined;
  if (!worst) return null;
  const mood = MOOD[worst];
  return (
    <Tooltip content={`The client sounds ${mood.label.toLowerCase()}`}>
      <span className={cn("inline-flex items-center", mood.tone === "red" ? "text-red" : "text-amber")}>
        <Flame className="size-3.5" />
      </span>
    </Tooltip>
  );
}

/** Tickets that are still open (not resolved, not merged into another). */
export const isOpen = (ticket: Pick<Ticket, "status">) => ticket.status === "open" || ticket.status === "in_progress" || ticket.status === "possibly_resolved";
