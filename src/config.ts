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
} as const;
