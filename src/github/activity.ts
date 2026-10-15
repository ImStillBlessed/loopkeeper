import type { Graph } from "falkordb";
import {
  GH10_ISSUE_STATUS,
  GH2_ISSUE_BY_NUMBER,
  GH4_PULL_REQUEST,
  GH5_FIXED_BY,
  GH6_TOUCHES,
  GH7_COMMIT,
  GH8_COMMIT_REFERENCES,
  P6_REPOS,
  P7_REPO_MARK,
  run,
} from "../graph/queries.js";
import { changeStatusFromOutside } from "../pipeline/status.js";
import { gh } from "./api.js";
import { parseReferences } from "./links.js";

/** How GitHub activity reaches the rest of the project: feed lines and messages back into the group. */
export interface ActivitySink {
  activity: (text: string, issueId?: string) => void;
  /** Loopkeeper posts in the WhatsApp group, in plain language for teachers. */
  postToGroup: (text: string) => void;
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
}

export interface CommitPayload {
  sha: string;
  message: string;
  url: string;
  author: string;
  ts: number;
}

/** Which Loopkeeper issues a piece of developer text points at. */
async function linkedIssues(graph: Graph, repo: string, ...texts: Array<string | null | undefined>) {
  const refs = parseReferences(...texts);
  const ids = new Set<string>();
  for (const number of refs.numbers) {
    const [issue] = await run<{ id: string }>(graph, GH2_ISSUE_BY_NUMBER, { repo, number });
    if (issue) ids.add(issue.id);
  }
  for (const issueId of refs.issueIds) {
    const [issue] = await run<{ id: string }>(graph, GH10_ISSUE_STATUS, { issueId });
    if (issue) ids.add(issue.id);
  }
  return { issueIds: [...ids], closes: refs.closes };
}

/**
 * A pull request opened, updated or merged. Linked issues get FIXED_BY; opening one marks the issue
 * "being worked on", merging it marks it "might be fixed" and asks the school to confirm.
 */
export async function recordPullRequest(graph: Graph, repo: string, pr: PullRequestPayload, sink: ActivitySink): Promise<void> {
  const state = pr.merged_at ? "merged" : pr.state;
  const author = pr.user?.login ?? "someone";
  const id = `${repo}#${pr.number}`;
  const [row] = await run<{ previousState: string | null }>(graph, GH4_PULL_REQUEST, {
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
  });
  const previous = row?.previousState ?? null;
  if (previous === state) return;

  const { issueIds } = await linkedIssues(graph, repo, pr.title, pr.body, pr.head?.ref);
  if (previous === null) {
    const files = await gh<Array<{ filename: string }>>(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`).catch(() => []);
    await run(graph, GH6_TOUCHES, { id, repo, paths: files.map((f) => f.filename) });
  }

  for (const issueId of issueIds) {
    await run(graph, GH5_FIXED_BY, { issueId, prId: id });
    if (state === "open") {
      const changed = await changeStatusFromOutside(graph, issueId, "in_progress", `Pull request #${pr.number} opened by ${author}`);
      sink.activity(`${author} opened pull request #${pr.number} for "${changed?.title ?? pr.title}"`, issueId);
      if (changed?.from === "open") sink.postToGroup(`We're working on "${changed.title}" 👍🏾 A fix is being reviewed.`);
    }
    if (state === "merged") {
      const changed = await changeStatusFromOutside(graph, issueId, "possibly_resolved", `Pull request #${pr.number} merged by ${author}`);
      sink.activity(`Pull request #${pr.number} by ${author} was merged`, issueId);
      if (changed) sink.postToGroup(`Good news 🎉 a fix for "${changed.title}" has just gone out. Please let us know if it's working now.`);
    }
  }
  if (issueIds.length === 0 && previous === null) sink.activity(`${author} opened pull request #${pr.number}: ${pr.title}`);
}

/** A pushed commit. Mentions link it to issues; "fixes #12" on the default branch means "might be fixed". */
export async function recordCommit(graph: Graph, repo: string, commit: CommitPayload, onDefaultBranch: boolean, sink: ActivitySink): Promise<void> {
  const id = `${repo}@${commit.sha}`;
  const [row] = await run<{ isNew: boolean }>(graph, GH7_COMMIT, {
    id,
    sha: commit.sha,
    repo,
    message: commit.message,
    url: commit.url,
    author: commit.author,
    authorId: `gh_${commit.author.toLowerCase()}`,
    ts: commit.ts,
  });
  if (!row?.isNew) return;

  const { issueIds, closes } = await linkedIssues(graph, repo, commit.message);
  if (issueIds.length === 0) return;

  const detail = await gh<{ files?: Array<{ filename: string }> }>(`/repos/${repo}/commits/${commit.sha}`).catch(() => ({ files: [] }));
  await run(graph, GH6_TOUCHES, { id, repo, paths: (detail.files ?? []).map((f) => f.filename) });

  const summary = commit.message.split("\n")[0];
  for (const issueId of issueIds) {
    await run(graph, GH8_COMMIT_REFERENCES, { issueId, commitId: id });
    sink.activity(`${commit.author} pushed "${summary}"`, issueId);
    if (closes && onDefaultBranch) {
      const changed = await changeStatusFromOutside(graph, issueId, "possibly_resolved", `Commit ${commit.sha.slice(0, 7)} by ${commit.author}`);
      if (changed) sink.postToGroup(`Good news 🎉 a fix for "${changed.title}" has just gone out. Please let us know if it's working now.`);
    }
  }
}

/** A developer closed or reopened the GitHub issue itself. */
export async function recordIssueEvent(graph: Graph, repo: string, action: string, number: number, actor: string, sink: ActivitySink): Promise<void> {
  const [issue] = await run<{ id: string }>(graph, GH2_ISSUE_BY_NUMBER, { repo, number });
  if (!issue) return;
  const to = action === "closed" ? "resolved" : action === "reopened" ? "open" : undefined;
  if (!to) return;
  const changed = await changeStatusFromOutside(graph, issue.id, to, `GitHub issue #${number} ${action} by ${actor}`);
  if (changed) sink.activity(`${actor} ${action} GitHub issue #${number}`, issue.id);
}

/**
 * Polling, for when no webhook is set up (e.g. running locally): new and updated pull requests,
 * new commits on the default branch, and closed issues since the last sync.
 */
export async function syncRepositories(graph: Graph, sink: ActivitySink): Promise<void> {
  const repos = await run<{ id: string; defaultBranch: string; syncedAt: number | null; indexedAt: number | null }>(graph, P6_REPOS);
  for (const repo of repos) {
    const since = repo.syncedAt ?? repo.indexedAt ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const startedAt = Date.now();

    const pulls = await gh<PullRequestPayload[]>(`/repos/${repo.id}/pulls?state=all&sort=updated&direction=desc&per_page=30`);
    for (const pr of pulls.filter((p) => Date.parse(p.updated_at) >= since).reverse()) await recordPullRequest(graph, repo.id, pr, sink);

    const commits = await gh<Array<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author: { login: string } | null }>>(
      `/repos/${repo.id}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&since=${new Date(since).toISOString()}&per_page=30`,
    );
    for (const c of commits.reverse()) {
      await recordCommit(graph, repo.id, { sha: c.sha, message: c.commit.message, url: c.html_url, author: c.author?.login ?? c.commit.author.name, ts: Date.parse(c.commit.author.date) }, true, sink);
    }

    const closed = await gh<Array<{ number: number; state: string; closed_by?: { login: string } | null; pull_request?: unknown; updated_at: string }>>(
      `/repos/${repo.id}/issues?state=closed&since=${new Date(since).toISOString()}&per_page=30`,
    );
    for (const issue of closed.filter((i) => !i.pull_request)) {
      await recordIssueEvent(graph, repo.id, "closed", issue.number, issue.closed_by?.login ?? "a developer", sink);
    }

    await run(graph, P7_REPO_MARK, { id: repo.id, indexedAt: null, syncedAt: startedAt, featureSource: null });
  }
}
