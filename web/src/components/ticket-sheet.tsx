import { ChevronDown, ExternalLink, Flag, GitPullRequest, Send, Sparkles, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { clientApi, type Person, type TeamNote, type Ticket, type TicketDetail, type TicketStatus } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { KIND, MOOD, ROLE, STATUS } from "@/lib/palette";
import { setQuery, useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Avatar, SeverityBadge, SlaTimer, StatusBadge } from "./desk";
import { ErrorNote, Loading } from "./page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { Select } from "./ui/select";
import { Sheet, SheetContent } from "./ui/sheet";

const STAFF_ROLES = new Set(["developer", "support"]);

/**
 * The ticket drawer. It opens from anywhere: the URL carries ?ticket=client:issueId.
 * Everything an agent needs in one place: the client's messages, SLA, what the team did,
 * whether other clients have it, a drafted reply, and the actions.
 */
export function TicketSheet() {
  const { query } = useRoute();
  const ref = query.get("ticket");
  const [clientId, issueId] = ref?.split(":") ?? [];

  return (
    <Sheet open={Boolean(clientId && issueId)} onOpenChange={(open) => !open && setQuery("ticket", undefined)}>
      {clientId && issueId && <TicketBody key={ref} clientId={clientId} issueId={issueId} />}
    </Sheet>
  );
}

function TicketBody({ clientId, issueId }: { clientId: string; issueId: string }) {
  const live = useLive();
  const client = clientApi(clientId);
  const [detail, setDetail] = useState<TicketDetail>();
  const [ticket, setTicket] = useState<Ticket>();
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.ticket(issueId), client.tickets(), client.people()])
      .then(([d, tickets, p]) => {
        if (cancelled) return;
        setDetail(d);
        setTicket(tickets.find((t) => t.id === issueId));
        setPeople(p.people);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, issueId, live.version]);

  const title = detail?.issue.title ?? "Ticket";
  const eyebrow = `${ticket?.clientName ?? clientId} · ${issueId}`;

  return (
    <SheetContent title={title} eyebrow={eyebrow}>
      {error && (
        <div className="p-7">
          <ErrorNote message={error} />
        </div>
      )}
      {!detail && !error && <Loading label="Opening the ticket" />}
      {detail && (
        <div className="flex flex-col">
          <Summary detail={detail} ticket={ticket} now={live.clock} />
          <Actions detail={detail} people={people} clientId={clientId} onChanged={live.touch} />
          {detail.pattern && <PatternNote pattern={detail.pattern} />}
          <ReplyDraft clientId={clientId} issueId={issueId} onSent={live.touch} />
          <TeamNotes clientId={clientId} issueId={issueId} version={live.version} />
          <Section title="What the client said">
            <ol className="flex flex-col gap-4">
              {detail.messages.map((m) => {
                const staff = people.find((p) => p.name === m.sender && STAFF_ROLES.has(p.role));
                const mood = m.sentiment && m.sentiment !== "calm" ? MOOD[m.sentiment] : undefined;
                return (
                  <li key={m.id} className="flex gap-3">
                    <Avatar name={m.sender} staff={Boolean(staff)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{m.sender}</span>
                        <span className="text-[12.5px] font-medium text-muted">{formatDateTime(m.ts)}</span>
                        {mood && <Badge tone={mood.tone}>{mood.label}</Badge>}
                      </div>
                      <p className="mt-0.5 text-ink-2">{m.hasMedia && "📷 "}{m.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
          <Timeline detail={detail} />
          <CodeSection detail={detail} />
          {detail.issue.followUps.length > 0 && (
            <Section title="Promises on this ticket">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                {detail.issue.followUps.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </SheetContent>
  );
}

/** A drawer section. Collapsible ones (timeline, code) start folded on phones. */
function Section({ title, children, className, collapsible }: { title: string; children: React.ReactNode; className?: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(() => !collapsible || window.matchMedia("(min-width: 640px)").matches);
  return (
    <section className={cn("border-b border-line-soft px-5 py-5 sm:px-8 sm:py-6", className)}>
      {collapsible ? (
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn("flex items-center gap-1.5 text-[14px] font-semibold text-ink", open && "mb-4")}>
          <ChevronDown className={cn("size-4 text-muted transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
      ) : (
        <h3 className="mb-4 text-[14px] font-semibold text-ink">{title}</h3>
      )}
      {open && children}
    </section>
  );
}

function Summary({ detail, ticket, now }: { detail: TicketDetail; ticket: Ticket | undefined; now: number }) {
  const issue = detail.issue;
  return (
    <div className="border-b border-line-soft bg-card px-5 py-4 sm:px-8 sm:py-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={issue.status} />
        <SeverityBadge severity={issue.severity} />
        <Badge>{KIND[issue.kind] ?? issue.kind}</Badge>
        {issue.escalated && (
          <Badge tone="red">
            <Flag className="size-3" /> Escalated
          </Badge>
        )}
        {ticket && (
          <span className="ml-auto">
            <SlaTimer sla={ticket.sla} now={now} />
          </span>
        )}
      </div>
      {issue.summary && <p className="mt-4 text-ink-2">{issue.summary}</p>}
      {issue.escalated && issue.escalationNote && (
        <p className="mt-3 border-l-2 border-red pl-3 text-[14px] text-red">
          {issue.escalatedBy}: “{issue.escalationNote}”
        </p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
        <Fact label="Reported" value={formatDateTime(issue.createdAt)} />
        <Fact label="First reply" value={issue.firstResponseAt ? formatDateTime(issue.firstResponseAt) : "Not yet"} warn={!issue.firstResponseAt} />
        <Fact label="Owner" value={detail.code?.assignee || ticket?.owner || "Unassigned"} />
        <Fact label="Feature" value={detail.code?.feature || "Not linked"} />
      </dl>
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label !text-[10px]">{label}</dt>
      <dd className={cn("mt-0.5 truncate", warn && "text-red")}>{value}</dd>
    </div>
  );
}

function Actions({ detail, people, clientId, onChanged }: { detail: TicketDetail; people: Person[]; clientId: string; onChanged: () => void }) {
  const user = useUser();
  const client = clientApi(clientId);
  const issue = detail.issue;
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const staff = people.filter((p) => STAFF_ROLES.has(p.role));
  const owner = staff.find((p) => p.name === (detail.code?.assignee ?? ""));

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="border-b border-line-soft px-5 py-4 sm:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Status"
          size="sm"
          value={issue.status === "possibly_resolved" ? "possibly_resolved" : issue.status}
          onValueChange={(to) => to !== "possibly_resolved" && run(() => client.setStatus(issue.id, to as TicketStatus))}
          options={(["open", "in_progress", "resolved"] as const)
            .map((s) => ({ value: s as string, label: STATUS[s].label }))
            .concat(issue.status === "possibly_resolved" ? [{ value: "possibly_resolved", label: STATUS.possibly_resolved.label }] : [])}
        />
        <Select
          label="Assign to"
          size="sm"
          value={owner?.id ?? ""}
          placeholder="Assign to…"
          onValueChange={(personId) => run(() => client.assign(issue.id, personId))}
          options={staff.map((p) => ({ value: p.id, label: p.name, hint: p.role === "developer" ? "Developer" : "Support" }))}
        />
        {!issue.escalated && user.role !== "developer" && (
          <Button variant="outline" size="sm" onClick={() => setEscalating((v) => !v)}>
            <Flag /> Escalate
          </Button>
        )}
        {detail.github?.githubUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={detail.github.githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> GitHub #{detail.github.githubNumber}
            </a>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => run(() => client.openGithubIssue(issue.id))}>
            <GitPullRequest /> Open GitHub issue
          </Button>
        )}
      </div>
      {escalating && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => client.escalate(issue.id, note)).then(() => setEscalating(false));
          }}
        >
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why does this need the lead? (optional)" />
          <Button type="submit" variant="danger">
            Escalate
          </Button>
        </form>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}

/** Other clients have the same problem: counts only, never who. */
function PatternNote({ pattern }: { pattern: NonNullable<TicketDetail["pattern"]> }) {
  const prs = pattern.pullRequests.filter((pr) => pr.number !== null);
  const fixing = prs.find((pr) => pr.state === "open");
  const fixed = prs.find((pr) => pr.state === "merged");
  return (
    <div className="mx-5 mt-5 flex gap-3 rounded-2xl bg-sky-soft px-4 py-4 sm:mx-8 sm:mt-6 sm:gap-4 sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-sky shadow-card">
        <Waypoints className="size-4.5" />
      </span>
      <div className="text-[14.5px]">
        <div className="font-semibold text-ink">
          {pattern.otherClients} other {pattern.otherClients === 1 ? "client has" : "clients have"} the same problem
        </div>
        <div className="mt-0.5 text-ink-2">
          {fixed ? `A fix was merged: #${fixed.number} ${fixed.title}.` : fixing ? `A fix is in review: #${fixing.number} ${fixing.title}.` : "No fix linked yet. When one merges, every affected client is told."}{" "}
          Their names and messages stay private.
        </div>
      </div>
    </div>
  );
}

function ReplyDraft({ clientId, issueId, onSent }: { clientId: string; issueId: string; onSent: () => void }) {
  const client = clientApi(clientId);
  const [text, setText] = useState("");
  const [why, setWhy] = useState<string>();
  const [state, setState] = useState<"idle" | "drafting" | "sending" | "sent">("idle");
  const [error, setError] = useState<string>();

  const draft = async () => {
    setState("drafting");
    setError(undefined);
    try {
      const suggestion = await client.suggestReply(issueId);
      setText(suggestion.reply);
      setWhy(suggestion.source === "template" ? "A simple template (no model key yet)." : suggestion.why);
    } catch (e) {
      setError((e as Error).message);
    }
    setState("idle");
  };

  const send = async () => {
    setState("sending");
    try {
      await client.reply(text);
      setState("sent");
      setText("");
      setWhy(undefined);
      onSent();
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  return (
    <Section title="Reply in the WhatsApp group" className="bg-paper-2/60">
      <Textarea value={text} onChange={(e) => (setText(e.target.value), state === "sent" && setState("idle"))} placeholder="Write to the client, or let Loopkeeper draft it from the ticket…" rows={3} />
      {why && <p className="mt-2 text-[13px] text-muted">Drafted from: {why}</p>}
      {state === "sent" && <p className="mt-2 text-[13px] text-green">Sent to the group. It counts as Ednovax's reply for the SLA.</p>}
      {error && (
        <div className="mt-2">
          <ErrorNote message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={draft} disabled={state === "drafting"}>
          <Sparkles /> {state === "drafting" ? "Drafting…" : "Draft a reply"}
        </Button>
        <Button size="sm" onClick={send} disabled={!text.trim() || state === "sending"}>
          <Send /> Send to group
        </Button>
      </div>
    </Section>
  );
}

function Timeline({ detail }: { detail: TicketDetail }) {
  const issue = detail.issue;
  const entries: Array<{ at: number; text: string; by?: string; because?: string | null }> = [
    { at: issue.createdAt, text: "Reported in the WhatsApp group" },
    ...(issue.firstResponseAt ? [{ at: issue.firstResponseAt, text: "First reply from Ednovax" }] : []),
    ...detail.history.map((h) => ({
      at: h.at,
      text: `${STATUS[h.from]?.label ?? h.from} → ${STATUS[h.to]?.label ?? h.to}`,
      by: h.by,
      because: h.because,
    })),
    ...(detail.github?.pullRequests ?? []).map((pr) => ({ at: 0, text: `Pull request #${pr.number} ${pr.state}: ${pr.title}`, by: pr.author })),
  ].sort((a, b) => (a.at || Infinity) - (b.at || Infinity));

  return (
    <Section title="Timeline" collapsible>
      <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
        {entries.map((entry, i) => (
          <li key={i} className="relative">
            <span className="absolute top-1 -left-[26px] size-2.5 rounded-full bg-primary ring-4 ring-primary-soft" aria-hidden />
            <div className="text-[12.5px] font-medium text-muted">{entry.at ? formatDateTime(entry.at) : "GitHub"}</div>
            <div className="text-[14.5px]">
              {entry.text}
              {entry.by && <span className="text-muted"> · {entry.by}</span>}
            </div>
            {entry.because && <div className="mt-0.5 text-[13.5px] text-muted italic">“{entry.because}”</div>}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CodeSection({ detail }: { detail: TicketDetail }) {
  const code = detail.code;
  const prs = detail.github?.pullRequests ?? [];
  if (!code && prs.length === 0) return null;
  return (
    <Section title="In the code" collapsible>
      {code && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label !text-[10px]">Code owners</div>
            <div className="mt-1">{code.codeOwners.join(", ") || "Unknown"}</div>
          </div>
          <div>
            <div className="label !text-[10px]">Files</div>
            <ul className="mt-1 font-mono text-[12px] text-ink-2">
              {code.files.slice(0, 6).map((f) => (
                <li key={f} className="truncate">
                  {f.split(":").pop()}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {prs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {prs.map((pr) => (
            <li key={pr.number}>
              <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                <GitPullRequest className="size-4" /> #{pr.number} {pr.title}
                <Badge tone={pr.state === "merged" ? "green" : "blue"}>{pr.state}</Badge>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Developers and support talk here; the support number talks to the client. Never sent to the group. */
function TeamNotes({ clientId, issueId, version }: { clientId: string; issueId: string; version: number }) {
  const client = clientApi(clientId);
  const [notes, setNotes] = useState<TeamNote[]>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = () => client.notes(issueId).then(setNotes, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, issueId, version]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.addNote(issueId, text.trim());
      setText("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Section title="Team notes">
      <p className="-mt-2 mb-4 text-[13px] text-muted">Only Ednovax staff see these. The client never does.</p>
      {notes && notes.length > 0 && (
        <ol className="mb-4 flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="flex gap-3">
              <Avatar name={note.by} staff />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{note.by}</span>
                  <span className="text-[12px] text-muted">{ROLE[note.role] ?? note.role}</span>
                  <span className="text-[12px] text-faint">{formatDateTime(note.ts)}</span>
                </div>
                <p className="mt-0.5 text-[14px] whitespace-pre-wrap text-ink-2">{note.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Note for the team, e.g. found it, fix going out tonight" />
      {error && (
        <div className="mt-2">
          <ErrorNote message={error} />
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={add} disabled={!text.trim() || busy}>
          Add note
        </Button>
      </div>
    </Section>
  );
}
