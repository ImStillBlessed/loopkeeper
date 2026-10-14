import { existsSync } from "node:fs";

// Load .env if present (Node's built-in loader, no dotenv dependency).
if (existsSync(".env")) process.loadEnvFile(".env");

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  falkordb: {
    host: env("FALKORDB_HOST", "127.0.0.1"),
    port: Number(env("FALKORDB_PORT", "6379")),
    username: process.env.FALKORDB_USERNAME || undefined,
    password: process.env.FALKORDB_PASSWORD || undefined,
  },
  tenant: env("TENANT", "ednovax"),
  idHashSalt: env("ID_HASH_SALT", "loopkeeper-dev-salt"),
  /** Chat exports carry local wall-clock times. Lagos is UTC+1 all year (no DST). */
  chatUtcOffset: "+01:00",
  timeZone: "Africa/Lagos",
  llm: {
    /** Free key from https://console.groq.com/keys */
    apiKey: process.env.GROQ_API_KEY ?? "",
    /** Any OpenAI-compatible endpoint works; Groq by default. */
    baseURL: env("LLM_BASE_URL", "https://api.groq.com/openai/v1"),
    /** Small fast model for triage (runs on every batch of messages). */
    fastModel: env("LLM_FAST_MODEL", "openai/gpt-oss-20b"),
    /** Stronger model for extraction and the ask agent (needs JSON mode + tool calling). */
    smartModel: env("LLM_SMART_MODEL", "openai/gpt-oss-120b"),
    /** Runs locally via transformers.js: no API needed. */
    embeddingModel: env("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2"),
    /** Cache model replies on disk so replaying the same chat costs nothing. */
    cache: env("LLM_CACHE", "true") === "true",
  },
  /** Two issues closer than this cosine distance become SIMILAR_TO candidates for merging. */
  duplicateMaxDistance: Number(env("DUPLICATE_MAX_DISTANCE", "0.45")),
  /** Below this confidence a "it's working now" only marks an issue "possibly resolved". */
  autoCloseMinConfidence: Number(env("AUTO_CLOSE_MIN_CONFIDENCE", "0.75")),
  port: Number(env("PORT", "8787")),
} as const;
