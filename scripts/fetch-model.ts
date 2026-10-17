/**
 * Downloads the local embedding model and checks it works, so the desk never has to download it
 * while messages are coming in. Run on every deploy: `npm run model:fetch`.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODEL_CACHE_DIR, embedLocally } from "../src/llm/embeddings.js";

try {
  const [vector] = await embedLocally(["The scores page is not saving"]);
  if (vector?.length !== 384) throw new Error(`Expected 384 numbers, got ${vector?.length ?? 0}`);
  console.log(`Embedding model ready (${listFiles(MODEL_CACHE_DIR).length} files in ${MODEL_CACHE_DIR}).`);
  process.exit(0);
} catch (error) {
  console.error((error as Error).message);
  console.error("Files in the model cache:", listFiles(MODEL_CACHE_DIR).join(", ") || "none");
  process.exit(1);
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [`${path.slice(MODEL_CACHE_DIR.length + 1)} (${statSync(path).size} bytes)`];
    });
  } catch {
    return [];
  }
}
