import type { Graph } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordCommit, recordIssueEvent, recordPullRequest, type ActivitySink } from "../src/github/activity.js";
import { normaliseRepo } from "../src/github/api.js";
import { featuresFromFolders, ownersOf, parseCodeowners, resolveImport } from "../src/github/indexer.js";
import { parseReferences } from "../src/github/links.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { GH1_LINK_ISSUE, GH9_CODE_ACTIVITY, GH10_ISSUE_STATUS, P1_PROJECT, P4_GROUPS, P6_REPOS, Q11_BOARD, Q8_HISTORY, run } from "../src/graph/queries.js";
import { ensureSchema } from "../src/graph/schema.js";

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

describe("GitHub activity in the graph", () => {
  const repo = "acme/school-app";
  let graph: Graph;
  const posted: string[] = [];
  const sink: ActivitySink = { activity: () => undefined, postToGroup: (text) => posted.push(text) };
  const status = async (issueId: string) => (await run<{ status: string }>(graph, GH10_ISSUE_STATUS, { issueId }))[0].status;

  beforeAll(async () => {
    graph = (await getFalkorDB()).selectGraph("lk_test_github");
    await graph.delete().catch(() => undefined);
    await ensureSchema(graph);
    await run(graph, P1_PROJECT, { id: "test_github", name: "Test", ts: Date.now() });
    await graph.query(`CREATE (:Issue {id: 'iss_aaaaaaaaaaaaaaaa', title: 'Scores not saving', status: 'open'}),
                              (:Issue {id: 'iss_bbbbbbbbbbbbbbbb', title: 'Timer missing', status: 'open'})`);
    await run(graph, GH1_LINK_ISSUE, { issueId: "iss_aaaaaaaaaaaaaaaa", repo, number: 7, url: "https://github.com/acme/school-app/issues/7" });
  });

  afterAll(async () => {
    await graph.delete().catch(() => undefined);
    await closeFalkorDB();
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

  it("an opened pull request marks the linked issue as being worked on and tells the group", async () => {
    await recordPullRequest(graph, repo, pr("open", null), sink);
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("in_progress");
    expect(posted.at(-1)).toContain("We're working on");
  });

  it("a merged pull request means 'might be fixed', with the PR recorded as the reason", async () => {
    await recordPullRequest(graph, repo, pr("closed", "2026-10-15T11:00:00Z"), sink);
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("possibly_resolved");
    const history = await run<{ to: string; by: string }>(graph, Q8_HISTORY, { issueId: "iss_aaaaaaaaaaaaaaaa" });
    expect(history.at(-1)).toMatchObject({ to: "possibly_resolved", by: "Pull request #21 merged by tunde-dev" });
    expect(posted.at(-1)).toContain("Good news");

    const [activity] = await run<{ pullRequests: Array<{ number: number; state: string }> }>(graph, GH9_CODE_ACTIVITY, { issueId: "iss_aaaaaaaaaaaaaaaa" });
    expect(activity.pullRequests).toEqual([expect.objectContaining({ number: 21, state: "merged" })]);
  });

  it("seeing the same pull request again changes nothing", async () => {
    const before = posted.length;
    await recordPullRequest(graph, repo, pr("closed", "2026-10-15T11:00:00Z"), sink);
    expect(posted.length).toBe(before);
  });

  it("a pushed commit that mentions a Loopkeeper id is linked, and 'fixes' on main means might be fixed", async () => {
    await recordCommit(graph, repo, { sha: "abc1234def", message: "Fix timer on Tecno (fixes iss_bbbbbbbbbbbbbbbb)", url: "https://x", author: "kemi-dev", ts: Date.now() }, true, sink);
    expect(await status("iss_bbbbbbbbbbbbbbbb")).toBe("possibly_resolved");
    const [activity] = await run<{ commits: Array<{ sha: string }> }>(graph, GH9_CODE_ACTIVITY, { issueId: "iss_bbbbbbbbbbbbbbbb" });
    expect(activity.commits.map((c) => c.sha)).toEqual(["abc1234def"]);
  });

  it("lists issues, groups and repos even when optional properties were never set", async () => {
    // Regression: FalkorDB crashed when grouping by a property no node in the graph had (e.g. featureKey).
    const board = await run<{ id: string; feature: string }>(graph, Q11_BOARD);
    expect(board.map((i) => i.feature)).toEqual(["", ""]);
    await expect(run(graph, P4_GROUPS)).resolves.toEqual([]);
    await expect(run(graph, P6_REPOS)).resolves.toEqual([]);
  });

  it("a developer closing the GitHub issue resolves it in Loopkeeper", async () => {
    await recordIssueEvent(graph, repo, "closed", 7, "tunde-dev", sink);
    expect(await status("iss_aaaaaaaaaaaaaaaa")).toBe("resolved");
  });
});
