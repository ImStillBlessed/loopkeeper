import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { api, type ClientSummary, type Deployment, type Feature, type Product, type Repo } from "@/lib/api";
import { can, useUser } from "@/lib/auth";
import { formatShortDay, plural } from "@/lib/format";
import { useLiveQuery } from "@/lib/live";
import { TENANCY, type Tone } from "@/lib/palette";
import { href } from "@/lib/router";

/** Ednovax's products: who uses them, their features and code owners, and the GitHub repos behind them. */
export function ProductsPage() {
  const user = useUser();
  const products = useLiveQuery(() => api.products());
  const repos = useLiveQuery(() => api.repos());
  const deployments = useLiveQuery(() => api.deployments());
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const manage = can(user.role, "manage_repos");

  useEffect(() => {
    api.clients().then(setClients, () => undefined);
  }, []);

  const sync = async () => {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await api.syncRepos();
      repos.reload();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Products"
        lead="Our products, who uses them, and the code behind each feature."
        actions={
          repos.data?.githubConfigured && (
            <Button variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={syncing ? "animate-spin" : undefined} /> Sync now
            </Button>
          )
        }
      />

      {repos.data && !repos.data.githubConfigured && (
        <div className="mb-5 border-l-2 border-amber bg-amber-soft px-4 py-3 text-[14px] text-amber">Add a GitHub token in Settings to connect repositories.</div>
      )}
      {(repos.data?.lastError || syncError) && (
        <div className="mb-5">
          <ErrorNote message={`GitHub: ${syncError ?? repos.data?.lastError}`} />
        </div>
      )}
      {products.error && <ErrorNote message={products.error} />}
      {!products.data && !products.error && <Loading />}

      <div className="flex flex-col gap-5">
        {products.data?.map((product) => (
          <ProductPanel
            key={product.key}
            product={product}
            repos={(repos.data?.repos ?? []).filter((r) => r.product === product.key)}
            deployments={(deployments.data ?? []).filter((d) => d.product === product.key)}
            clientNames={clients.filter((c) => product.clients.includes(c.id)).map((c) => c.name)}
            manage={manage && Boolean(repos.data?.githubConfigured)}
            onChange={() => {
              repos.reload();
              products.reload();
            }}
          />
        ))}
      </div>
    </Page>
  );
}

type ClientDeployment = Deployment & { clientId: string; clientName: string };

function ProductPanel({
  product,
  repos,
  deployments,
  clientNames,
  manage,
  onChange,
}: {
  product: Product;
  repos: Repo[];
  deployments: ClientDeployment[];
  clientNames: string[];
  manage: boolean;
  onChange: () => void;
}) {
  const [features, setFeatures] = useState<Feature[]>();
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();

  useEffect(() => {
    api.features(product.key).then(setFeatures, () => setFeatures([]));
  }, [product.key, product.features]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!repo.trim()) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const done = await api.connectRepo(repo.trim(), product.key);
      setResult(`Connected ${done.repo}: ${plural(done.files, "file")}, ${plural(done.features, "feature")}, ${plural(done.owners, "code owner")}.`);
      setRepo("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hidden = product.clients.length - clientNames.length;
  return (
    <Panel title={product.name} action={<span className="text-[12.5px] font-medium text-muted">{plural(product.features, "feature")}</span>}>
      <div className="grid gap-px bg-line-soft md:grid-cols-[1fr_1fr]">
        <div className="bg-card px-5 py-4">
          <p className="text-[15px]">{product.description}</p>
          <div className="label mt-4 mb-1.5">Used by {plural(product.clients.length, "client")}</div>
          <p className="text-[14px] text-ink-2">
            {clientNames.length ? clientNames.join(", ") : "None you look after"}
            {hidden > 0 && clientNames.length > 0 && <span className="text-muted">, and {plural(hidden, "other")}</span>}
          </p>
        </div>
        <div className="bg-card px-5 py-4">
          <div className="label mb-2">GitHub repositories</div>
          {repos.length === 0 && <p className="text-[14px] text-muted">None connected.</p>}
          <ul className="flex flex-col gap-2">
            {repos.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-[14px]">
                <GitBranch className="size-4 shrink-0 text-primary" />
                <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] hover:text-primary hover:underline">
                  {r.id}
                </a>
                <span className="flex-1 truncate text-[12.5px] text-muted">
                  {r.files} files · {r.pullRequests} PRs{r.syncedAt ? ` · synced ${formatShortDay(r.syncedAt)}` : ""}
                </span>
                {manage && (
                  <Confirm
                    title={`Disconnect ${r.id}?`}
                    description="Its files and code owners are removed from this product. Tickets keep their history."
                    action="Disconnect"
                    onConfirm={async () => {
                      await api.removeRepo(r.id);
                      onChange();
                    }}
                  >
                    <button className="grid size-7 place-items-center text-faint hover:text-red" aria-label={`Disconnect ${r.id}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </Confirm>
                )}
              </li>
            ))}
          </ul>
          {manage && (
            <form onSubmit={connect} className="mt-3 flex gap-2">
              <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" aria-label="Repository to connect" className="font-mono text-[13px]" />
              <Button type="submit" variant="navy" disabled={busy || !repo.trim()}>
                {busy ? "Reading…" : "Connect"}
              </Button>
            </form>
          )}
          {error && <p className="mt-2 text-[13px] text-red">{error}</p>}
          {result && <p className="mt-2 text-[13px] text-green">{result}</p>}
        </div>
      </div>

      <Deployments rows={deployments} />

      {!features && <Loading label="Loading features" />}
      {features && features.length === 0 && <Empty title="No features yet">Connect a repository and its features are read from the code.</Empty>}
      {features && features.length > 0 && (
        <div className="overflow-x-auto border-t border-line-soft">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="label py-2 pl-5 font-medium">Feature</th>
                <th className="label hidden py-2 font-medium md:table-cell">What it covers</th>
                <th className="label hidden py-2 text-right font-medium md:table-cell">Files</th>
                <th className="label py-2 pr-5 pl-4 font-medium md:pl-6">Code owners</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key} className="border-b border-line-soft last:border-b-0">
                  <td className="py-2.5 pl-5 font-medium md:whitespace-nowrap">{f.name}</td>
                  <td className="hidden py-2.5 pr-4 text-[14px] text-muted md:table-cell">
                    <span className="line-clamp-1">{f.description}</span>
                  </td>
                  <td className="hidden py-2.5 text-right text-[13px] tabular md:table-cell">{f.files}</td>
                  <td className="py-2.5 pr-5 pl-4 text-[14px] md:pl-6 md:whitespace-nowrap">{f.owners.length ? f.owners.join(", ") : <span className="text-faint">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const TENANCY_TONE: Record<string, Tone> = { own_repo: "neutral", branch: "sky", multi_tenant: "violet" };

/** Which client runs which repo (and branch): merged fixes are routed by this. */
function Deployments({ rows }: { rows: ClientDeployment[] }) {
  if (rows.length === 0) return null;
  const byRepo = new Map<string, ClientDeployment[]>();
  for (const row of rows) byRepo.set(row.repo, [...(byRepo.get(row.repo) ?? []), row]);

  return (
    <div className="border-t border-line-soft px-5 py-4">
      <div className="label mb-3">Clients and deployments</div>
      <div className="grid gap-3 md:grid-cols-2">
        {[...byRepo].map(([repo, clients]) => (
          <div key={repo} className="rounded-xl border border-line-soft bg-paper/60 p-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[12.5px] text-ink-2">
              <GitBranch className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{repo}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {clients.map((d) => (
                <li key={`${d.clientId}:${d.repo}`} className="flex items-center gap-2 text-[14px]">
                  <a href={href("clients", d.clientId)} className="min-w-0 truncate font-medium hover:text-primary">
                    {d.clientName}
                  </a>
                  {d.branch && <span className="truncate font-mono text-[12px] text-muted">@{d.branch}</span>}
                  <Badge tone={TENANCY_TONE[d.tenancy] ?? "neutral"} className="ml-auto shrink-0" title={TENANCY[d.tenancy]?.hint}>
                    {TENANCY[d.tenancy]?.label ?? d.tenancy}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
