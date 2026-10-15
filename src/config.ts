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
  /** The project opened by default (and seeded with the demo data on first start). */
  defaultProject: env("DEFAULT_PROJECT", "ednovax"),
  idHashSalt: env("ID_HASH_SALT", "loopkeeper-dev-salt"),
  /** Chat exports carry local wall-clock times. Lagos is UTC+1 all year (no DST). */
  chatUtcOffset: "+01:00",
  timeZone: "Africa/Lagos",
  llm: {
    /** Claude's smallest, cheapest model for triage (runs on every batch of messages). */
    fastModel: env("LLM_FAST_MODEL", "claude-haiku-5-5"),
    /** Extraction and the Ask agent. The same small model by default, to keep costs low. */
    smartModel: env("LLM_SMART_MODEL", "claude-haiku-5-5"),
    /** Runs locally via transformers.js: no API needed. */
    embeddingModel: env("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2"),
    /** Cache model replies on disk so replaying the same chat costs nothing. */
    cache: env("LLM_CACHE", "true") === "true",
  },
  /** Two issues closer than this cosine distance become SIMILAR_TO candidates for merging. */
  duplicateMaxDistance: Number(env("DUPLICATE_MAX_DISTANCE", "0.45")),
  /** Tickets from different clients on the same feature closer than this become one cross-client pattern. */
  patternMaxDistance: Number(env("PATTERN_MAX_DISTANCE", "0.5")),
  /** Below this confidence a "it's working now" only marks an issue "possibly resolved". */
  autoCloseMinConfidence: Number(env("AUTO_CLOSE_MIN_CONFIDENCE", "0.75")),
  github: {
    /** How often to look for new pull requests and pushes when no webhook is set up. */
    pollSeconds: Number(env("GITHUB_POLL_SECONDS", "60")),
  },
  port: Number(env("PORT", "8787")),
} as const;
