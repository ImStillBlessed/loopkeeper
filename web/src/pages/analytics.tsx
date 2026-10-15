import { useEffect, useState } from "react";
import { BarChart, DailyChart, Stat, StatStrip } from "@/components/charts";
import { ErrorNote, Loading, Page, PageHeader, Panel } from "@/components/page";
import { Select } from "@/components/ui/select";
import { api, type ClientSummary, type Product } from "@/lib/api";
import { formatShortDay } from "@/lib/format";
import { useLiveQuery } from "@/lib/live";
import { KIND } from "@/lib/palette";

const ALL = "all";

/** 30-day trends: how much comes in, how fast the team answers and fixes, and where problems cluster. */
export function AnalyticsPage() {
  const [client, setClient] = useState(ALL);
  const [product, setProduct] = useState(ALL);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    api.clients().then(setClients, () => undefined);
    api.products().then(setProducts, () => undefined);
  }, []);

  const { data, error } = useLiveQuery(
    () => api.analytics({ client: client === ALL ? undefined : client, product: product === ALL ? undefined : product }),
    [client, product],
  );

  const compliance = data?.slaCompliance;
  return (
    <Page>
      <PageHeader
        title="Analytics"
        lead={data ? `Last 30 days, ${formatShortDay(data.from)} to ${formatShortDay(data.to)}.` : "Last 30 days."}
        actions={
          <>
            <Select
              label="Client"
              value={client}
              onValueChange={setClient}
              className="sm:min-w-48"
              options={[{ value: ALL, label: "All clients" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <Select
              label="Product"
              value={product}
              onValueChange={setProduct}
              className="sm:min-w-44"
              options={[{ value: ALL, label: "All products" }, ...products.map((p) => ({ value: p.key, label: p.name }))]}
            />
          </>
        }
      />

      {error && <ErrorNote message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="flex flex-col gap-5">
          <StatStrip>
            <Stat label="Opened" value={data.totals.opened} hint="tickets in 30 days" />
            <Stat label="Resolved" value={data.totals.resolved} hint="of those opened" />
            <Stat label="Open now" value={data.totals.open} tone={data.totals.open > 0 ? "amber" : undefined} />
            <Stat label="First reply" value={data.medianFirstResponseMins === null ? "—" : `${data.medianFirstResponseMins} min`} hint="median" />
            <Stat label="Time to fix" value={data.medianResolveHours === null ? "—" : `${data.medianResolveHours} h`} hint="median" />
            <Stat
              label="SLA met"
              value={compliance === null || compliance === undefined ? "—" : `${compliance}%`}
              hint="of tickets judged"
              tone={compliance == null ? undefined : compliance >= 90 ? "green" : compliance >= 70 ? "amber" : "red"}
            />
          </StatStrip>

          <Panel title="Tickets per day">
            <DailyChart daily={data.daily} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="By feature">
              <BarChart data={data.byFeature} />
            </Panel>
            <Panel title="By client">
              <BarChart data={data.byClient} />
            </Panel>
            <Panel title="By kind">
              <BarChart data={data.byKind.map((k) => ({ label: KIND[k.label] ?? k.label, value: k.value }))} />
            </Panel>
          </div>
        </div>
      )}
    </Page>
  );
}
