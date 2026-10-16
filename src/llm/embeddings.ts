import { env, pipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { config } from "../config.js";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let extractor: Promise<Extractor> | undefined;

// Kept outside node_modules, so a fresh install (every deploy) doesn't download the model again.
env.cacheDir = join(process.cwd(), ".cache", "models");

/**
 * Sentence embeddings computed locally (all-MiniLM-L6-v2, 384 dimensions): free, no API key.
 * The model (~23 MB) is downloaded once on first use and cached.
 */
export async function embedLocally(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  extractor ??= pipeline("feature-extraction", config.llm.embeddingModel, { dtype: "q8" }) as unknown as Promise<Extractor>;
  const run = await extractor;
  const output = await run(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
