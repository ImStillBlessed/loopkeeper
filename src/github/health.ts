import type { Graph } from "falkordb";
import { HD3_ALL_DEPLOYMENTS, HG2_REPOS, HG6_REPO_CODE_READ, HG8_WEBHOOK_DELIVERIES } from "../graph/hq-queries.js";
import { run } from "../graph/queries.js";
import { gh, githubConfigured } from "./api.js";

/**
 * Is each repository really connected? For every repo a product or a client deploys from: can the
 * token read it, can the desk open issues there, is GitHub's webhook reaching the desk, and has the
 * code been read. Each check says what to do when it fails.
 */

export type CheckState = "ok" | "warn" | "fail";

export interface Check {
  state: CheckState;
  text: string;
}

export interface RepoHealth {
  repo: string;
  /** The product it is connected to, if any (only connected repos have their code read). */
  product: string | null;
  /** Clients deployed from it, and the products they run from it. */
  clients: string[];
  deployedProducts: string[];
  access: Check;
  issues: Check;
  webhook: Check;
  code: Check;
}

interface RepoInfo {
  private: boolean;
  has_issues: boolean;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
}

interface Hook {
  active: boolean;
  config: { url?: string };
  last_response?: { code: number | null; status: string | null; message: string | null };
}

const WEBHOOK_PATH = "/api/github/webhook";
const MINUTE = 60_000;

export async function repoHealth(hq: Graph): Promise<RepoHealth[]> {
  const connected = await run<{ id: string; product: string; files: number; indexedAt: number }>(hq, HG2_REPOS);
  const deployments = await run<{ repo: string; clientName: string; product: string }>(hq, HD3_ALL_DEPLOYMENTS);
  const read = new Map((await run<{ repo: string; read: number }>(hq, HG6_REPO_CODE_READ)).map((r) => [r.repo.toLowerCase(), r.read]));
  const deliveries = new Map((await run<Delivery>(hq, HG8_WEBHOOK_DELIVERIES)).map((d) => [d.repo.toLowerCase(), d]));

  const repos = new Map<string, { product: string | null; clients: string[]; deployedProducts: string[]; files: number; indexedAt: number }>();
  for (const r of connected) repos.set(r.id.toLowerCase(), { product: r.product, clients: [], deployedProducts: [], files: r.files, indexedAt: r.indexedAt });
  for (const d of deployments) {
    const entry = repos.get(d.repo.toLowerCase()) ?? { product: null, clients: [], deployedProducts: [], files: 0, indexedAt: 0 };
    entry.clients.push(d.clientName);
    entry.deployedProducts.push(d.product);
    repos.set(d.repo.toLowerCase(), entry);
  }

  const names = new Map([...connected.map((r) => r.id), ...deployments.map((d) => d.repo)].map((name) => [name.toLowerCase(), name]));
  const results: RepoHealth[] = [];
  for (const [key, entry] of repos) {
    const repo = names.get(key) ?? key;
    const [access, issues, info] = await checkAccess(repo);
    results.push({
      repo,
      product: entry.product,
      clients: [...new Set(entry.clients)],
      deployedProducts: [...new Set(entry.deployedProducts)],
      access,
      issues,
      webhook: await checkWebhook(repo, info, deliveries.get(key)),
      code: checkCode(entry, read.get(key) ?? 0),
    });
  }
  return results;
}

async function checkAccess(repo: string): Promise<[Check, Check, RepoInfo | undefined]> {
  if (!githubConfigured()) {
    const none: Check = { state: "fail", text: "No GitHub token yet. Add one in Settings → Connections." };
    return [none, none, undefined];
  }
  try {
    const info = await gh<RepoInfo>(`/repos/${repo}`);
    const access: Check = { state: "ok", text: `Can read it (${info.private ? "private" : "public"})` };
    const issues: Check = info.has_issues ? await checkIssueWrite(repo) : { state: "fail", text: "Issues are turned off on this repository" };
    return [access, issues, info];
  } catch (error) {
    const status = (error as { status?: number }).status;
    const text =
      status === 404
        ? "GitHub says Not Found: the token can't see it. Check the name, or give the token access to this repository (fine-grained tokens: choose its organisation as the owner)."
        : status === 401
          ? "GitHub rejected the token. Paste a new one in Settings → Connections."
          : (error as Error).message;
    const fail: Check = { state: "fail", text };
    return [fail, { state: "fail", text: "Not without access to the repository" }, undefined];
  }
}

/**
 * Whether the token may open issues. GitHub's repo permissions describe the account, not the token
 * (a fine-grained token can have less), so we ask GitHub directly with an issue that has no title:
 * it is always rejected, so nothing is created, but the rejection says whether writing was allowed.
 */
async function checkIssueWrite(repo: string): Promise<Check> {
  try {
    await gh(`/repos/${repo}/issues`, { method: "POST", body: {} });
    return { state: "ok", text: "Can open issues" };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 422) return { state: "ok", text: "Can open issues" };
    if (status === 403 || status === 404) return { state: "fail", text: "The token can read but not open issues. Give it Issues: Read and write for this repository." };
    return { state: "warn", text: `Couldn't tell whether the token may open issues (${(error as Error).message})` };
  }
}

interface Delivery {
  repo: string;
  lastAt: number;
  lastEvent: string;
  lastError: string;
  count: number;
}

async function checkWebhook(repo: string, info: RepoInfo | undefined, delivery: Delivery | undefined): Promise<Check> {
  if (delivery?.lastError) return { state: "fail", text: `The last delivery was refused: ${delivery.lastError}` };
  if (delivery?.lastAt) return { state: "ok", text: `Connected: last delivery ${ago(delivery.lastAt)} (${delivery.lastEvent}), ${delivery.count} in all` };
  // Admins can list the repository's webhooks, so we can say exactly what GitHub sees.
  if (info?.permissions?.admin) {
    const hooks = await gh<Hook[]>(`/repos/${repo}/hooks`).catch(() => undefined);
    const hook = hooks?.find((h) => h.config.url?.includes(WEBHOOK_PATH));
    if (hooks && !hook) return { state: "warn", text: "No webhook points at the desk yet. Fixes are still picked up every minute by polling." };
    if (hook && !hook.active) return { state: "warn", text: "The webhook is turned off in GitHub" };
    if (hook?.last_response?.code && hook.last_response.code >= 300) {
      return { state: "fail", text: `GitHub's last delivery failed (${hook.last_response.code}${hook.last_response.message ? `: ${hook.last_response.message}` : ""})` };
    }
    if (hook) return { state: "warn", text: "The webhook is set up; no delivery has reached the desk yet (GitHub pings it when it's saved)" };
  }
  return { state: "warn", text: "No delivery from GitHub yet. Add the webhook (URL in Settings → Connections); until then fixes are picked up every minute." };
}

function checkCode(entry: { product: string | null; files: number; indexedAt: number }, read: number): Check {
  if (!entry.product) return { state: "warn", text: "Not connected to a product, so its code isn't read. Connect it on the Products page." };
  if (!entry.indexedAt) return { state: "warn", text: "Connected, but not read yet" };
  if (read === 0) return { state: "warn", text: `${entry.files} files listed, none read yet. Connect it again to read the source.` };
  return { state: "ok", text: `${read} of ${entry.files} files read and searchable, ${ago(entry.indexedAt)}` };
}

function ago(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}
