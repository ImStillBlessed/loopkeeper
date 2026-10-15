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

let client: OpenAI | undefined;
// A new key saved in Settings takes effect on the next call.
onSettingsChange(() => {
  client = undefined;
});

/** Groq speaks the OpenAI API, so the official OpenAI SDK works with a different base URL. */
export function chatClient(): OpenAI {
  if (!setting("groqApiKey")) {
    throw new Error("No Groq API key yet. Add a free key (console.groq.com/keys) in Settings.");
  }
  client ??= new OpenAI({
    apiKey: setting("groqApiKey"),
    baseURL: config.llm.baseURL,
    // Free tiers rate-limit hard; the SDK waits for the retry-after header and tries again.
    maxRetries: 8,
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

export const groqLlm: Llm = {
  async json<T>(tier: "fast" | "smart", system: string, user: unknown): Promise<T> {
    const model = setting(tier === "fast" ? "fastModel" : "smartModel");
    const content = typeof user === "string" ? user : JSON.stringify(user);
    const cacheKey = responseCache.key([model, system, content]);
    const cached = config.llm.cache ? responseCache.get<T>(cacheKey) : undefined;
    if (cached) return cached;

    const response = await chatClient().chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      ...modelOptions(model, tier === "fast" ? "low" : "medium"),
    });
    const result = JSON.parse(response.choices[0]?.message.content ?? "{}") as T;
    if (config.llm.cache) responseCache.set(cacheKey, result);
    return result;
  },

  embed: embedLocally,
};
