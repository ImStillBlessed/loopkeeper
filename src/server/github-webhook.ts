import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { recordCommit, recordIssueEvent, recordPullRequest, type PullRequestPayload } from "../github/activity.js";
import { HG7_WEBHOOK_DELIVERY } from "../graph/hq-queries.js";
import { run } from "../graph/queries.js";
import { getWorld } from "../runtime/world.js";
import { setting } from "../settings.js";

/**
 * GitHub webhook: point a repository's webhook at /api/github/webhook
 * (content type application/json; events: pull requests, pushes, issues).
 * Same handling as polling, just instant. Tickets in any client are found through HQ.
 */
export const githubWebhook = new Hono();

githubWebhook.post("/*", async (c) => {
  const raw = await c.req.text();
  const event = c.req.header("x-github-event") ?? "unknown";
  // Webhooks can be set to application/json or application/x-www-form-urlencoded (payload=<json>).
  const isForm = (c.req.header("content-type") ?? "").includes("x-www-form-urlencoded");
  const payload = parse(isForm ? (new URLSearchParams(raw).get("payload") ?? "{}") : raw);
  const repo: string = payload.repository?.full_name;
  const world = await getWorld();
  const delivered = (error: string) => (repo ? run(world.hq, HG7_WEBHOOK_DELIVERY, { repo, ts: Date.now(), event, error }) : Promise.resolve([]));

  if (setting("githubWebhookSecret") && !validSignature(raw, c.req.header("x-hub-signature-256"))) {
    await delivered("the signature doesn't match the webhook secret in Settings");
    return c.json({ error: "Bad signature" }, 401);
  }
  await delivered("");
  if (repo) world.hub.emit({ kind: "activity", text: `GitHub webhook: ${event} from ${repo}`, ts: new Date(world.clock.peek()).toISOString(), source: "github" });

  // GitHub's first delivery is a "ping" to check the URL works.
  if (event === "ping") return c.json({ ok: true, pong: true });
  const router = world.githubRouter();

  if (event === "pull_request") {
    await recordPullRequest(router, repo, payload.pull_request as PullRequestPayload);
  }
  if (event === "push") {
    const onDefaultBranch = payload.ref === `refs/heads/${payload.repository?.default_branch}`;
    for (const commit of payload.commits ?? []) {
      await recordCommit(
        router,
        repo,
        { sha: commit.id, message: commit.message, url: commit.url, author: commit.author?.username ?? commit.author?.name ?? "someone", ts: Date.parse(commit.timestamp) },
        onDefaultBranch,
      );
    }
  }
  if (event === "issues" && !payload.issue?.pull_request) {
    await recordIssueEvent(router, repo, payload.action, payload.issue.number, payload.sender?.login ?? "someone");
  }
  return c.json({ ok: true });
});

/** A webhook payload, or {} if it isn't JSON. */
function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function validSignature(body: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", setting("githubWebhookSecret")).update(body).digest("hex")}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
