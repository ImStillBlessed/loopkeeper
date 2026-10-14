import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(import.meta.dirname, "..", "..", "prompts");
const cache = new Map<string, string>();

/** Prompts live as Markdown files in /prompts so they are easy to read and tweak. */
export function prompt(name: "triage" | "extract" | "merge-judge" | "agent"): string {
  let text = cache.get(name);
  if (!text) {
    text = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
    cache.set(name, text);
  }
  return text;
}
