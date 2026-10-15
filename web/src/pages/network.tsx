import { useEffect, useMemo, useState } from "react";
import { GlobeGraph, type GlobeNode } from "@/components/globe-graph";
import { ErrorNote, Page, PageHeader, Panel } from "@/components/page";
import { Select } from "@/components/ui/select";
import { api, clientApi, type ClientSummary } from "@/lib/api";
import { useLiveQuery } from "@/lib/live";
import { NODE_COLORS, NODE_NAMES } from "@/lib/palette";
import { href, navigate } from "@/lib/router";

/** One client's own graph as a small world: its messages, people and tickets, linked to product features and code. */
export function NetworkPage({ clientId }: { clientId?: string }) {
  const [clients, setClients] = useState<ClientSummary[]>();
  const [selected, setSelected] = useState<GlobeNode>();

  useEffect(() => {
    api.clients().then(setClients, () => setClients([]));
  }, []);

  const current = clientId ?? clients?.[0]?.id;
  const client = clients?.find((c) => c.id === current);
  const { data, error } = useLiveQuery(() => (current ? clientApi(current).graph() : Promise.resolve(undefined)), [current]);

  useEffect(() => setSelected(undefined), [current]);

  const counts = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const node of data?.nodes ?? []) byLabel.set(node.label, (byLabel.get(node.label) ?? 0) + 1);
    return byLabel;
  }, [data]);

  const highlight = useMemo(() => {
    if (!selected || !data) return [];
    const ids = new Set([selected.id]);
    for (const link of data.links) {
      if (link.source === selected.id) ids.add(link.target);
      if (link.target === selected.id) ids.add(link.source);
    }
    return [...ids];
  }, [selected, data]);

  return (
    <Page>
      <PageHeader
        title="Network"
        lead="One client's knowledge as a graph. Click a point to explore."
        actions={
          clients &&
          clients.length > 0 && (
            <Select label="Client" value={current ?? ""} onValueChange={(id) => navigate(href("network", id))} className="min-w-56" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          )
        }
      />
      {error && <ErrorNote message={error} />}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="card relative h-[min(68vh,640px)] min-h-[420px] overflow-hidden">
          {current && <GlobeGraph data={data} highlight={highlight} onSelect={setSelected} />}
          <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-line-soft bg-card/90 px-3.5 py-2.5 shadow-card">
            {NODE_NAMES.map((n) => (
              <li key={n.label} className="flex items-center gap-1.5 text-[12px]">
                <span className="size-2.5" style={{ backgroundColor: NODE_COLORS[n.label] }} />
                {n.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Whose graph is this">
            <div className="px-5 py-4 text-[14px] leading-relaxed">
              <p>
                This is <span className="font-semibold">{client?.name ?? "this client"}</span>'s own graph: only its messages, people and tickets, plus a copy of the
                product's features and code.
              </p>
              <p className="mt-2 text-muted">No other client's data is stored here.</p>
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-line-soft bg-line-soft">
              <div className="bg-card px-5 py-3">
                <dt className="label">Points</dt>
                <dd className="font-display text-[24px] font-semibold tabular">{data?.nodes.length ?? "—"}</dd>
              </div>
              <div className="bg-card px-5 py-3">
                <dt className="label">Links</dt>
                <dd className="font-display text-[24px] font-semibold tabular">{data?.links.length ?? "—"}</dd>
              </div>
            </dl>
            <ul className="border-t border-line-soft px-5 py-3">
              {[...counts]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <li key={label} className="flex items-center gap-2 py-0.5 text-[13px]">
                    <span className="size-2" style={{ backgroundColor: NODE_COLORS[label] ?? "#8A8F9C" }} />
                    <span className="flex-1">{label}</span>
                    <span className="font-mono tabular text-muted">{count}</span>
                  </li>
                ))}
            </ul>
          </Panel>

          {selected && (
            <Panel title="Selected">
              <div className="px-5 py-4">
                <div className="label mb-1">{selected.label}</div>
                <p className="font-medium break-words">{selected.name || selected.id}</p>
                {selected.status && <p className="mt-1 text-[13px] text-muted">Status: {selected.status}</p>}
                <p className="mt-2 text-[13px] text-muted">{highlight.length - 1} connected points lit up.</p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}
