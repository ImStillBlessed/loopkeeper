import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { setting } from "../settings.js";
import { recordCommit, recordIssueEvent, recordPullRequest, type PullRequestPayload } from "../github/activity.js";
import { listProjectIds } from "../graph/client.js";
import { getRuntime } from "../runtime/project.js";

/**
 * GitHub webhook: point a repository's webhook at /api/github/webhook/<project>
 * (content type application/json; events: pull requests, pushes, issues).
 * Same handling as polling, just instant.
 */
export const githubWebhook = new Hono();

githubWebhook.post("/:project", async (c) => {
  const projectId = c.req.param("project");
  if (!(await listProjectIds()).includes(projectId)) return c.json({ error: "Unknown project" }, 404);

  const raw = await c.req.text();
  if (setting("githubWebhookSecret") && !validSignature(raw, c.req.header("x-hub-signature-256"))) {
    return c.json({ error: "Bad signature" }, 401);
  }

  const event = c.req.header("x-github-event");
  const payload = JSON.parse(raw);
  const runtime = await getRuntime(projectId);
  const repo: string = payload.repository?.full_name;

  if (event === "pull_request") {
    await recordPullRequest(runtime.graph, repo, payload.pull_request as PullRequestPayload, runtime.sink);
  }
  if (event === "push") {
    const onDefaultBranch = payload.ref === `refs/heads/${payload.repository?.default_branch}`;
    for (const commit of payload.commits ?? []) {
      await recordCommit(
        runtime.graph,
        repo,
        { sha: commit.id, message: commit.message, url: commit.url, author: commit.author?.username ?? commit.author?.name ?? "someone", ts: Date.parse(commit.timestamp) },
        onDefaultBranch,
        runtime.sink,
      );
    }
  }
  if (event === "issues" && !payload.issue?.pull_request) {
    await recordIssueEvent(runtime.graph, repo, payload.action, payload.issue.number, payload.sender?.login ?? "someone", runtime.sink);
  }
  return c.json({ ok: true });
});

function validSignature(body: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", setting("githubWebhookSecret")).update(body).digest("hex")}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
