import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(import.meta.dirname, "..", "..", ".cache", "llm");

/**
 * Remembers model replies on disk, keyed by the exact request.
 * Replaying the same chat again is then instant and costs no API quota, which matters on free tiers.
 */
export const responseCache = {
  key(parts: unknown): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  },

  get<T>(key: string): T | undefined {
    const file = join(CACHE_DIR, `${key}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
  },

  set(key: string, value: unknown): void {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  },
};
