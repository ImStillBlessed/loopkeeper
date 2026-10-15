import { Activity, AlarmClockOff, ArrowRight, BellRing, Flag, HeartPulse, Hourglass, Inbox, Waypoints, type LucideIcon } from "lucide-react";
import { Avatar, HealthBadge, HealthMeter, MoodMark, SlaTimer } from "@/components/desk";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api, type DeskEvent, type Overview } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatDay, formatTime, plural } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { TILE } from "@/lib/pages";
import { HEALTH, KIND, PLAN, STATUS, type Tone } from "@/lib/palette";
import { href, openTicket } from "@/lib/router";
import { cn } from "@/lib/utils";

/** The home screen: what needs a person right now, how each client is doing, and problems several clients share. */
export function OverviewPage() {
  const user = useUser();
  const live = useLive();
  const { data, error } = useLiveQuery(api.overview);

  const firstName = user.name.split(" ")[0];
  const hour = Number(new Date(live.clock).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <Page>
      <PageHeader
        eyebrow={formatDay(live.clock)}
        title={`${greeting}, ${firstName}`}
        lead={data ? leadLine(data) : "Loading…"}
      />
      {error && <ErrorNote message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="flex flex-col gap-5 sm:gap-7">
          <KpiStrip kpis={data.kpis} />
          <div className="grid gap-5 sm:gap-7 xl:grid-cols-[1.35fr_1fr]">
            <Attention data={data} now={live.clock} />
            <ClientHealth data={data} />
          </div>
          <div className="grid items-start gap-5 sm:gap-7 xl:grid-cols-[1fr_1.35fr]">
            <SharedProblems data={data} />
            <LatestActivity events={live.events} clients={new Map(data.clients.map((c) => [c.id, c.name]))} />
          </div>
        </div>
      )}
    </Page>
  );
}

function leadLine(data: Overview): string {
  const { breached, dueSoon } = data.kpis;
  if (breached === 0 && dueSoon === 0) return "Everything is on time.";
  const parts = [breached && `${breached} past SLA`, dueSoon && `${dueSoon} due soon`].filter(Boolean);
  return `${parts.join(", ")}. Here's what needs you.`;
}

/** The desk's numbers at a glance: label and icon on top, the number below. */
function KpiStrip({ kpis }: { kpis: Overview["kpis"] }) {
  const cells: Array<{ label: string; value: number; tone: Tone; icon: LucideIcon; link: string }> = [
    { label: "Open tickets", value: kpis.openTickets, tone: "blue", icon: Inbox, link: href("tickets") },
    { label: "Past SLA", value: kpis.breached, tone: "red", icon: AlarmClockOff, link: href("tickets", { view: "breached" }) },
    { label: "Due soon", value: kpis.dueSoon, tone: "amber", icon: Hourglass, link: href("tickets", { view: "due_soon" }) },
    { label: "Escalated", value: kpis.escalated, tone: "violet", icon: Flag, link: href("tickets", { view: "escalated" }) },
    { label: "At risk", value: kpis.atRisk, tone: "red", icon: HeartPulse, link: href("clients", { band: "at_risk" }) },
    { label: "Patterns", value: kpis.sharedProblems, tone: "sky", icon: Waypoints, link: href("patterns") },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6" aria-label="Desk at a glance">
      {cells.map((cell) => (
        <a key={cell.label} href={cell.link} className="card flex flex-col gap-2.5 p-4 transition-[transform,box-shadow] sm:gap-3 sm:p-5 hover:-translate-y-0.5 hover:shadow-float">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13.5px] font-semibold text-muted">{cell.label}</span>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TILE[cell.tone])}>
              <cell.icon className="size-4" strokeWidth={2} />
            </span>
          </div>
          <div className={cn("font-display text-[28px] leading-none sm:text-[34px] font-semibold tabular", cell.value > 0 && (cell.tone === "red" || cell.tone === "violet") ? TEXT[cell.tone] : "text-ink")}>{cell.value}</div>
        </a>
      ))}
    </section>
  );
}

const TEXT: Partial<Record<Tone, string>> = { red: "text-red", violet: "text-violet" };

function Attention({ data, now }: { data: Overview; now: number }) {
  return (
    <Panel
      title="Needs attention now"
      action={
        <a href={href("tickets")} className="flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
          All tickets <ArrowRight className="size-3" />
        </a>
      }
    >
      {data.attention.length === 0 ? (
        <Empty title="All on time">Nothing is close to its deadline.</Empty>
      ) : (
        <ul>
          {data.attention.map((ticket) => (
            <li key={`${ticket.clientId}:${ticket.id}`} className="border-b border-line-soft last:border-b-0">
              <button onClick={() => openTicket(ticket.clientId, ticket.id)} className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper-2 sm:gap-4 sm:px-6 sm:py-4">
                <span className={cn("mt-1 h-9 w-1 shrink-0 rounded-full", ticket.sla.state === "breached" ? "bg-red" : ticket.escalated ? "bg-red" : "bg-amber")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    {ticket.escalated && <Flag className="mt-1 size-3.5 shrink-0 fill-red text-red" aria-label="Escalated" />}
                    <span className="line-clamp-2 font-medium group-hover:text-primary sm:line-clamp-1">{ticket.title}</span>
                    <MoodMark moods={ticket.moods} />
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-muted">
                    {ticket.clientName} · {ticket.owner || "Unassigned"}
                  </div>
                  <div className="mt-1.5 sm:hidden">
                    <SlaTimer sla={ticket.sla} now={now} compact />
                  </div>
                </div>
                <div className="hidden shrink-0 pt-0.5 text-right sm:block">
                  <SlaTimer sla={ticket.sla} now={now} compact />
                  <div className="mt-1 text-[12px] text-faint">{ticket.sla.stage === "response" ? "first reply" : "fix"}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ClientHealth({ data }: { data: Overview }) {
  return (
    <Panel
      title="Client health"
      action={
        <a href={href("clients")} className="flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
          All clients <ArrowRight className="size-3" />
        </a>
      }
    >
      <ul>
        {data.clients.map((client) => (
          <li key={client.id} className="border-b border-line-soft last:border-b-0">
            <a href={href("clients", client.id)} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-paper-2 sm:gap-4 sm:px-6 sm:py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium group-hover:text-primary">{client.name}</span>
                  {client.plan === "premium" && <Badge tone="navy" className="hidden sm:inline-flex">{PLAN.premium}</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted">{client.health.reasons[0]?.text ?? "All good"}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="hidden sm:block">
                  <HealthMeter health={client.health} size="sm" />
                </span>
                <span className="font-display text-[20px] leading-none font-semibold tabular sm:hidden" style={{ color: HEALTH[client.health.band].color }}>
                  {client.health.score}
                </span>
                <HealthBadge health={client.health} />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SharedProblems({ data }: { data: Overview }) {
  return (
    <Panel
      title="Shared problems"
      collapsible
      defaultOpen="desktop"
      summary={data.patterns.length}
      action={
        <a href={href("patterns")} className="flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
          Patterns <ArrowRight className="size-3" />
        </a>
      }
    >
      {data.patterns.length === 0 ? (
        <Empty title="No shared problems">Nothing is affecting several clients.</Empty>
      ) : (
        <ul>
          {data.patterns.map((pattern) => (
            <li key={pattern.id} className="flex gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0 sm:gap-4 sm:px-6 sm:py-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky"><Waypoints className="size-4.5" /></span>
              <div className="min-w-0">
                <div className="line-clamp-2 font-medium">{pattern.title}</div>
                <div className="mt-1 line-clamp-1 text-[13px] text-muted">
                  {pattern.clients} clients: {pattern.affected.join(", ")}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pattern.statuses.map((s) => (
                    <Badge key={s} tone={STATUS[s]?.tone}>
                      {STATUS[s]?.label ?? s}
                    </Badge>
                  ))}
                  {pattern.pullRequests.map((pr) => (
                    <Badge key={pr} tone="blue">
                      {pr}
                    </Badge>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** What just happened in the groups: who, where, and the first two lines of what was said. */
function LatestActivity({ events, clients }: { events: DeskEvent[]; clients: Map<string, string> }) {
  // Restored history arrives one client at a time, so order by when things happened.
  const recent = events
    .filter((e) => (e.kind === "message" && e.message.relevant) || e.kind === "activity" || e.kind === "bot")
    .map((event) => ({ event, ts: Date.parse(event.kind === "message" ? event.message.ts : "ts" in event ? event.ts : "") || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);

  return (
    <Panel
      title="Latest messages"
      collapsible
      defaultOpen="desktop"
      summary={recent.length}
      action={
        <a href={href("conversations")} className="flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
          All <ArrowRight className="size-3" />
        </a>
      }
    >
      {recent.length === 0 ? (
        <Empty title="Quiet for now">Press Go live to start the chat.</Empty>
      ) : (
        <ul>
          {recent.map(({ event, ts }, i) => {
            const isMessage = event.kind === "message";
            const who = isMessage ? event.message.senderName : event.kind === "bot" ? "Reminder" : "Update";
            const text = isMessage ? event.message.text : "text" in event ? event.text : "";
            const link = event.clientId ? href("conversations", event.clientId) : href("conversations");
            return (
              <li key={i} className="border-b border-line-soft last:border-b-0">
                <a href={link} className="flex gap-3 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-6">
                  {isMessage ? (
                    <Avatar name={who} className="size-8 text-[11px]" />
                  ) : (
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", event.kind === "bot" ? "bg-amber-soft text-amber" : "bg-primary-soft text-primary")}>
                      {event.kind === "bot" ? <BellRing className="size-4" /> : <Activity className="size-4" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-semibold">{who}</span>
                      <span className="truncate text-[12.5px] text-muted">{clients.get(event.clientId ?? "") ?? "Ednovax"}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-faint tabular">{formatTime(ts)}</span>
                    </div>
                    <p className={cn("mt-0.5 line-clamp-2 text-[13.5px]", isMessage ? "text-ink-2" : "text-muted")}>{text}</p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
