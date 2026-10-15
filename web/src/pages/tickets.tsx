import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { isOpen } from "@/components/desk";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { TicketTable } from "@/components/ticket-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api, type Ticket } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { plural } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { SEVERITY } from "@/lib/palette";
import { navigate, href, useRoute } from "@/lib/router";

type View = "open" | "mine" | "breached" | "due_soon" | "escalated" | "resolved" | "all";

const VIEWS: Array<{ id: View; label: string; matches: (t: Ticket, me: string) => boolean }> = [
  { id: "open", label: "Open", matches: (t) => isOpen(t) },
  { id: "mine", label: "Mine", matches: (t, me) => isOpen(t) && t.owner === me },
  { id: "breached", label: "Past SLA", matches: (t) => isOpen(t) && t.sla.state === "breached" },
  { id: "due_soon", label: "Due soon", matches: (t) => isOpen(t) && t.sla.state === "due_soon" },
  { id: "escalated", label: "Escalated", matches: (t) => isOpen(t) && t.escalated },
  { id: "resolved", label: "Resolved", matches: (t) => t.status === "resolved" },
  { id: "all", label: "All", matches: () => true },
];

/** The queue across every client this person can see, most urgent first (the server sorts it). */
export function TicketsPage() {
  const user = useUser();
  const live = useLive();
  const { query } = useRoute();
  const view = (VIEWS.some((v) => v.id === query.get("view")) ? query.get("view") : "open") as View;
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("all");
  const [severity, setSeverity] = useState("all");
  const { data, error } = useLiveQuery(api.tickets);

  const counts = useMemo(() => new Map(VIEWS.map((v) => [v.id, (data ?? []).filter((t) => v.matches(t, user.name)).length])), [data, user.name]);
  const clients = useMemo(() => [...new Map((data ?? []).map((t) => [t.clientId, t.clientName]))].sort((a, b) => a[1].localeCompare(b[1])), [data]);

  const shown = (data ?? []).filter((t) => {
    const definition = VIEWS.find((v) => v.id === view)!;
    if (!definition.matches(t, user.name)) return false;
    if (client !== "all" && t.clientId !== client) return false;
    if (severity !== "all" && t.severity !== severity) return false;
    const needle = search.trim().toLowerCase();
    return !needle || `${t.title} ${t.clientName} ${t.owner} ${t.id}`.toLowerCase().includes(needle);
  });

  return (
    <Page>
      <PageHeader
        title="Tickets"
        lead="Opened automatically from WhatsApp. Most urgent first."
      />
      {error && <ErrorNote message={error} />}
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3.5">
          <Segmented
            label="Which tickets"
            value={view}
            onChange={(v) => navigate(href("tickets", { view: v }))}
            options={VIEWS.map((v) => ({ id: v.id, label: `${v.label} ${counts.get(v.id) ?? ""}`.trim() }))}
          />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Select
              label="Client"
              size="sm"
              value={client}
              onValueChange={setClient}
              options={[{ value: "all", label: "All clients" }, ...clients.map(([id, name]) => ({ value: id, label: name }))]}
            />
            <Select
              label="Severity"
              size="sm"
              value={severity}
              onValueChange={setSeverity}
              options={[{ value: "all", label: "Any severity" }, ...Object.entries(SEVERITY).map(([value, s]) => ({ value, label: s.label }))]}
            />
            <div className="relative w-full sm:w-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets" className="h-9 w-full pl-8 text-[13.5px] sm:w-52" aria-label="Search tickets" />
            </div>
          </div>
        </div>
        {!data && !error ? (
          <Loading />
        ) : (
          <>
            <TicketTable
              tickets={shown}
              now={live.clock}
              empty={<Empty title="No tickets here">{view === "mine" ? "Nothing is assigned to you right now." : "Try another view or clear the filters."}</Empty>}
            />
            {shown.length > 0 && <div className="border-t border-line-soft px-5 py-3 text-[12.5px] font-medium text-muted">{plural(shown.length, "ticket")}</div>}
          </>
        )}
      </Panel>
    </Page>
  );
}
