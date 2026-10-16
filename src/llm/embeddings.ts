import { register } from "node:module";
import { join } from "node:path";
import { config } from "../config.js";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let extractor: Promise<Extractor> | undefined;

/**
 * transformers.js loads sharp (an image library) as soon as it is imported, though we only embed
 * text. sharp's prebuilt binaries need a newer CPU than some servers have (x86-64-v2), so it is
 * replaced by a stand-in that is never called. Must be registered before transformers.js is imported.
 */
const NO_SHARP = `export default function sharp() { throw new Error("Image processing isn't available: the desk only embeds text"); }`;
const HOOKS = `export async function resolve(specifier, context, next) {
  if (specifier === "sharp") return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(NO_SHARP)}), shortCircuit: true };
  return next(specifier, context);
}`;

async function loadExtractor(): Promise<Extractor> {
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  const { env, pipeline } = await import("@huggingface/transformers");
  // Kept outside node_modules, so a fresh install (every deploy) doesn't download the model again.
  env.cacheDir = join(process.cwd(), ".cache", "models");
  return pipeline("feature-extraction", config.llm.embeddingModel, { dtype: "q8" }) as unknown as Promise<Extractor>;
}

/**
 * Sentence embeddings computed locally (all-MiniLM-L6-v2, 384 dimensions): free, no API key.
 * The model (~23 MB) is downloaded once on first use and cached.
 */
export async function embedLocally(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  extractor ??= loadExtractor();
  const run = await extractor;
  const output = await run(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
