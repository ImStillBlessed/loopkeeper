import Anthropic from "@anthropic-ai/sdk";
import { onSettingsChange, setting } from "../settings.js";
import { config } from "../config.js";
import { responseCache } from "./cache.js";
import { embedLocally } from "./embeddings.js";

/**
 * The two things the pipeline needs from a language model.
 * Kept behind an interface so tests can swap in a fake and run without an API key.
 */
export interface Llm {
  /** Ask for a JSON object. `tier` picks the cheap or the strong model. */
  json<T>(tier: "fast" | "smart", system: string, user: unknown): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}

export type Tier = "fast" | "smart";

/** Enough room for an extraction or a long answer; small models stop well before this. */
export const MAX_TOKENS = 4096;

let client: Anthropic | undefined;
// A new key saved in Settings takes effect on the next call (and gets a clean slate).
onSettingsChange(() => {
  client = undefined;
  coolingDown.clear();
});

/** Claude, through Anthropic's own SDK. The key comes from Settings (or ANTHROPIC_API_KEY in .env). */
export function anthropic(): Anthropic {
  if (!setting("anthropicApiKey")) {
    throw new Error("No Anthropic API key yet. Add one in Settings → Connections (console.anthropic.com).");
  }
  // Rate limits are handled below by switching model, so the SDK retries only brief network hiccups.
  // An organisation-level key must also name a workspace; a workspace key needs nothing extra.
  const workspace = setting("anthropicWorkspaceId");
  client ??= new Anthropic({
    apiKey: setting("anthropicApiKey"),
    maxRetries: 1,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  return client;
}

/** Models that hit a rate limit, and when Anthropic said to try again. */
const coolingDown = new Map<string, number>();

/** The retry-after header (seconds), or one minute. */
function retryAfterMs(error: InstanceType<typeof Anthropic.RateLimitError>): number {
  const seconds = Number(error.headers?.get?.("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/**
 * Runs a request on the tier's model, falling back to the other tier's model if one is rate-limited
 * (when they are different models). A limited model is skipped until Anthropic says it's free again.
 */
export async function completeWithFallback<T>(tier: Tier, request: (model: string) => Promise<T>): Promise<T> {
  const primary = setting(tier === "fast" ? "fastModel" : "smartModel");
  const secondary = setting(tier === "fast" ? "smartModel" : "fastModel");
  const candidates = [...new Set([primary, secondary])];
  const available = candidates.filter((model) => (coolingDown.get(model) ?? 0) <= Date.now());

  let lastError: unknown;
  for (const model of available.length ? available : candidates) {
    try {
      return await request(model);
    } catch (error) {
      if (!(error instanceof Anthropic.RateLimitError)) throw error;
      coolingDown.set(model, Date.now() + retryAfterMs(error));
      lastError = error;
    }
  }
  throw new ProviderLimitError(lastError);
}

/** Every model is rate-limited for now. The message is written for the dashboard. */
export class ProviderLimitError extends Error {
  readonly status = 429;
  constructor(cause: unknown) {
    const wait = Math.max(1, Math.ceil(Math.min(...[...coolingDown.values()].map((until) => until - Date.now())) / 60_000));
    super(`Anthropic's rate limit was reached (try again in about ${wait} min).`, { cause });
  }
}

/** The text of a reply, joined from its text blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** The JSON object in a reply, even if the model wrapped it in a code fence or a sentence. */
export function parseJsonObject<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model didn't return JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export const claudeLlm: Llm = {
  async json<T>(tier: Tier, system: string, user: unknown): Promise<T> {
    const content = typeof user === "string" ? user : JSON.stringify(user);
    const cacheKey = responseCache.key([setting(tier === "fast" ? "fastModel" : "smartModel"), system, content]);
    const cached = config.llm.cache ? responseCache.get<T>(cacheKey) : undefined;
    if (cached) return cached;

    const response = await completeWithFallback(tier, (model) =>
      anthropic().messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: `${system}\n\nReply with one JSON object only: no prose, no code fence.`,
        messages: [{ role: "user", content }],
      }),
    );
    const result = parseJsonObject<T>(textOf(response));
    if (config.llm.cache) responseCache.set(cacheKey, result);
    return result;
  },

  embed: embedLocally,
};
