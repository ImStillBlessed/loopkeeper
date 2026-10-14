import { Sparkles, BellRing } from "lucide-react";
import { RailBar, RailSection } from "@/components/page";
import type { BoardIssue, PipelineEvent } from "@/lib/api";
import { formatShortDay } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS, MESSAGE_KINDS } from "@/lib/palette";

const OPEN = new Set(["open", "in_progress", "possibly_resolved"]);
const SCHOOLS = ["Royal Academy", "Bright Future College", "Unity Model School"];

/** "score_submission" → "Score submission" */
export function featureName(key: string): string {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Open issues per school: where the pain is. */
export function SchoolsRail({ issues }: { issues: BoardIssue[] }) {
  const open = issues.filter((i) => OPEN.has(i.status));
  const counts = SCHOOLS.map((school) => ({ school, count: open.filter((i) => i.schools.includes(school)).length }));
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <RailSection title="Open issues by school">
      {counts.map((c) => <RailBar key={c.school} label={c.school} value={c.count} max={max} color={COLORS.sunflower} />)}
    </RailSection>
  );
}

/** Open issues per product area: where the code needs attention. */
export function FeaturesRail({ issues }: { issues: BoardIssue[] }) {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (OPEN.has(issue.status) && issue.feature) counts.set(issue.feature, (counts.get(issue.feature) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <RailSection title="Open issues by product area">
      {rows.length ? rows.map(([key, n]) => <RailBar key={key} label={featureName(key)} value={n} max={max} color={COLORS.lilac} />) : <Quiet>Nothing open.</Quiet>}
    </RailSection>
  );
}

/** The last few things Loopkeeper did, newest first. */
export function LatestRail({ limit = 5 }: { limit?: number }) {
  const { events } = useLive();
  const { openIssue } = useNavigation();
  const latest = events
    .filter((e): e is Extract<PipelineEvent, { kind: "activity" | "bot" }> => e.kind === "activity" || e.kind === "bot")
    .slice(-limit)
    .reverse();

  return (
    <RailSection title="Latest from Loopkeeper">
      {latest.length === 0 ? (
        <Quiet>Nothing yet. Replay the chat to see Loopkeeper at work.</Quiet>
      ) : (
        <ul className="flex flex-col gap-4">
          {latest.map((event, i) => {
            const Icon = event.kind === "bot" ? BellRing : Sparkles;
            const issueId = event.kind === "activity" ? event.issueId : undefined;
            return (
              <li key={i}>
                <button
                  disabled={!issueId}
                  onClick={() => issueId && openIssue(issueId)}
                  className="flex gap-3 text-left text-small text-muted transition-colors enabled:hover:text-foreground"
                >
                  <Icon className="mt-0.5 size-4 shrink-0" style={{ color: event.kind === "bot" ? COLORS.sunflower : COLORS.lilac }} />
                  <span>
                    <span className="line-clamp-3">{event.text}</span>
                    <span className="mt-1 block text-faint">{formatShortDay(event.ts)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

export function Quiet({ children }: { children: string }) {
  return <p className="text-small text-faint">{children}</p>;
}

/** Who brings work to the group, counted from the live feed. */
export function PeopleRail() {
  const { events } = useLive();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "message" && e.message.relevant) counts.set(e.message.senderName, (counts.get(e.message.senderName) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <RailSection title="Who's raising work">
      {rows.length ? rows.map(([name, n]) => <RailBar key={name} label={name} value={n} max={max} color={COLORS.sky} />) : <Quiet>No one yet.</Quiet>}
    </RailSection>
  );
}

/** A running tally of what Loopkeeper picked out of the chat, by kind. */
export function PickedUpRail() {
  const { events, ignored } = useLive();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "message" && e.message.relevant && e.message.type) counts.set(e.message.type, (counts.get(e.message.type) ?? 0) + 1);
  }
  const rows = Object.entries(MESSAGE_KINDS).filter(([type]) => counts.has(type));
  return (
    <RailSection title="What Loopkeeper picked up">
      <ul className="flex flex-col gap-3">
        {rows.map(([type, kind]) => (
          <li key={type} className="flex items-center justify-between text-small">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: kind.color }} />
              {kind.label}
            </span>
            <span className="font-medium tabular-nums" style={{ color: kind.color }}>{counts.get(type)}</span>
          </li>
        ))}
        <li className="mt-2 flex items-center justify-between text-small text-faint">
          <span>Set aside as small talk</span>
          <span className="tabular-nums">{ignored}</span>
        </li>
      </ul>
    </RailSection>
  );
}
