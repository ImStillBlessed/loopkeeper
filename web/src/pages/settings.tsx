import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel, Tabs } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  api,
  type ClientInput,
  type ClientSummary,
  type Deployment,
  type Product,
  type SecretSetting,
  type SettingKey,
  type Settings,
  type SlaPolicy,
  type StaffMember,
  type Tenancy,
  type WhatsAppGroup,
} from "@/lib/api";
import { can, useUser } from "@/lib/auth";
import { minutesAsWords } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { CLIENT_TYPE, PLAN, PRODUCT_NAMES, ROLE, TENANCY } from "@/lib/palette";
import { href, navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

type Section = "team" | "clients" | "sla" | "connections" | "demo";

/** Who works the desk, which clients exist, SLA targets, keys, and the demo data. */
export function SettingsPage({ section }: { section: string }) {
  const user = useUser();
  const tabs: Array<{ id: Section; label: string }> = [
    { id: "team", label: "Team" },
    { id: "clients", label: "Clients" },
    { id: "sla", label: "SLA" },
    { id: "connections", label: "Connections" },
    ...(can(user.role, "restore_demo") ? [{ id: "demo" as Section, label: "Demo" }] : []),
  ];
  const active = (tabs.find((t) => t.id === section)?.id ?? "team") as Section;

  return (
    <Page>
      <PageHeader title="Settings" lead="Team, clients, response times and connections." />
      <Tabs tabs={tabs} active={active} onChange={(id) => navigate(href("settings", { section: id }))} className="mb-8" />
      {active === "team" && <TeamSection />}
      {active === "clients" && <ClientsSection />}
      {active === "sla" && <SlaSection />}
      {active === "connections" && <ConnectionsSection />}
      {active === "demo" && <DemoSection />}
    </Page>
  );
}

// ─── Team ────────────────────────────────────────────────────────────────────

function TeamSection() {
  const staff = useLiveQuery(() => api.staff());
  const clients = useLiveQuery(() => api.clients());
  const names = new Map((clients.data ?? []).map((c) => [c.id, c.name]));

  return (
    <Panel title="Ednovax staff">
      {staff.error && <ErrorNote message={staff.error} />}
      {!staff.data ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                {["Name", "Email", "Role", "Looks after"].map((h, i) => (
                  <th key={h} className={cn("label px-5 py-2.5 font-medium", i === 1 && "hidden lg:table-cell", i === 3 && "hidden md:table-cell")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.data.map((member) => (
                <tr key={member.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{member.name}</div>
                    {member.title && <div className="text-[12.5px] text-muted">{member.title}</div>}
                    <div className="truncate text-[12.5px] text-muted lg:hidden">{member.email}</div>
                  </td>
                  <td className="hidden px-5 py-3 text-[13px] text-muted lg:table-cell">{member.email}</td>
                  <td className="px-5 py-3">
                    <Badge tone={member.role === "admin" ? "navy" : member.role === "lead" ? "blue" : "neutral"}>{ROLE[member.role] ?? member.role}</Badge>
                  </td>
                  <td className="hidden px-5 py-3 text-[14px] text-ink-2 md:table-cell">
                    {member.role === "agent"
                      ? member.clients.map((id) => names.get(id) ?? id).join(", ") || <span className="text-faint">No clients yet</span>
                      : member.role === "developer"
                        ? "All clients (tickets and code)"
                        : "All clients"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── Clients ─────────────────────────────────────────────────────────────────

function ClientsSection() {
  const user = useUser();
  const { touch } = useLive();
  const clients = useLiveQuery(() => api.clients());
  const [editing, setEditing] = useState<ClientSummary | "new">();
  const [notice, setNotice] = useState<string>();
  const manage = can(user.role, "manage_clients");

  return (
    <div className="flex flex-col gap-4">
      {notice && <div className="rounded-xl bg-green-soft px-4 py-3 text-[14px] text-green">{notice}</div>}
      <Panel
        title="Clients"
        action={
          manage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add client
            </Button>
          )
        }
      >
        {clients.error && <ErrorNote message={clients.error} />}
        {!clients.data ? (
          <Loading />
        ) : clients.data.length === 0 ? (
          <Empty title="No clients yet">Add a school or lecture centre to start receiving its WhatsApp messages.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Client", "Plan", "Products", "Support agent", ""].map((h, i) => (
                    <th key={h} className={cn("label px-5 py-2.5 font-medium", i === 1 && "hidden sm:table-cell", (i === 2 || i === 3) && "hidden md:table-cell")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.data.map((client) => (
                  <tr key={client.id} className="border-b border-line-soft last:border-b-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{client.name}</div>
                      <div className="truncate text-[13px] text-muted">
                        {CLIENT_TYPE[client.type] ?? client.type}
                        {client.city && ` · ${client.city}`}
                        <span className="md:hidden"> · {client.agentName || "No agent"}</span>
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <Badge tone={client.plan === "premium" ? "navy" : "neutral"}>{PLAN[client.plan]}</Badge>
                    </td>
                    <td className="hidden px-5 py-3 text-[14px] text-ink-2 md:table-cell">{client.products.map((p) => PRODUCT_NAMES[p] ?? p).join(", ")}</td>
                    <td className="hidden px-5 py-3 text-[14px] md:table-cell">{client.agentName || <span className="text-faint">Unassigned</span>}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        {manage && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(client)}>
                            <Pencil /> <span className="hidden sm:inline">Edit</span>
                          </Button>
                        )}
                        {can(user.role, "delete_clients") && (
                          <Confirm
                            title={`Delete ${client.name}?`}
                            description="Its whole graph is deleted: every message, ticket, promise and contact. Other clients are not affected. This can't be undone."
                            action="Delete client"
                            onConfirm={async () => {
                              await api.removeClient(client.id);
                              setNotice(`${client.name} was deleted.`);
                              touch();
                            }}
                          >
                            <Button variant="ghost" size="sm" className="hover:text-red" aria-label={`Delete ${client.name}`}>
                              <Trash2 />
                            </Button>
                          </Confirm>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {!manage && <p className="text-[13.5px] text-muted">Only a support lead or an admin can add or change clients.</p>}

      <Sheet open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        {editing !== undefined && (
          <SheetContent width="md" eyebrow={editing === "new" ? "New client" : "Edit client"} title={editing === "new" ? "Add a client" : editing.name}>
            <ClientForm
              client={editing === "new" ? undefined : editing}
              onSaved={(name, isNew) => {
                setEditing(undefined);
                setNotice(isNew ? `${name} was added. It gets its own graph and WhatsApp group.` : `${name} was updated.`);
                touch();
              }}
            />
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}

function ClientForm({ client, onSaved }: { client?: ClientSummary; onSaved: (name: string, isNew: boolean) => void }) {
  const [form, setForm] = useState<ClientInput>({
    name: client?.name ?? "",
    type: client?.type ?? "school",
    plan: client?.plan ?? "standard",
    city: client?.city ?? "",
    products: client?.products ?? ["sms_v1"],
    agentId: client?.agentId ?? "",
  });
  const [aliases, setAliases] = useState((client?.aliases ?? []).join(", "));
  const [deployments, setDeployments] = useState<Deployment[]>(client?.deployments ?? []);
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.products().then(setProducts, () => undefined);
    api.staff().then(setStaff, () => undefined);
  }, []);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleProduct = (key: string) => set("products", form.products.includes(key) ? form.products.filter((p) => p !== key) : [...form.products, key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rows = deployments
      .filter((d) => d.repo.trim())
      .map((d) => ({ ...d, repo: d.repo.trim(), branch: d.tenancy === "branch" ? d.branch?.trim() || null : null }));
    if (rows.some((d) => d.tenancy === "branch" && !d.branch)) return setError("Give each branch deployment its branch name.");
    // With deployments, the products are the ones they run; otherwise the toggles below.
    const products = rows.length ? [...new Set(rows.map((d) => d.product))] : form.products;
    if (products.length === 0) return setError("Choose at least one product.");
    const input: ClientInput = {
      ...form,
      products,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
      deployments: rows,
    };
    setBusy(true);
    setError(undefined);
    try {
      if (client) await api.updateClient(client.id, input);
      else await api.addClient(input);
      onSaved(form.name, !client);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const agents = staff.filter((s) => s.role === "agent");

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 p-7">
      <Field label="Name">
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Greenfield Academy" required />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type">
          <Select
            label="Type"
            value={form.type}
            onValueChange={(v) => set("type", v as ClientInput["type"])}
            options={[
              { value: "school", label: "School" },
              { value: "lecture_centre", label: "Lecture centre" },
            ]}
          />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Lagos" />
        </Field>
      </div>
      <Field label="Other names" hint="Nicknames staff use, so the central hub can recognise the client.">
        <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. Greenfield, GFA" />
      </Field>
      <Field label="Plan" hint="Premium clients get faster response targets.">
        <Select
          label="Plan"
          value={form.plan}
          onValueChange={(v) => set("plan", v as ClientInput["plan"])}
          options={[
            { value: "premium", label: "Premium" },
            { value: "standard", label: "Standard" },
          ]}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="label">Products they use</span>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-card">
          {products.map((product) => {
            const on = form.products.includes(product.key);
            return (
              <button
                type="button"
                key={product.key}
                onClick={() => toggleProduct(product.key)}
                aria-pressed={on}
                className={cn("flex items-start gap-3 px-3 py-2.5 text-left transition-colors [&+&]:border-t [&+&]:border-line-soft", on ? "bg-primary-soft" : "hover:bg-paper-2")}
              >
                <span className={cn("mt-1 grid size-3.5 shrink-0 place-items-center border", on ? "border-primary bg-primary" : "border-line")} aria-hidden>
                  {on && <span className="size-1.5 bg-primary-ink" />}
                </span>
                <span>
                  <span className="block font-medium">{product.name}</span>
                  <span className="block text-[13px] text-muted">{product.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <DeploymentsEditor products={products} rows={deployments} onChange={setDeployments} />
      <Field label="Support agent" hint="The agent sees only the clients assigned to them.">
        <Select
          label="Support agent"
          value={form.agentId || "none"}
          onValueChange={(v) => set("agentId", v === "none" ? "" : v)}
          options={[{ value: "none", label: "Nobody yet" }, ...agents.map((a) => ({ value: a.id, label: a.name, hint: a.email }))]}
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end gap-2 border-t border-line-soft pt-5">
        <Button type="submit" disabled={busy || !form.name.trim()}>
          {client ? "Save changes" : "Add client"}
        </Button>
      </div>
    </form>
  );
}

const TENANCY_OPTIONS = (Object.keys(TENANCY) as Tenancy[]).map((key) => ({ value: key, label: TENANCY[key].label, hint: TENANCY[key].hint }));

/** Where the client's code runs: one row per product deployment. Merged fixes are routed by this. */
function DeploymentsEditor({ products, rows, onChange }: { products: Product[]; rows: Deployment[]; onChange: (rows: Deployment[]) => void }) {
  const update = (index: number, patch: Partial<Deployment>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const productOptions = (products.length ? products.map((p) => p.key) : Object.keys(PRODUCT_NAMES)).map((key) => ({ value: key, label: PRODUCT_NAMES[key] ?? key }));

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">Where it runs</span>
      <p className="text-[13px] text-muted">Merged fixes only reach the client where it actually runs.</p>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select label="Product" size="sm" value={row.product} onValueChange={(v) => update(index, { product: v })} options={productOptions} />
                <Select
                  label="How it runs"
                  size="sm"
                  value={row.tenancy}
                  onValueChange={(v) => update(index, { tenancy: v as Tenancy, branch: v === "branch" ? row.branch : null })}
                  options={TENANCY_OPTIONS}
                />
              </div>
              <div className="flex gap-2">
                <Input value={row.repo} onChange={(e) => update(index, { repo: e.target.value })} placeholder="owner/name" aria-label="Repository" className="h-9 min-w-0 font-mono text-[13px]" />
                {row.tenancy === "branch" && (
                  <Input value={row.branch ?? ""} onChange={(e) => update(index, { branch: e.target.value })} placeholder="branch" aria-label="Branch" className="h-9 w-36 min-w-0 font-mono text-[13px]" />
                )}
                <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, i) => i !== index))} aria-label="Remove this deployment">
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, { product: productOptions[0]?.value ?? "sms_v1", repo: "", branch: null, tenancy: "own_repo" }])}
      >
        <Plus /> Add a deployment
      </Button>
    </div>
  );
}

// ─── SLA ─────────────────────────────────────────────────────────────────────

function SlaSection() {
  const [policies, setPolicies] = useState<SlaPolicy[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.sla().then(setPolicies, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorNote message={error} />}
      {!policies ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {policies.map((policy) => (
            <Panel key={policy.plan} title={`${PLAN[policy.plan] ?? policy.plan} plan`}>
              <dl className="grid grid-cols-2">
                <div className="border-r border-line-soft px-5 py-5">
                  <dt className="label">First reply within</dt>
                  <dd className="mt-1 font-display text-[28px] font-semibold tracking-tight">{minutesAsWords(policy.firstResponseMins)}</dd>
                </div>
                <div className="px-5 py-5">
                  <dt className="label">Fixed within</dt>
                  <dd className="mt-1 font-display text-[28px] font-semibold tracking-tight">{minutesAsWords(policy.resolveMins)}</dd>
                </div>
              </dl>
              <p className="border-t border-line-soft px-5 py-3 text-[14px] text-muted">
                Someone from Ednovax replies in the group within {minutesAsWords(policy.firstResponseMins)}, and the problem is resolved within {minutesAsWords(policy.resolveMins)} of being reported.
              </p>
            </Panel>
          ))}
        </div>
      )}
      <p className="max-w-[72ch] text-[14px] text-muted">
        Feature requests only get a first-reply target: building something new has no fix deadline. Timers run on the chat clock, so skipping ahead in the demo moves them too.
      </p>
    </div>
  );
}

// ─── Connections ─────────────────────────────────────────────────────────────

type SecretKey = "anthropicApiKey" | "githubToken" | "githubWebhookSecret" | "whatsappAccessToken" | "whatsappAppSecret" | "whatsappVerifyToken";

const SECRETS: Array<{ key: SecretKey; label: string; hint: React.ReactNode }> = [
  {
    key: "anthropicApiKey",
    label: "Anthropic API key",
    hint: (
      <>
        Reads the WhatsApp messages and answers questions. Create a key at{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
          console.anthropic.com
        </a>
        .
      </>
    ),
  },
  { key: "githubToken", label: "GitHub token", hint: "Read access to the product repositories: code owners, pull requests, commits." },
  { key: "githubWebhookSecret", label: "GitHub webhook secret", hint: "Lets GitHub tell the desk about merged fixes the moment they happen." },
];

const WHATSAPP_SECRETS: Array<{ key: SecretKey; label: string; hint: React.ReactNode }> = [
  { key: "whatsappAccessToken", label: "Access token", hint: "From the Meta app for the support number (a permanent system-user token)." },
  { key: "whatsappAppSecret", label: "App secret", hint: "Checks that webhook messages really come from Meta." },
  { key: "whatsappVerifyToken", label: "Webhook verify token", hint: "Any phrase you choose. Paste the same one into Meta's webhook setup." },
];

function ConnectionsSection() {
  const user = useUser();
  const admin = can(user.role, "manage_keys");
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<{ hasApiKey: boolean; githubConfigured: boolean; publicUrl: string }>();
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({});
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.settings().then(setSettings, (e: Error) => setError(e.message));
    api.status().then(setStatus, () => undefined);
  };
  useEffect(load, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const changes = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v.trim() !== ""));
    if (Object.keys(changes).length === 0) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      setSettings(await api.saveSettings(changes));
      setDraft({});
      setSaved(true);
      api.status().then(setStatus, () => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <ErrorNote message={error} /> : <Loading />;

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {status && (
        <div className="grid overflow-hidden rounded-xl border border-line bg-card sm:grid-cols-2">
          <StatusCell ok={status.hasApiKey} label="Language model" okText="Connected: messages are understood" offText="No key: messages arrive but aren't read" />
          <StatusCell ok={status.githubConfigured} label="GitHub" okText="Connected: fixes reach the tickets" offText="Not connected" className="sm:border-l sm:border-line-soft" />
        </div>
      )}

      <Panel title="Keys">
        <SecretRows secrets={SECRETS} settings={settings} admin={admin} draft={draft} setDraft={setDraft} />
        <div className="border-t border-line-soft px-5 py-4">
          <Field
            label="GitHub webhook URL"
            hint="In each repository: Settings → Webhooks → Add webhook. Content type application/json, the secret above, and the events Pull requests, Pushes and Issues."
          >
            <CopyField value={`${status?.publicUrl ?? window.location.origin}/api/github/webhook`} />
          </Field>
        </div>
      </Panel>

      <Panel title="WhatsApp">
        <p className="px-5 pb-1 text-[13.5px] text-muted">
          Groups are created by the support number and hold up to 8 people: the client's main contacts and one Ednovax support person.
        </p>
        <SecretRows secrets={WHATSAPP_SECRETS} settings={settings} admin={admin} draft={draft} setDraft={setDraft} />
        <div className="grid gap-4 border-t border-line-soft px-5 py-4 md:grid-cols-2">
          <Field label="Phone number ID" hint="The support number's ID in the Meta app (not the phone number itself).">
            <Input
              value={draft.whatsappPhoneNumberId ?? settings.whatsappPhoneNumberId}
              onChange={(e) => setDraft((d) => ({ ...d, whatsappPhoneNumberId: e.target.value }))}
              placeholder="e.g. 1234567890"
              disabled={!admin}
            />
          </Field>
          <Field label="Webhook URL" hint="Paste this into Meta's webhook setup, with the verify token above.">
            <CopyField value={`${status?.publicUrl ?? window.location.origin}/api/whatsapp/webhook`} />
          </Field>
        </div>
      </Panel>

      <Panel title="Models">
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <Field label="Fast model" hint="Sorts every message: problem, question, or small talk.">
            <Input value={draft.fastModel ?? settings.fastModel} onChange={(e) => setDraft((d) => ({ ...d, fastModel: e.target.value }))} disabled={!admin} />
          </Field>
          <Field label="Smart model" hint="Builds tickets and answers questions.">
            <Input value={draft.smartModel ?? settings.smartModel} onChange={(e) => setDraft((d) => ({ ...d, smartModel: e.target.value }))} disabled={!admin} />
          </Field>
          <Field label="Anthropic workspace ID (optional)" hint="Only for an organisation-wide key. A workspace key needs nothing here.">
            <Input
              value={draft.anthropicWorkspaceId ?? settings.anthropicWorkspaceId}
              onChange={(e) => setDraft((d) => ({ ...d, anthropicWorkspaceId: e.target.value }))}
              placeholder="wrkspc_…"
              disabled={!admin}
            />
          </Field>
        </div>
      </Panel>

      {error && <ErrorNote message={error} />}
      {saved && <div className="rounded-xl bg-green-soft px-4 py-3 text-[14px] text-green">Saved. New keys take effect straight away.</div>}
      {admin ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || Object.values(draft).every((v) => !v?.trim())}>
            Save connections
          </Button>
        </div>
      ) : (
        <p className="text-[13.5px] text-muted">Only an admin can change keys.</p>
      )}

      <WhatsAppGroups admin={admin} />
    </form>
  );
}

function SecretRows({
  secrets,
  settings,
  admin,
  draft,
  setDraft,
}: {
  secrets: Array<{ key: SecretKey; label: string; hint: React.ReactNode }>;
  settings: Settings;
  admin: boolean;
  draft: Partial<Record<SettingKey, string>>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<Record<SettingKey, string>>>>;
}) {
  return (
    <div className="flex flex-col divide-y divide-line-soft">
      {secrets.map((secret) => (
        <div key={secret.key} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{secret.label}</span>
              <SecretBadge setting={settings[secret.key]} />
            </div>
            <p className="mt-0.5 text-[13.5px] text-muted">{secret.hint}</p>
          </div>
          {admin ? (
            <Input
              type="password"
              autoComplete="off"
              value={draft[secret.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [secret.key]: e.target.value }))}
              placeholder={settings[secret.key].configured ? `Replace the saved value (${settings[secret.key].hint ?? "hidden"})` : "Paste it here"}
              aria-label={secret.label}
            />
          ) : (
            <span className="font-mono text-[12.5px] text-muted">{settings[secret.key].configured ? (settings[secret.key].hint ?? "Saved") : "Not set"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A read-only value with a copy button. */

/** Groups the support number is in: link each to a client, or make one the central hub. */
function WhatsAppGroups({ admin }: { admin: boolean }) {
  const user = useUser();
  const manage = can(user.role, "manage_clients");
  const whatsapp = useLiveQuery(() => api.whatsapp());
  const clients = useLiveQuery(() => api.clients());
  const [error, setError] = useState<string>();
  const names = new Map((clients.data ?? []).map((c) => [c.id, c.name]));

  const act = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      whatsapp.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Panel title="Groups on the support number">
      {whatsapp.error && (
        <div className="px-5 pb-4">
          <ErrorNote message={whatsapp.error} />
        </div>
      )}
      {!whatsapp.data && !whatsapp.error && <Loading />}
      {whatsapp.data && !whatsapp.data.configured && <Empty title="Not connected yet">Connect the support number above to see its groups.</Empty>}
      {whatsapp.data?.configured && whatsapp.data.groups.length === 0 && (
        <Empty title="No groups yet">Create a group from a client's settings, or add the support number to the central hub group.</Empty>
      )}
      {whatsapp.data?.configured && whatsapp.data.groups.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {whatsapp.data.groups.map((group) => (
            <WhatsAppGroupRow
              key={group.id}
              group={group}
              isHub={group.id === whatsapp.data!.hubGroupId}
              clientName={names.get(group.clientId)}
              clients={clients.data ?? []}
              manage={manage}
              admin={admin}
              onLink={(clientId) => act(() => api.linkWhatsAppGroup(group.id, clientId))}
              onHub={() => act(() => api.useAsHub(group.id))}
            />
          ))}
        </ul>
      )}
      {error && (
        <div className="px-5 pb-4">
          <ErrorNote message={error} />
        </div>
      )}
    </Panel>
  );
}

function WhatsAppGroupRow({
  group,
  isHub,
  clientName,
  clients,
  manage,
  admin,
  onLink,
  onHub,
}: {
  group: WhatsAppGroup;
  isHub: boolean;
  clientName: string | undefined;
  clients: ClientSummary[];
  manage: boolean;
  admin: boolean;
  onLink: (clientId: string) => void;
  onHub: () => void;
}) {
  const [choice, setChoice] = useState("");
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{group.name || `Group …${group.id.slice(-6)}`}</span>
          {isHub && <Badge tone="violet">Central hub</Badge>}
        </div>
        <div className="truncate text-[13px] text-muted">{clientName ? `Linked to ${clientName}` : isHub ? "Messages are routed to each client" : "Not linked to a client"}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!clientName && !isHub && manage && (
          <>
            <Select label="Client" size="sm" value={choice} placeholder="Choose a client" onValueChange={setChoice} options={clients.map((c) => ({ value: c.id, label: c.name }))} className="min-w-44" />
            <Button type="button" size="sm" disabled={!choice} onClick={() => onLink(choice)}>
              Link
            </Button>
          </>
        )}
        {!isHub && !clientName && admin && (
          <Button type="button" variant="outline" size="sm" onClick={onHub}>
            Use as central hub
          </Button>
        )}
      </div>
    </li>
  );
}

function SecretBadge({ setting }: { setting: SecretSetting }) {
  if (!setting.configured) return <Badge tone="neutral">Not set</Badge>;
  return <Badge tone="green">{setting.source === "env" ? "Set in .env" : "Saved"}</Badge>;
}

function StatusCell({ ok, label, okText, offText, className }: { ok: boolean; label: string; okText: string; offText: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-5 py-4", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", ok ? "bg-green" : "bg-amber")} aria-hidden />
      <div>
        <div className="label">{label}</div>
        <div className="text-[14px]">{ok ? okText : offText}</div>
      </div>
    </div>
  );
}

// ─── Demo ────────────────────────────────────────────────────────────────────

const DEMO_SCHOOL = [
  "They raise their problems one at a time, and chase if nobody answers.",
  "They answer your questions with what they know: the class, the error, the device.",
  "When you close a ticket or a fix is merged, they try it and say whether it works.",
];

function DemoSection() {
  const [error, setError] = useState<string>();

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title="The demo school">
        <div className="px-5 pb-5">
          <p className="text-[14px] text-muted">
            Henson, in Benin City. Its staff in the WhatsApp group are played by AI. Everyone at Ednovax is a real person: you reply, open GitHub issues and close tickets.
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
            {DEMO_SCHOOL.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="Start over">
          <div className="flex flex-col items-start gap-4 p-5">
            <p className="text-[14px] text-muted">
              Clears every chat, ticket and promise, the hub and Ask history. The teachers start again from their first problem. Clients, staff, products and connections stay.
            </p>
            <Confirm
              title="Start over?"
              description="Every conversation, ticket and promise is deleted. This can't be undone."
              action="Start over"
              onConfirm={async () => {
                setError(undefined);
                try {
                  await api.startOver();
                  // The page still holds the old live feed in memory; load it afresh.
                  window.location.reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Button variant="navy">Start over</Button>
            </Confirm>
            {error && <ErrorNote message={error} />}
          </div>
        </Panel>
        <p className="text-[13.5px] text-muted">
          Demo controls are in the top bar: <span className="font-medium text-ink">Go live</span> brings the teachers to life and{" "}
          <span className="font-medium text-ink">Skip ahead</span> moves the chat clock so promises and SLAs fall due.
        </p>
      </div>
    </div>
  );
}
