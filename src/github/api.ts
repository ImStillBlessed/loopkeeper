import { setting } from "../settings.js";

const API = "https://api.github.com";

export function githubConfigured(): boolean {
  return Boolean(setting("githubToken"));
}

/** "owner/name" or a github.com URL → "owner/name". */
export function normaliseRepo(input: string): string {
  const match = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(input.trim());
  if (!match) throw new Error(`"${input}" is not a GitHub repository. Use owner/name.`);
  return `${match[1]}/${match[2]}`;
}

/** A GitHub REST call. Loopkeeper only ever reads code; the only writes are issues and issue comments. */
export async function gh<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!githubConfigured()) throw new Error("No GitHub token yet. Add one in Settings.");
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${setting("githubToken")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "loopkeeper",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(`GitHub ${response.status} on ${path}: ${(detail as { message?: string }).message ?? response.statusText}`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Like gh(), but a 404 returns undefined (for optional files such as CODEOWNERS). */
export async function ghOptional<T>(path: string): Promise<T | undefined> {
  try {
    return await gh<T>(path);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

/** Reads a text file from a repository, or undefined if it doesn't exist. */
export async function readRepoFile(repo: string, path: string, ref: string): Promise<string | undefined> {
  const file = await ghOptional<{ content?: string; encoding?: string }>(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
  return file?.content ? Buffer.from(file.content, "base64").toString("utf8") : undefined;
}
