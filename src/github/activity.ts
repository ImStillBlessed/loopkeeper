import type { Graph } from "falkordb";
import { HD4_CLIENT_DEPLOYMENTS, HG2_REPOS, X10_SIGNAL, X12_SIGNAL_BY_GITHUB, X13_PR_FIXES, X9_PATTERN_MEMBERS } from "../graph/hq-queries.js";
import { GH4_PULL_REQUEST, GH5_FIXED_BY, GH6_TOUCHES, GH7_COMMIT, GH8_COMMIT_REFERENCES, P7_REPO_MARK, run } from "../graph/queries.js";
import { gh } from "./api.js";
import type { StatusChangeResult } from "../pipeline/status.js";
import { parseReferences } from "./links.js";

/**
 * GitHub activity across clients. Pull requests and commits are recorded once in HQ; each ticket they
 * touch lives in its own client's graph, so the change is routed there. When a fix merges, every ticket
 * in the same cross-client pattern hears about it, and each client is told only about its own problem.
 */

/** How GitHub activity reaches one client: its graph, its status changes, its feed and its WhatsApp group. */
export interface ClientChannel {
  graph: Graph;
  /** Changes a ticket's status for a non-chat reason; undefined if the ticket doesn't exist. */
  changeStatus: (issueId: string, to: string, by: string) => Promise<StatusChangeResult | undefined>;
  activity: (text: string, issueId?: string) => void;
  /** Loopkeeper posts in the client's WhatsApp group, in plain language for teachers. */
  postToGroup: (text: string) => void;
}

export interface GithubRouter {
  hq: Graph;
  client: (clientId: string) => ClientChannel | undefined;
  /** HQ-wide activity line (e.g. a PR that mentions no ticket). */
  activity: (text: string) => void;
}

export interface PullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head?: { ref: string };
  /** The branch the pull request merges into. */
  base?: { ref: string; repo?: { default_branch?: string } };
}

export interface CommitPayload {
  sha: string;
  message: string;
  url: string;
  author: string;
  ts: number;
}

interface TicketRef {
  issueId: string;
  clientId: string;
}

/** Which tickets a piece of developer text points at, in any client. */
async function linkedTickets(hq: Graph, repo: string, ...texts: Array<string | null | undefined>): Promise<{ tickets: TicketRef[]; closes: boolean }> {
  const refs = parseReferences(...texts);
  const found = new Map<string, TicketRef>();
  for (const number of refs.numbers) {
    const [ticket] = await run<TicketRef>(hq, X12_SIGNAL_BY_GITHUB, { repo, number });
    if (ticket) found.set(ticket.issueId, ticket);
  }
  for (const id of refs.issueIds) {
    const [ticket] = await run<TicketRef>(hq, X10_SIGNAL, { id });
    if (ticket) found.set(ticket.issueId, ticket);
  }
  return { tickets: [...found.values()], closes: refs.closes };
}

/** A fix reaches every ticket in the same cross-client pattern, not just the one it mentions. */
async function withPatternMembers(hq: Graph, tickets: TicketRef[]): Promise<TicketRef[]> {
  const all = new Map(tickets.map((t) => [t.issueId, t]));
  for (const ticket of tickets) {
    for (const member of await run<TicketRef>(hq, X9_PATTERN_MEMBERS, { id: ticket.issueId })) all.set(member.issueId, member);
  }
  return [...all.values()];
}

interface Reach {
  ships: boolean;
  /** For staff, when the fix doesn't reach the client yet. */
  note?: string;
}

/**
 * Does a merge into `base` of `repo` reach a client? It depends on where the client runs:
 * - own repository or multi-tenant platform: a merge into the default branch ships to it
 * - its own branch of a shared repository: only a merge into that branch; a merge into the default
 *   branch still has to be brought into the client's branch
 * - a different repository: not at all (the same problem needs fixing there too)
 * Clients without any recorded deployment keep the simple rule: every merge reaches them.
 */
async function reachOf(hq: Graph, clientId: string, repo: string, base: string | undefined, defaultBranch: string): Promise<Reach> {
  const deployments = await run<{ repo: string; branch: string | null; tenancy: string }>(hq, HD4_CLIENT_DEPLOYMENTS, { clientId });
  if (deployments.length === 0) return { ships: true };
  const here = deployments.filter((d) => d.repo === repo);
  if (here.length === 0) return { ships: false, note: `The fix was merged in ${repo}, which this client doesn't run: their code needs the same fix` };
  const into = base ?? defaultBranch;
  for (const d of here) {
    if (d.tenancy === "branch" && d.branch) {
      if (into === d.branch) return { ships: true };
      if (into === defaultBranch) return { ships: false, note: `Merged into ${into}: bring it into this client's branch "${d.branch}" to ship it` };
    } else if (into === defaultBranch) {
      return { ships: true };
    }
  }
  return { ships: false, note: `Merged into ${into}, which this client isn't deployed from` };
}

const FIX_SHIPPED = (title: string) => `Good news 🎉 a fix for "${title}" has just gone out. Please let us know if it's working now.`;

/**
 * A pull request opened, updated or merged. Opening one marks its tickets "being worked on";
 * merging marks them, and every ticket in the same pattern, "might be fixed" and asks each school to confirm.
 */
export async function recordPullRequest(router: GithubRouter, repo: string, pr: PullRequestPayload): Promise<void> {
  const state = pr.merged_at ? "merged" : pr.state;
  const author = pr.user?.login ?? "someone";
  const id = `${repo}#${pr.number}`;
  const prParams = {
    id,
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state,
    author,
    authorId: `gh_${author.toLowerCase()}`,
    createdAt: Date.parse(pr.created_at),
    updatedAt: Date.parse(pr.updated_at),
  };
  const [row] = await run<{ previousState: string | null }>(router.hq, GH4_PULL_REQUEST, prParams);
  const previous = row?.previousState ?? null;
  if (previous === state) return;

  const { tickets } = await linkedTickets(router.hq, repo, pr.title, pr.body, pr.head?.ref);
  if (tickets.length === 0) {
    if (previous === null) router.activity(`${author} opened pull request #${pr.number}: ${pr.title}`);
    return;
  }
  for (const ticket of tickets) await run(router.hq, X13_PR_FIXES, { prId: id, issueId: ticket.issueId });
  const files = previous === null ? await gh<Array<{ filename: string }>>(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`).catch(() => []) : [];

  const reach = state === "merged" ? await withPatternMembers(router.hq, tickets) : tickets;
  const connected = (await run<{ id: string; defaultBranch: string }>(router.hq, HG2_REPOS)).find((r) => r.id === repo);
  const defaultBranch = pr.base?.repo?.default_branch ?? connected?.defaultBranch ?? "main";
  for (const ticket of reach) {
    const client = router.client(ticket.clientId);
    if (!client) continue;
    const delivery = state === "merged" ? await reachOf(router.hq, ticket.clientId, repo, pr.base?.ref, defaultBranch) : { ships: true };
    if (!delivery.ships) {
      // The client isn't told yet; staff see what's still needed on the ticket.
      client.activity(`Pull request #${pr.number} by ${author} was merged. ${delivery.note}`, ticket.issueId);
      continue;
    }
    // The client's graph keeps its own copy of the PR, so its ticket page can show it.
    await run(client.graph, GH4_PULL_REQUEST, prParams);
    await run(client.graph, GH5_FIXED_BY, { issueId: ticket.issueId, prId: id });
    if (files.length) await run(client.graph, GH6_TOUCHES, { id, repo, paths: files.map((f) => f.filename) });

    if (state === "open") {
      const changed = await client.changeStatus(ticket.issueId, "in_progress", `Pull request #${pr.number} opened by ${author}`);
      client.activity(`${author} opened pull request #${pr.number} for this`, ticket.issueId);
      if (changed?.changed && changed.from === "open") client.postToGroup(`We're working on "${changed.title}" 👍🏾 A fix is being reviewed.`);
    }
    if (state === "merged") {
      const changed = await client.changeStatus(ticket.issueId, "possibly_resolved", `Pull request #${pr.number} merged by ${author}`);
      client.activity(`Pull request #${pr.number} by ${author} was merged`, ticket.issueId);
      // Tell the group even if the ticket already looked fixed; only a confirmed fix needs no message.
      if (changed && changed.from !== "resolved") client.postToGroup(FIX_SHIPPED(changed.title));
    }
  }
}

/** A pushed commit. Mentions link it to tickets; "fixes …" on the default branch means "might be fixed". */
export async function recordCommit(router: GithubRouter, repo: string, commit: CommitPayload, onDefaultBranch: boolean): Promise<void> {
  const id = `${repo}@${commit.sha}`;
  const params = { id, sha: commit.sha, repo, message: commit.message, url: commit.url, author: commit.author, authorId: `gh_${commit.author.toLowerCase()}`, ts: commit.ts };
  const [row] = await run<{ isNew: boolean }>(router.hq, GH7_COMMIT, params);
  if (!row?.isNew) return;

  const { tickets, closes } = await linkedTickets(router.hq, repo, commit.message);
  if (tickets.length === 0) return;
  const detail = await gh<{ files?: Array<{ filename: string }> }>(`/repos/${repo}/commits/${commit.sha}`).catch(() => ({ files: [] }));
  const summary = commit.message.split("\n")[0];
  const shipsFix = closes && onDefaultBranch;

  for (const ticket of shipsFix ? await withPatternMembers(router.hq, tickets) : tickets) {
    const client = router.client(ticket.clientId);
    if (!client) continue;
    await run(client.graph, GH7_COMMIT, params);
    await run(client.graph, GH8_COMMIT_REFERENCES, { issueId: ticket.issueId, commitId: id });
    await run(client.graph, GH6_TOUCHES, { id, repo, paths: (detail.files ?? []).map((f) => f.filename) });
    client.activity(`${commit.author} pushed "${summary}"`, ticket.issueId);
    if (shipsFix) {
      const changed = await client.changeStatus(ticket.issueId, "possibly_resolved", `Commit ${commit.sha.slice(0, 7)} by ${commit.author}`);
      if (changed && changed.from !== "resolved") client.postToGroup(FIX_SHIPPED(changed.title));
    }
  }
}

/** A developer closed or reopened the GitHub issue itself. */
export async function recordIssueEvent(router: GithubRouter, repo: string, action: string, number: number, actor: string): Promise<void> {
  const to = action === "closed" ? "resolved" : action === "reopened" ? "open" : undefined;
  const [ticket] = await run<TicketRef>(router.hq, X12_SIGNAL_BY_GITHUB, { repo, number });
  const client = ticket && router.client(ticket.clientId);
  if (!to || !ticket || !client) return;
  const changed = await client.changeStatus(ticket.issueId, to, `GitHub issue #${number} ${action} by ${actor}`);
  if (changed?.changed) client.activity(`${actor} ${action} GitHub issue #${number}`, ticket.issueId);
}

/**
 * Polling, for when no webhook is set up (e.g. running locally): new and updated pull requests,
 * new commits on the default branch, and closed issues since the last sync, for every product repo.
 */
export async function syncRepositories(router: GithubRouter): Promise<void> {
  const repos = await run<{ id: string; defaultBranch: string; syncedAt: number; indexedAt: number }>(router.hq, HG2_REPOS);
  for (const repo of repos) {
    const since = repo.syncedAt || repo.indexedAt || Date.now() - 7 * 24 * 60 * 60 * 1000;
    const startedAt = Date.now();

    const pulls = await gh<PullRequestPayload[]>(`/repos/${repo.id}/pulls?state=all&sort=updated&direction=desc&per_page=30`);
    for (const pr of pulls.filter((p) => Date.parse(p.updated_at) >= since).reverse()) await recordPullRequest(router, repo.id, pr);

    const commits = await gh<Array<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author: { login: string } | null }>>(
      `/repos/${repo.id}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&since=${new Date(since).toISOString()}&per_page=30`,
    );
    for (const c of commits.reverse()) {
      await recordCommit(router, repo.id, { sha: c.sha, message: c.commit.message, url: c.html_url, author: c.author?.login ?? c.commit.author.name, ts: Date.parse(c.commit.author.date) }, true);
    }

    const closed = await gh<Array<{ number: number; closed_by?: { login: string } | null; pull_request?: unknown }>>(
      `/repos/${repo.id}/issues?state=closed&since=${new Date(since).toISOString()}&per_page=30`,
    );
    for (const issue of closed.filter((i) => !i.pull_request)) {
      await recordIssueEvent(router, repo.id, "closed", issue.number, issue.closed_by?.login ?? "a developer");
    }

    await run(router.hq, P7_REPO_MARK, { id: repo.id, indexedAt: null, syncedAt: startedAt, featureSource: null });
  }
}
