import { ArrowRight, Check, Copy, MessageCircleQuestion, MessagesSquare, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { HealthBadge, HealthMeter, isOpen } from "@/components/desk";
import { Feed, ReplyBox } from "@/components/feed";
import { TeachersPanel } from "@/components/teachers";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel, Segmented, Tabs } from "@/components/page";
import { TicketTable } from "@/components/ticket-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { clientApi, type ClientSummary, type Group, type Person, type SlaPolicy, type Ticket } from "@/lib/api";
import { ago, formatDateTime, minutesAsWords, plural } from "@/lib/format";
import { can, useUser } from "@/lib/auth";
import { useLive, useLiveQuery } from "@/lib/live";
import { CLIENT_TYPE, PLAN, PRODUCT_NAMES } from "@/lib/palette";
import { href, navigate, openTicket } from "@/lib/router";
import { cn } from "@/lib/utils";

type TabId = "overview" | "conversations" | "tickets" | "promises" | "contacts" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "conversations", label: "Conversations" },
  { id: "tickets", label: "Tickets" },
  { id: "promises", label: "Promises & decisions" },
  { id: "contacts", label: "Contacts" },
  { id: "settings", label: "Settings" },
];

/** One client's profile: health, conversation, tickets, promises, contacts and its groups. */
export function ClientPage({ clientId, tab }: { clientId: string; tab: string }) {
  const user = useUser();
  const client = useMemo(() => clientApi(clientId), [clientId]);
  const summary = useLiveQuery(() => client.summary(), [clientId]);
  const tickets = useLiveQuery(() => client.tickets(), [clientId]);
  const active = (TABS.some((t) => t.id === tab) ? tab : "overview") as TabId;

  if (summary.error) {
    return (
      <Page>
        <ErrorNote message={/access/i.test(summary.error) ? "You don't have access to this client." : summary.error} />
      </Page>
    );
  }
  const s = summary.data;
  if (!s) return <Loading label="Loading client" />;

  const openCount = (tickets.data ?? []).filter(isOpen).length;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <a href={href("clients")} className="hover:text-primary">
            Clients
          </a>
        }
        title={s.name}
        lead={`${CLIENT_TYPE[s.type]} in ${s.city || "an unknown city"} · ${PLAN[s.plan]} plan · Agent: ${s.agentName || "unassigned"}`}
        actions={
          <>
            <HealthBadge health={s.health} />
            <HealthMeter health={s.health} />
          </>
        }
      />
      <Tabs
        tabs={TABS.filter((t) => t.id !== "settings" || can(user.role, "manage_groups")).map((t) => (t.id === "tickets" ? { ...t, count: openCount } : t))}
        active={active}
        onChange={(id) => navigate(href("clients", clientId, id))}
        className="mb-6"
      />

      {active === "overview" && <OverviewTab clientId={clientId} summary={s} tickets={tickets.data} />}
      {active === "conversations" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="WhatsApp conversation">
            <Feed clientId={clientId} />
          </Panel>
          <div className="flex flex-col gap-5">
            <Panel title="Reply" bodyClassName="p-4">
              <ReplyBox clientId={clientId} />
            </Panel>
            <TeachersPanel clientId={clientId} />
          </div>
        </div>
      )}
      {active === "tickets" && <TicketsTab tickets={tickets.data} error={tickets.error} />}
      {active === "promises" && <PromisesTab clientId={clientId} />}
      {active === "contacts" && <ContactsTab clientId={clientId} />}
      {active === "settings" && <SettingsTab clientId={clientId} />}
    </Page>
  );
}

function OverviewTab({
  clientId,
  summary,
  tickets,
}: {
  clientId: string;
  summary: ClientSummary & { sla: SlaPolicy | null };
  tickets: Ticket[] | undefined;
}) {
  const { clock } = useLive();
  const open = (tickets ?? []).filter(isOpen);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Health" bodyClassName="p-5" collapsible defaultOpen="desktop" summary={summary.health.score}>
        <HealthMeter health={summary.health} />
        {summary.health.reasons.length === 0 ? (
          <p className="mt-4 text-muted">Nothing is pulling health down.</p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {summary.health.reasons.map((r) => (
              <li key={r.text} className="flex justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
                <span>{r.text}</span>
                <span className="font-mono text-red tabular">−{r.points}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Service promise" bodyClassName="p-5" collapsible defaultOpen="desktop">
        {summary.sla ? (
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="label">First reply within</dt>
              <dd className="font-display text-[22px] font-semibold">{minutesAsWords(summary.sla.firstResponseMins)}</dd>
            </div>
            <div>
              <dt className="label">Fixed within</dt>
              <dd className="font-display text-[22px] font-semibold">{minutesAsWords(summary.sla.resolveMins)}</dd>
            </div>
            <p className="text-[13px] text-muted">From the {PLAN[summary.plan].toLowerCase()} plan. Feature requests only need a first reply.</p>
          </dl>
        ) : (
          <p className="text-muted">No SLA policy for this plan.</p>
        )}
      </Panel>

      <Panel title="At a glance" bodyClassName="p-5">
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="Open tickets" value={summary.openTickets} />
          <Stat label="SLA breaches" value={summary.breached} alert={summary.breached > 0} />
          <Stat label="Messages read" value={summary.seen} />
          <Stat label="Last message" value={summary.lastMessageAt ? ago(summary.lastMessageAt, clock) : "Never"} />
        </dl>
        <div className="mt-4 text-[13px] text-muted">Uses {summary.products.map((p) => PRODUCT_NAMES[p] ?? p).join(", ")}</div>
        <Button asChild variant="outline" className="mt-4 w-full">
          <a href={href("ask", { scope: clientId })}>
            <MessageCircleQuestion /> Ask about this client
          </a>
        </Button>
      </Panel>

      <Panel title={`Open tickets (${open.length})`} className="lg:col-span-2">
        {!tickets ? <Loading /> : <TicketTable tickets={open} now={clock} showClient={false} empty={<Empty title="No open tickets">Everything this client reported is resolved.</Empty>} />}
      </Panel>

      <Panel
        title="Latest messages"
        collapsible
        defaultOpen="desktop"
        action={
          <a href={href("clients", clientId, "conversations")} className="flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
            Open <ArrowRight className="size-3.5" />
          </a>
        }
      >
        <Feed clientId={clientId} limit={4} />
      </Panel>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={cn("font-display text-[24px] font-semibold tabular", alert && "text-red")}>{value}</dd>
    </div>
  );
}

function TicketsTab({ tickets, error }: { tickets: Ticket[] | undefined; error?: string }) {
  const { clock } = useLive();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const shown = (tickets ?? []).filter((t) => (filter === "all" ? true : filter === "open" ? isOpen(t) : t.status === "resolved"));
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Which tickets"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "open", label: "Open" },
          { id: "resolved", label: "Resolved" },
          { id: "all", label: "All" },
        ]}
      />
      {error && <ErrorNote message={error} />}
      <Panel>{!tickets ? <Loading /> : <TicketTable tickets={shown} now={clock} showClient={false} empty={<Empty title="Nothing here">No tickets match this filter.</Empty>} />}</Panel>
    </div>
  );
}

function PromisesTab({ clientId }: { clientId: string }) {
  const { data, error } = useLiveQuery(() => clientApi(clientId).followUps(), [clientId]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={`Promises (${data.followUps.length})`} className="lg:col-span-2">
        {data.followUps.length === 0 ? (
          <Empty title="No open promises">When someone says "I'll send it by Thursday", it shows up here with a due date.</Empty>
        ) : (
          <ul>
            {data.followUps.map((f) => {
              const overdue = f.status === "overdue" || f.dueAt < data.now;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{f.text}</div>
                    <div className="text-[13px] text-muted">
                      Owed by {f.owner}
                      {f.issueId && (
                        <>
                          {" · "}
                          <button onClick={() => openTicket(clientId, f.issueId!)} className="text-primary hover:underline">
                            {f.issue}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={cn("font-mono text-[12px] whitespace-nowrap", overdue ? "font-semibold text-red" : "text-muted")}>
                    {overdue ? "Overdue since " : "Due "}
                    {formatDateTime(f.dueAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title={`Decisions (${data.decisions.length})`} collapsible defaultOpen="desktop">
        {data.decisions.length === 0 ? (
          <Empty title="No decisions yet">Agreements like "move the mock exam to Friday" are recorded here.</Empty>
        ) : (
          <ul>
            {data.decisions.map((d) => (
              <li key={d.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                <div>{d.text}</div>
                <div className="text-[12.5px] font-medium text-muted">
                  {d.by} · {formatDateTime(d.ts)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={`Reminders sent (${data.reminders.length})`} collapsible defaultOpen="desktop">
        {data.reminders.length === 0 ? (
          <Empty title="No reminders sent">Loopkeeper reminds people in the group when a promise falls due.</Empty>
        ) : (
          <ul>
            {data.reminders.map((r) => (
              <li key={r.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                <div className="text-[14px]">{r.text}</div>
                <div className="text-[12.5px] font-medium text-muted">
                  To {r.to} · {formatDateTime(r.sentAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const STAFF_ROLES = new Set(["developer", "support"]);

function ContactsTab({ clientId }: { clientId: string }) {
  const { data, error } = useLiveQuery(() => clientApi(clientId).people(), [clientId]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const atClient = data.people.filter((p) => !STAFF_ROLES.has(p.role));
  const team = data.people.filter((p) => STAFF_ROLES.has(p.role));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">Built automatically from the WhatsApp group: anyone who writes there is added.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <PeopleList title={`At the client (${atClient.length})`} people={atClient} />
        <PeopleList title={`Ednovax team (${team.length})`} people={team} staff />
      </div>
    </div>
  );
}

function PeopleList({ title, people, staff }: { title: string; people: Person[]; staff?: boolean }) {
  return (
    <Panel title={title}>
      {people.length === 0 ? (
        <Empty title="Nobody yet" />
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-b-0">
              <span className={cn("grid size-9 place-items-center rounded-full text-[12px] font-bold", staff ? "bg-primary text-white" : "bg-sky-soft text-sky")}>
                {p.name
                  .replace(/^(Mr|Mrs|Miss|Ms|Mallam|Dr)\.?\s+/i, "")
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-[13px] text-muted">{p.school ?? (staff ? "Ednovax" : "")}</div>
              </div>
              <Badge tone={staff ? "navy" : "neutral"}>{p.role === "unknown" ? "Contact" : p.role}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const SOURCE: Record<Group["source"], string> = { simulator: "Simulated", whatsapp_export: "WhatsApp export", wa_cloud: "WhatsApp Cloud API" };

function SettingsTab({ clientId }: { clientId: string }) {
  const client = clientApi(clientId);
  const { touch } = useLive();
  const groups = useLiveQuery(() => client.groups(), [clientId]);
  const [newGroup, setNewGroup] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [importGroup, setImportGroup] = useState("");
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setError(undefined);
    try {
      await action();
      setNote(done);
      groups.reload();
      touch();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = groups.data ?? [];
  const target = importGroup || list[0]?.id || "";

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <WhatsAppGroupPanel clientId={clientId} linked={list.find((g) => g.source === "wa_cloud")} onCreated={() => (groups.reload(), touch())} />
      <Panel title="WhatsApp groups" className="lg:col-span-2">
        {!groups.data ? (
          <Loading />
        ) : (
          <ul>
            {list.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-b-0">
                {editing?.id === g.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(() => client.renameGroup(g.id, editing.name), "Renamed.").then(() => setEditing(undefined));
                    }}
                  >
                    <Input value={editing.name} onChange={(e) => setEditing({ id: g.id, name: e.target.value })} autoFocus />
                    <Button type="submit" size="default">
                      Save
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{g.name}</div>
                      <div className="text-[12.5px] font-medium text-muted">
                        {SOURCE[g.source] ?? g.source} · {plural(g.seen ?? 0, "message")}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" aria-label={`Rename ${g.name}`} onClick={() => setEditing({ id: g.id, name: g.name })}>
                      <Pencil />
                    </Button>
                    <Confirm
                      title={`Remove "${g.name}"?`}
                      description="The group is removed from this client. Tickets already learned from it stay."
                      action="Remove group"
                      onConfirm={() => act(() => client.removeGroup(g.id), "Removed.")}
                    >
                      <Button variant="ghost" size="icon" aria-label={`Remove ${g.name}`}>
                        <Trash2 />
                      </Button>
                    </Confirm>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2 border-t border-line-soft px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGroup.trim()) return;
            void act(() => client.addGroup(newGroup.trim(), "simulator"), "Group added.").then(() => setNewGroup(""));
          }}
        >
          <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New simulated group name" />
          <Button type="submit" variant="navy" disabled={!newGroup.trim()}>
            <Plus /> Add group
          </Button>
        </form>
      </Panel>

      <Panel title="Import a WhatsApp chat" bodyClassName="p-5 flex flex-col gap-3" collapsible defaultOpen={false}>
        <p className="text-[14px] text-muted">In WhatsApp, open the group → More → Export chat (without media), then upload the .txt file here. It's read in the background.</p>
        {list.length > 0 && (
          <Select label="Import into" value={target} onValueChange={setImportGroup} options={list.map((g) => ({ value: g.id, label: g.name }))} />
        )}
        <input
          ref={file}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (!chosen || !target) return;
            const text = await chosen.text();
            await act(async () => {
              const result = await client.importExport(target, text);
              setNote(`Reading ${plural(result.messages, "message")} in the background.`);
            });
          }}
        />
        <Button variant="outline" onClick={() => file.current?.click()} disabled={!target}>
          <Upload /> Choose export file
        </Button>
      </Panel>

      <Panel title="Start over" bodyClassName="p-5 flex flex-col gap-3" collapsible defaultOpen={false}>
        <p className="text-[14px] text-muted">Forget every ticket, promise and message learned for this client. Groups and contacts stay.</p>
        <Confirm
          title="Forget everything learned?"
          description="Tickets, promises, decisions and stored messages for this client are deleted. This can't be undone."
          action="Forget everything"
          onConfirm={() => act(() => client.reset(), "Cleared.")}
        >
          <Button variant="danger">Forget everything learned</Button>
        </Confirm>
      </Panel>

      {(note || error) && <div className="lg:col-span-2">{error ? <ErrorNote message={error} /> : <p className="font-mono text-[12px] text-green">{note}</p>}</div>}
    </div>
  );
}

/**
 * The client's real WhatsApp group on the support number. Groups are small (up to 8 people), so the
 * client's main contacts join with an invite link and one Ednovax support person bridges to the team.
 */
function WhatsAppGroupPanel({ clientId, linked, onCreated }: { clientId: string; linked: Group | undefined; onCreated: () => void }) {
  const user = useUser();
  const manage = can(user.role, "manage_clients");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await clientApi(clientId).createWhatsAppGroup();
      setInvite(created.inviteLink);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="WhatsApp group" className="lg:col-span-2" bodyClassName="px-5 pb-5 flex flex-col gap-3">
      {linked ? (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-green-soft text-green">
            <MessagesSquare className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{linked.name}</div>
            <div className="text-[13px] text-muted">Linked to the support number. Replies sent here go to this group.</div>
          </div>
          <Badge tone="green" className="ml-auto shrink-0">
            Linked
          </Badge>
        </div>
      ) : (
        <>
          <p className="text-[14px] text-muted">The support number creates the group. The client's main contacts join with an invite link.</p>
          {manage ? (
            <Button className="self-start" onClick={create} disabled={busy}>
              <Plus /> {busy ? "Creating…" : "Create WhatsApp group"}
            </Button>
          ) : (
            <p className="text-[13.5px] text-muted">Only a support lead or an admin can create the group.</p>
          )}
        </>
      )}
      {invite !== undefined && (
        <div className="flex flex-col gap-2 rounded-xl bg-green-soft p-4">
          <p className="text-[14px] text-green">Share this link with up to 7 main contacts. The support number is already in.</p>
          {invite ? (
            <div className="flex gap-2">
              <Input value={invite} readOnly className="min-w-0 font-mono text-[12.5px]" onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                aria-label="Copy invite link"
                onClick={() => {
                  void navigator.clipboard?.writeText(invite);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">WhatsApp didn't return an invite link. Create one from the support number's WhatsApp.</p>
          )}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </Panel>
  );
}
