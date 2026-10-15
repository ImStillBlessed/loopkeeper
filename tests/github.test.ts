import type { Graph } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordCommit, recordIssueEvent, recordPullRequest, type GithubRouter } from "../src/github/activity.js";
import { normaliseRepo } from "../src/github/api.js";
import { featuresFromFolders, ownersOf, parseCodeowners, resolveImport } from "../src/github/indexer.js";
import { parseReferences } from "../src/github/links.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { H15_CLIENT_UPSERT, HD1_SET_DEPLOYMENTS, HG2_REPOS, X11_SIGNAL_GITHUB, X1_SIGNAL_UPSERT } from "../src/graph/hq-queries.js";
import { GH9_CODE_ACTIVITY, GH10_ISSUE_STATUS, P1_CLIENT, P4_GROUPS, Q11_BOARD, Q8_HISTORY, run } from "../src/graph/queries.js";
import { EMBEDDING_DIMENSION, ensureSchema } from "../src/graph/schema.js";
import { changeStatusFromOutside } from "../src/pipeline/status.js";

describe("linking developer work to issues", () => {
  it("finds GitHub issue numbers, Loopkeeper ids and closing words", () => {
    expect(parseReferences("Fixes #12: retry score submit", "Also see iss_0123456789abcdef")).toEqual({
      numbers: [12],
      issueIds: ["iss_0123456789abcdef"],
      closes: true,
    });
  });

  it("reads issue numbers from branch names", () => {
    expect(parseReferences("fix/42-timer-on-tecno").numbers).toEqual([42]);
  });

  it("ignores colour codes and words that only look similar", () => {
    expect(parseReferences("Use colour #ff6b6b and prefix the fixture").numbers).toEqual([]);
    expect(parseReferences("prefix the fixture").closes).toBe(false);
  });

  it("accepts owner/name or a GitHub URL", () => {
    expect(normaliseRepo("https://github.com/ImStillBlessed/ednovax-lite-demo.git")).toBe("ImStillBlessed/ednovax-lite-demo");
    expect(normaliseRepo("ImStillBlessed/ednovax-lite-demo")).toBe("ImStillBlessed/ednovax-lite-demo");
  });
});

describe("reading a repository", () => {
  it("turns product folders into features, skipping folders that just hold code", () => {
    const features = featuresFromFolders(["src/scores/submit.ts", "src/scores/validate.ts", "app/cbt/timer.tsx", "README.md", "src/index.ts"]);
    expect(features.map((f) => [f.key, f.paths])).toEqual([
      ["scores", ["src/scores/"]],
      ["cbt", ["app/cbt/"]],
    ]);
  });

  it("applies CODEOWNERS with the last matching rule winning", () => {
    const rules = parseCodeowners("* @lead\n/lib/scores/ @tunde # scores team\n*.tsx @kemi");
    expect(ownersOf("lib/scores/submit.ts", rules)).toEqual(["tunde"]);
    expect(ownersOf("app/cbt/Timer.tsx", rules)).toEqual(["kemi"]);
    expect(ownersOf("README.md", rules)).toEqual(["lead"]);
  });

  it("resolves relative and @/ imports to files in the repo", () => {
    const known = new Set(["src/lib/db.ts", "src/scores/submit.ts", "src/scores/index.ts"]);
    expect(resolveImport("src/scores/submit.ts", "../lib/db", known)).toBe("src/lib/db.ts");
    expect(resolveImport("src/app.ts", "@/scores", known)).toBe("src/scores/index.ts");
    expect(resolveImport("src/app.ts", "react", known)).toBeUndefined();
  });
});

describe("GitHub activity routed to a client", () => {
  const repo = "acme/school-app";
  let hq: Graph;
  let client: Graph;
  const posted: string[] = [];
  const status = async (issueId: string) => (await run<{ status: string }>(client, GH10_ISSUE_STATUS, { issueId }))[0].status;

  beforeAll(async () => {
    const db = await getFalkorDB();
    hq = db.selectGraph("lk_test_github_hq");
    client = db.selectGraph("lk_test_github_client");
    for (const graph of [hq, client]) {
      await graph.delete().catch(() => undefined);
      await ensureSchema(graph);
    }
    await run(client, P1_CLIENT, { id: "acme_school", name: "Acme School", ts: Date.now() });
    await client.query(`CREATE (:Issue {id: 'iss_aaaaaaaaaaaaaaaa', title: 'Scores not saving', status: 'open'}),
                               (:Issue {id: 'iss_bbbbbbbbbbbbbbbb', title: 'Timer missing', status: 'open'})`);
    // HQ knows which client each ticket lives in (abstract signals), and the GitHub issue behind one.
    const embedding = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (i === 0 ? 1 : 0));
    for (const id of ["iss_aaaaaaaaaaaaaaaa", "iss_bbbbbbbbbbbbbbbb"]) {
      await run(hq, X1_SIGNAL_UPSERT, { id, clientId: "acme_school", featureKey: "scores", severity: "high", status: "open", title: "A problem", embedding, ts: Date.now() });
    }
    await run(hq, X11_SIGNAL_GITHUB, { id: "iss_aaaaaaaaaaaaaaaa", repo, number: 7 });
  });

  afterAll(async () => {
    for (const graph of [hq, client]) await graph.delete().catch(() => undefined);
    await closeFalkorDB();
  });

  const router = (): GithubRouter => ({
    hq,
    activity: () => undefined,
    client: (clientId) =>
      clientId === "acme_school"
        ? {
            graph: client,
            changeStatus: (issueId, to, by) => changeStatusFromOutside(client, issueId, to, by),
            activity: () => undefined,
            postToGroup: (text) => posted.push(text),
          }
        : undefined,
  });

  const pr = (state: "open" | "closed", mergedAt: string | null) => ({
    number: 21,
    title: "Retry score submit for big classes",
    body: "Fixes #7",
    html_url: "https://github.com/acme/school-app/pull/21",
    state,
    merged_at: mergedAt,
    created_at: "2026-10-15T09:00:00Z",
    updated_at: "2026-10-15T10:00:00Z",
    user: { login: "tunde-dev" },
  });

  it("an opened pull request marks the linked ticket as being worked on and tells the group", async () => {
    await recordPullRequest(router(), repo, pr("open", null));
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("in_progress");
    expect(posted.at(-1)).toContain("We're working on");
  });

  it("a merged pull request means 'might be fixed', with the PR recorded as the reason, in the client's graph", async () => {
    await recordPullRequest(router(), repo, pr("closed", "2026-10-15T11:00:00Z"));
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("possibly_resolved");
    const history = await run<{ to: string; by: string }>(client, Q8_HISTORY, { issueId: "iss_aaaaaaaaaaaaaaaa" });
    expect(history.at(-1)).toMatchObject({ to: "possibly_resolved", by: "Pull request #21 merged by tunde-dev" });
    expect(posted.at(-1)).toContain("Good news");

    const [activity] = await run<{ pullRequests: Array<{ number: number; state: string }> }>(client, GH9_CODE_ACTIVITY, { issueId: "iss_aaaaaaaaaaaaaaaa" });
    expect(activity.pullRequests).toEqual([expect.objectContaining({ number: 21, state: "merged" })]);
  });

  it("seeing the same pull request again changes nothing", async () => {
    const before = posted.length;
    await recordPullRequest(router(), repo, pr("closed", "2026-10-15T11:00:00Z"));
    expect(posted.length).toBe(before);
  });

  it("a pushed commit that mentions a ticket id is linked, and 'fixes' on main means might be fixed", async () => {
    await recordCommit(router(), repo, { sha: "abc1234def", message: "Fix timer on Tecno (fixes iss_bbbbbbbbbbbbbbbb)", url: "https://x", author: "kemi-dev", ts: Date.now() }, true);
    expect(await status("iss_bbbbbbbbbbbbbbbb")).toBe("possibly_resolved");
    const [activity] = await run<{ commits: Array<{ sha: string }> }>(client, GH9_CODE_ACTIVITY, { issueId: "iss_bbbbbbbbbbbbbbbb" });
    expect(activity.commits.map((c) => c.sha)).toEqual(["abc1234def"]);
  });

  it("lists tickets, groups and repos even when optional properties were never set", async () => {
    // Regression: FalkorDB crashed when grouping by a property no node in the graph had (e.g. featureKey).
    const board = await run<{ id: string; feature: string }>(client, Q11_BOARD);
    expect(board.map((i) => i.feature)).toEqual(["", ""]);
    await expect(run(client, P4_GROUPS)).resolves.toEqual([]);
    await expect(run(hq, HG2_REPOS)).resolves.toEqual([]);
  });

  it("a developer closing the GitHub issue resolves the ticket", async () => {
    await recordIssueEvent(router(), repo, "closed", 7, "tunde-dev");
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("resolved");
  });
});

describe("a fix reaches a client only where it runs", () => {
  const repo = "acme/sms-v1";
  let hq: Graph;
  let client: Graph;
  const posted: string[] = [];
  const notes: string[] = [];
  const status = async () => (await run<{ status: string }>(client, GH10_ISSUE_STATUS, { issueId: "iss_cccccccccccccccc" }))[0].status;

  beforeAll(async () => {
    const db = await getFalkorDB();
    hq = db.selectGraph("lk_test_deploy_hq");
    client = db.selectGraph("lk_test_deploy_client");
    for (const graph of [hq, client]) {
      await graph.delete().catch(() => undefined);
      await ensureSchema(graph);
    }
    // This school runs the shared SMS v1 repo from its own branch.
    await run(hq, H15_CLIENT_UPSERT, { id: "branch_school", name: "Branch School", type: "school", plan: "standard", city: "", aliases: [], ts: Date.now() });
    await run(hq, HD1_SET_DEPLOYMENTS, { id: "branch_school", deployments: [{ product: "sms_v1", repo, branch: "branch-school", tenancy: "branch" }] });
    await client.query(`CREATE (:Issue {id: 'iss_cccccccccccccccc', title: 'Report cards cut off', status: 'open'})`);
    const embedding = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (i === 0 ? 1 : 0));
    await run(hq, X1_SIGNAL_UPSERT, { id: "iss_cccccccccccccccc", clientId: "branch_school", featureKey: "results", severity: "high", status: "open", title: "A problem", embedding, ts: Date.now() });
  });

  afterAll(async () => {
    for (const graph of [hq, client]) await graph.delete().catch(() => undefined);
    await closeFalkorDB();
  });

  const router = (): GithubRouter => ({
    hq,
    activity: () => undefined,
    client: (clientId) =>
      clientId === "branch_school"
        ? {
            graph: client,
            changeStatus: (issueId, to, by) => changeStatusFromOutside(client, issueId, to, by),
            activity: (text) => notes.push(text),
            postToGroup: (text) => posted.push(text),
          }
        : undefined,
  });

  const merged = (number: number, base: string) => ({
    number,
    title: "Paginate the report card PDF",
    body: "Fixes iss_cccccccccccccccc",
    html_url: `https://github.com/${repo}/pull/${number}`,
    state: "closed" as const,
    merged_at: "2026-10-15T11:00:00Z",
    created_at: "2026-10-15T09:00:00Z",
    updated_at: "2026-10-15T11:00:00Z",
    user: { login: "tunde-dev" },
    base: { ref: base, repo: { default_branch: "main" } },
  });

  it("a merge into main doesn't tell a branch-deployed school yet, but tells staff what's left", async () => {
    await recordPullRequest(router(), repo, merged(30, "main"));
    expect(posted).toEqual([]);
    expect(await status()).toBe("open");
    expect(notes.at(-1)).toContain(`bring it into this client's branch "branch-school"`);
  });

  it("a merge into the school's own branch ships the fix to it", async () => {
    await recordPullRequest(router(), repo, merged(31, "branch-school"));
    expect(await status()).toBe("possibly_resolved");
    expect(posted.at(-1)).toContain("Good news");
  });
});
