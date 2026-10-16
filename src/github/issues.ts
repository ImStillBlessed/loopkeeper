import type { Graph } from "falkordb";
import { GH1_LINK_ISSUE, GH3_GITHUB_LINK, Q12_EVIDENCE, Q13_ISSUE, Q21_LIKELY_CODE, Q2_CODE_PATH, Q3_IMPACT, run } from "../graph/queries.js";
import { STATUS_WORDS } from "../pipeline/status.js";
import { formatLagos } from "../pipeline/time.js";
import { gh, normaliseRepo } from "./api.js";

/**
 * Opens a GitHub issue for a Loopkeeper issue, written from the graph: what the schools said (quoted),
 * where it lives in the code, who owns it, and how far it reaches. Developers get the full context
 * without ever reading the WhatsApp group.
 */
export async function openGithubIssue(graph: Graph, repoInput: string, issueId: string): Promise<{ number: number; url: string }> {
  const repo = normaliseRepo(repoInput);
  const [existing] = await run<{ number: number | null; url: string | null }>(graph, GH3_GITHUB_LINK, { issueId });
  if (existing?.number && existing.url) return { number: existing.number, url: existing.url };

  const [issue] = await run<{ title: string; summary: string; severity: string; kind: string }>(graph, Q13_ISSUE, { issueId });
  if (!issue) throw new Error(`No issue ${issueId}`);
  const messages = await run<{ text: string; ts: number; sender: string; school: string | null }>(graph, Q12_EVIDENCE, { issueId });
  const [code] = await run<{ feature: string | null; files: string[]; codeOwners: string[]; assignee: string | null }>(graph, Q2_CODE_PATH, { issueId });
  const impact = await run<{ school: string; hasReported: boolean }>(graph, Q3_IMPACT, { issueId });
  const likely = await run<{ path: string; repo: string; functions: string[]; why: string; confidence: number; readSource: boolean }>(graph, Q21_LIKELY_CODE, { issueId });

  const quotes = messages
    .slice(0, 8)
    .map((m) => `> **${m.sender}**${m.school ? ` (${m.school})` : ""}, ${formatLagos(m.ts)}\n> ${(m.text || "_sent a photo_").replace(/\n/g, "\n> ")}`)
    .join("\n\n");
  const reported = impact.filter((s) => s.hasReported).map((s) => s.school);

  const body = [
    issue.summary,
    `## What the schools are saying\n\n${quotes || "_No messages yet._"}`,
    likely.length
      ? `## Where it most likely is\n\n${likely
          .map((l) => {
            const functions = l.functions.length ? `: ${l.functions.map((f) => "`" + f + "`").join(", ")}` : "";
            return `- [\`${l.path}\`](https://github.com/${l.repo}/blob/HEAD/${l.path})${functions}. ${l.why} _(${Math.round(l.confidence * 100)}% sure${l.readSource ? ", read the source" : ""})_`;
          })
          .join("\n")}`
      : "",
    code?.feature
      ? `## Where it lives\n\n- Feature: **${code.feature}**\n- Files: ${code.files.slice(0, 8).map((f) => `\`${f}\``).join(", ") || "_none indexed_"}\n- Owner: ${code.assignee ?? code.codeOwners[0] ?? "_unassigned_"}`
      : "",
    impact.length ? `## Impact\n\nReported by ${reported.length} of ${impact.length} schools that use this feature${reported.length ? `: ${reported.join(", ")}` : ""}.` : "",
    `---\n_Opened by Loopkeeper from the WhatsApp support group. Severity: ${issue.severity}. Loopkeeper id: \`${issueId}\`._\n_Mention \`#<this issue>\` or \`${issueId}\` in a pull request or commit and Loopkeeper will link it._`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const created = await gh<{ number: number; html_url: string }>(`/repos/${repo}/issues`, { method: "POST", body: { title: issue.title, body } }).catch((error: Error & { status?: number }) => {
    // GitHub answers 404 (not 403) when a fine-grained token may read a private repo but not write to it.
    if (error.status === 404 || error.status === 403) {
      throw Object.assign(new Error(`GitHub won't let the desk open an issue in ${repo}: the token needs Issues: Read and write on it (Products → GitHub connections shows what's missing).`), { status: error.status });
    }
    throw error;
  });
  await run(graph, GH1_LINK_ISSUE, { issueId, repo, number: created.number, url: created.html_url });
  return { number: created.number, url: created.html_url };
}

/**
 * Keeps a linked GitHub issue in step with Loopkeeper: a comment explaining every status change,
 * closed when the issue is resolved, reopened when it breaks again.
 */
export async function syncGithubIssue(graph: Graph, issueId: string, to: string, reason: string): Promise<void> {
  const [link] = await run<{ repo: string | null; number: number | null }>(graph, GH3_GITHUB_LINK, { issueId });
  if (!link?.repo || !link.number) return;

  const path = `/repos/${link.repo}/issues/${link.number}`;
  await gh(`${path}/comments`, { method: "POST", body: { body: `**Loopkeeper:** now ${STATUS_WORDS[to] ?? to}.\n\n${reason}` } });
  if (to === "resolved") await gh(path, { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
  if (to === "open") await gh(path, { method: "PATCH", body: { state: "open" } });
}
