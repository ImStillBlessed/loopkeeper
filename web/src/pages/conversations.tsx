import { Waypoints } from "lucide-react";
import { useState } from "react";
import { Feed, ReplyBox } from "@/components/feed";
import { TeachersPanel } from "@/components/teachers";
import { HubComposer, HubFeed, useHubPending } from "@/components/hub-feed";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel } from "@/components/page";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { ago } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { HEALTH } from "@/lib/palette";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

/** Roles that see every client may open the central support hub. */
const HUB_ROLES = new Set(["admin", "lead", "developer"]);

/** Every client's WhatsApp group in one place: pick a client on the left, read and reply on the right. */
export function ConversationsPage({ clientId }: { clientId?: string }) {
  const { events, clock, running } = useLive();
  const seesHub = HUB_ROLES.has(useUser().role);
  const hubPending = useHubPending(seesHub);
  const hubOpen = seesHub && clientId === "hub";
  const { data, error } = useLiveQuery(api.clients);
  // Count live messages since this page opened, as a light "new" marker per client.
  const [start] = useState(() => events.length);

  const fresh = new Map<string, number>();
  for (const event of events.slice(start)) {
    if (event.kind === "message" && event.message.relevant && event.clientId) fresh.set(event.clientId, (fresh.get(event.clientId) ?? 0) + 1);
  }

  const clients = [...(data ?? [])].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const selected = hubOpen ? undefined : (clients.find((c) => c.id === clientId) ?? clients[0]);

  return (
    <Page>
      <PageHeader
        title="Conversations"
        lead="Each client's WhatsApp group. Reply right here."
        actions={!running && <span className="hidden text-[12.5px] font-medium text-muted sm:inline">Quiet. Press Go live to start the chat.</span>}
      />
      {error && <ErrorNote message={error} />}
      {!data ? (
        <Loading label="Loading clients" />
      ) : clients.length === 0 ? (
        <Empty title="No clients yet">Add a client in Settings to see its WhatsApp group here.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Phones: the groups as a row of chips you can scroll sideways. */}
          <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden" aria-label="Groups">
            {seesHub && (
              <a
                href={href("conversations", "hub")}
                aria-current={hubOpen ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold whitespace-nowrap",
                  hubOpen ? "border-primary bg-primary text-white" : "border-line bg-card text-ink-2",
                )}
              >
                <Waypoints className="size-3.5" />
                Central hub
                {hubPending > 0 && <span className={cn("rounded-full px-1.5 text-[11.5px]", hubOpen ? "bg-white/25" : "bg-amber text-white")}>{hubPending}</span>}
              </a>
            )}
            {clients.map((client) => {
              const active = client.id === selected?.id;
              const count = fresh.get(client.id) ?? 0;
              return (
                <a
                  key={client.id}
                  href={href("conversations", client.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold whitespace-nowrap",
                    active ? "border-primary bg-primary text-white" : "border-line bg-card text-ink-2",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: active ? "white" : HEALTH[client.health.band].color }} aria-hidden />
                  {client.name}
                  {count > 0 && <span className={cn("rounded-full px-1.5 text-[11.5px]", active ? "bg-white/25" : "bg-primary text-white")}>{count}</span>}
                </a>
              );
            })}
          </nav>
          <Panel title="Groups" className="hidden lg:flex">
            <ul>
              {seesHub && (
                <li>
                  <a
                    href={href("conversations", "hub")}
                    aria-current={hubOpen ? "page" : undefined}
                    className={cn("relative flex items-center gap-3 border-b border-line-soft px-5 py-3.5 transition-colors", hubOpen ? "bg-primary-soft" : "hover:bg-paper-2")}
                  >
                    {hubOpen && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" aria-hidden />}
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sky-soft text-sky" aria-hidden>
                      <Waypoints className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">Central hub</div>
                      <div className="truncate text-[12.5px] font-medium text-muted">Forwards from every school</div>
                    </div>
                    {hubPending > 0 && <span className="rounded-full bg-amber px-2 text-[12px] font-semibold text-white tabular">{hubPending}</span>}
                  </a>
                </li>
              )}
              {clients.map((client) => {
                const active = client.id === selected?.id;
                const count = fresh.get(client.id) ?? 0;
                return (
                  <li key={client.id}>
                    <a
                      href={href("conversations", client.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 border-b border-line-soft px-5 py-3.5 transition-colors",
                        active ? "bg-primary-soft" : "hover:bg-paper-2",
                      )}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" aria-hidden />}
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: HEALTH[client.health.band].color }} aria-label={HEALTH[client.health.band].label} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{client.name}</div>
                        <div className="text-[12.5px] font-medium text-muted">{client.lastMessageAt ? ago(client.lastMessageAt, clock) : "No messages yet"}</div>
                      </div>
                      {count > 0 && <span className="rounded-full bg-primary px-2 text-[12px] font-semibold text-primary-ink tabular">{count} new</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {hubOpen && (
            <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
              <Panel title="Central support hub">
                <HubFeed className="h-[460px] sm:h-[620px]" />
              </Panel>
              <Panel title="Write in the hub" bodyClassName="p-4">
                <HubComposer />
              </Panel>
            </div>
          )}

          {selected && (
            <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
              <Panel
                title={selected.name}
                action={
                  <a href={href("clients", selected.id)} className="text-[13.5px] font-semibold text-primary hover:underline">
                    Client profile
                  </a>
                }
              >
                <Feed clientId={selected.id} className="h-[460px] sm:h-[620px]" />
              </Panel>
              <div className="flex flex-col gap-5">
                <Panel title="Reply" bodyClassName="p-4">
                  <ReplyBox key={selected.id} clientId={selected.id} />
                </Panel>
                <TeachersPanel key={selected.id} clientId={selected.id} />
              </div>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
