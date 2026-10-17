import * as nodeModule from "node:module";
import { join } from "node:path";
import { config } from "../config.js";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let extractor: Promise<Extractor> | undefined;

/** Where the model files are kept: outside node_modules, so a fresh install (every deploy) doesn't download them again. */
export const MODEL_CACHE_DIR = join(process.cwd(), ".cache", "models");

/**
 * transformers.js loads sharp (an image library) as soon as it is imported, though we only embed
 * text. sharp's prebuilt binaries need a newer CPU than some servers have (x86-64-v2), so it is
 * replaced by a stand-in that is never called. Must run before transformers.js is imported.
 */
function leaveOutSharp(): void {
  const stub = `data:text/javascript,${encodeURIComponent(`export default function sharp() { throw new Error("Image processing isn't available: the desk only embeds text"); }`)}`;
  // registerHooks (in-thread) arrived in Node 22.15; on Node 20 only the older register exists.
  const { register, registerHooks } = nodeModule as { register: typeof nodeModule.register; registerHooks?: typeof nodeModule.registerHooks };
  if (registerHooks) {
    registerHooks({ resolve: (specifier, context, next) => (specifier === "sharp" ? { url: stub, shortCircuit: true } : next(specifier, context)) });
    return;
  }
  const hooks = `export async function resolve(specifier, context, next) {
    return specifier === "sharp" ? { url: ${JSON.stringify(stub)}, shortCircuit: true } : next(specifier, context);
  }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}

async function loadExtractor(): Promise<Extractor> {
  leaveOutSharp();
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = MODEL_CACHE_DIR;
  return pipeline("feature-extraction", config.llm.embeddingModel, { dtype: "q8" }) as unknown as Promise<Extractor>;
}

/**
 * Sentence embeddings computed locally (all-MiniLM-L6-v2, 384 dimensions): free, no API key.
 * The model (~23 MB) is downloaded once (on deploy, or on first use) and cached.
 */
export async function embedLocally(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  // A failed load (e.g. the download broke off) is tried again next time rather than remembered.
  extractor ??= loadExtractor().catch((error: Error) => {
    extractor = undefined;
    throw new Error(`The embedding model couldn't be loaded (${config.llm.embeddingModel}, cached in ${MODEL_CACHE_DIR}): ${error.message}`);
  });
  const run = await extractor;
  const output = await run(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
