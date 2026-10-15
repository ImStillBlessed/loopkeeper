import OpenAI from "openai";
import { config } from "../config.js";
import { onSettingsChange, setting } from "../settings.js";
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

let client: OpenAI | undefined;
// A new key saved in Settings takes effect on the next call (and gets a clean slate).
onSettingsChange(() => {
  client = undefined;
  coolingDown.clear();
});

/** Groq speaks the OpenAI API, so the official OpenAI SDK works with a different base URL. */
export function chatClient(): OpenAI {
  if (!setting("groqApiKey")) {
    throw new Error("No Groq API key yet. Add a free key (console.groq.com/keys) in Settings.");
  }
  client ??= new OpenAI({
    apiKey: setting("groqApiKey"),
    baseURL: config.llm.baseURL,
    // Rate limits are handled below by switching model, not by waiting.
    maxRetries: 1,
  });
  return client;
}

/**
 * Extra settings for reasoning models (gpt-oss). Triage stays at low effort to save tokens;
 * extraction and the agent think a little harder, which fixes mix-ups like a promise
 * being attached to the wrong conversation.
 */
export function modelOptions(model: string, effort: "low" | "medium" = "medium"): { reasoning_effort?: "low" | "medium" } {
  return model.includes("gpt-oss") ? { reasoning_effort: effort } : {};
}

/** Models that hit a rate or daily limit, and when Groq said to try again. */
const coolingDown = new Map<string, number>();

const isRateLimit = (error: unknown) => (error as { status?: number }).status === 429;

/** "Please try again in 4m26.976s" → milliseconds (default: one minute). */
function retryAfterMs(error: unknown): number {
  const match = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec((error as Error).message ?? "");
  if (!match) return 60_000;
  const [, h = "0", m = "0", s = "0"] = match;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}

/**
 * Runs a chat completion on the tier's model, falling back to the other model when one is
 * rate-limited. On Groq every model has its own daily token allowance, so two models give the
 * free tier twice the room. A model that hit its limit is skipped until Groq says it's free again.
 */
export async function completeWithFallback(
  tier: Tier,
  request: (model: string, effort: "low" | "medium") => Promise<OpenAI.Chat.Completions.ChatCompletion>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const primary = setting(tier === "fast" ? "fastModel" : "smartModel");
  const secondary = setting(tier === "fast" ? "smartModel" : "fastModel");
  const effort = tier === "fast" ? "low" : "medium";
  const candidates = [...new Set([primary, secondary])];
  const available = candidates.filter((model) => (coolingDown.get(model) ?? 0) <= Date.now());

  let lastError: unknown;
  for (const model of available.length ? available : candidates) {
    try {
      return await request(model, effort);
    } catch (error) {
      if (!isRateLimit(error)) throw error;
      coolingDown.set(model, Date.now() + retryAfterMs(error));
      lastError = error;
    }
  }
  throw new ProviderLimitError(lastError);
}

/** Every model is out of quota for now. The message is written for the dashboard. */
export class ProviderLimitError extends Error {
  readonly status = 429;
  constructor(cause: unknown) {
    const wait = Math.max(1, Math.ceil(Math.min(...[...coolingDown.values()].map((until) => until - Date.now())) / 60_000));
    super(`Groq's free limit is used up on both models for now (try again in about ${wait} min), or add another key in Settings.`, { cause });
  }
}

export const groqLlm: Llm = {
  async json<T>(tier: Tier, system: string, user: unknown): Promise<T> {
    const content = typeof user === "string" ? user : JSON.stringify(user);
    const cacheKey = responseCache.key([setting(tier === "fast" ? "fastModel" : "smartModel"), system, content]);
    const cached = config.llm.cache ? responseCache.get<T>(cacheKey) : undefined;
    if (cached) return cached;

    const response = await completeWithFallback(tier, (model, effort) =>
      chatClient().chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        ...modelOptions(model, effort),
      }),
    );
    const result = JSON.parse(response.choices[0]?.message.content ?? "{}") as T;
    if (config.llm.cache) responseCache.set(cacheKey, result);
    return result;
  },

  embed: embedLocally,
};
