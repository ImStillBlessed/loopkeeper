import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { HealthMeter } from "@/components/desk";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ClientSummary } from "@/lib/api";
import { can, useUser } from "@/lib/auth";
import { ago } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { CLIENT_TYPE, PLAN, PRODUCT_NAMES, HEALTH } from "@/lib/palette";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

type Band = "all" | ClientSummary["health"]["band"];

/** Every client this person looks after, with health, open work and when they last wrote. */
export function ClientsPage() {
  const user = useUser();
  const { clock } = useLive();
  const { data, error } = useLiveQuery(api.clients);
  const [band, setBand] = useState<Band>("all");
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();
  const clients = (data ?? [])
    .filter((c) => band === "all" || c.health.band === band)
    .filter((c) => !needle || `${c.name} ${c.city} ${c.agentName}`.toLowerCase().includes(needle))
    .sort((a, b) => a.health.score - b.health.score);

  return (
    <Page>
      <PageHeader
        title="Clients"
        lead="Schools and centres we support. Least healthy first."
        actions={
          can(user.role, "manage_clients") && (
            <Button asChild>
              <a href={href("settings", { section: "clients" })}>
                <Plus /> Add client
              </a>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Filter by health"
          value={band}
          onChange={setBand}
          options={[
            { id: "all", label: "All" },
            { id: "at_risk", label: "At risk" },
            { id: "watch", label: "Watch" },
            { id: "healthy", label: "Healthy" },
          ]}
        />
        <div className="relative w-full sm:ml-auto sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients, cities, agents" className="pl-9" />
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      <Panel>
        {!data ? (
          <Loading label="Loading clients" />
        ) : clients.length === 0 ? (
          <Empty title="No clients match">Try another filter, or clear the search.</Empty>
        ) : (
          <>
          <ul className="md:hidden">
            {clients.map((client) => (
              <li key={client.id} className="border-b border-line-soft last:border-b-0">
                <a href={href("clients", client.id)} className="flex items-center gap-3 px-4 py-3.5 active:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{client.name}</span>
                      {client.plan === "premium" && <Badge tone="navy">{PLAN.premium}</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">
                      {client.city || CLIENT_TYPE[client.type]} · {client.openTickets} open
                      {client.breached > 0 && <span className="font-semibold text-red"> · {client.breached} past SLA</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-display text-[20px] leading-none font-semibold tabular" style={{ color: HEALTH[client.health.band].color }}>
                      {client.health.score}
                    </span>
                    <span className="text-[12px] font-semibold" style={{ color: HEALTH[client.health.band].color }}>
                      {HEALTH[client.health.band].label}
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Client", "Plan", "Products", "Agent", "Health", "Open", "SLA breaches", "Last message"].map((h, i) => (
                    <th key={h} className={cn("label py-2.5 pr-4 font-medium", i === 0 && "pl-5", i >= 5 && "text-right", i === 7 && "pr-5")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="group border-b border-line-soft transition-colors hover:bg-paper-2">
                    <td className="py-3.5 pr-4 pl-5">
                      <a href={href("clients", client.id)} className="font-display text-[17px] font-semibold tracking-tight group-hover:text-primary">
                        {client.name}
                      </a>
                      <div className="text-[13px] text-muted">
                        {CLIENT_TYPE[client.type]} · {client.city || "No city"}
                      </div>
                    </td>
                    <td className="py-3.5 pr-4">
                      <Badge tone={client.plan === "premium" ? "navy" : "neutral"}>{PLAN[client.plan]}</Badge>
                    </td>
                    <td className="py-3.5 pr-4 text-[13.5px] text-ink-2">{client.products.map((p) => PRODUCT_NAMES[p] ?? p).join(", ")}</td>
                    <td className="py-3.5 pr-4 text-[14px] whitespace-nowrap">{client.agentName || <span className="text-faint">Unassigned</span>}</td>
                    <td className="py-3.5 pr-4">
                      <HealthMeter health={client.health} size="sm" />
                    </td>
                    <td className="py-3.5 pr-4 text-right font-mono text-[14px] tabular">{client.openTickets}</td>
                    <td className={cn("py-3.5 pr-4 text-right font-mono text-[14px] tabular", client.breached > 0 ? "font-semibold text-red" : "text-faint")}>{client.breached}</td>
                    <td className="py-3.5 pr-5 text-right text-[12.5px] font-medium whitespace-nowrap text-muted">{client.lastMessageAt ? ago(client.lastMessageAt, clock) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>
    </Page>
  );
}
