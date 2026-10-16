import type { Graph } from "falkordb";
import { H6_PRODUCT_FEATURES, H7B_PRODUCT_CODE_CONTENT, H7_PRODUCT_FILES, H8_PRODUCT_IMPORTS } from "../graph/hq-queries.js";
import { IX5_IMPORTS, RP1_FEATURES, RP2_FILES, RP3_OWNERS, RP4_CODE_CONTENT, run } from "../graph/queries.js";

const CONTENT_BATCH = 100;

/**
 * Copies the product reference (features, code files, owners, imports, and what each file defines
 * with its embedding) for the given products
 * from HQ into one client's graph. Only product data moves; nothing about other clients does.
 * Run when a client is created, its products change, or a product's repo is re-indexed.
 */
export async function copyProductReference(hq: Graph, clientGraph: Graph, products: string[]): Promise<void> {
  if (products.length === 0) return;

  const features = await run<{ key: string; name: string; description: string; product: string }>(hq, H6_PRODUCT_FEATURES, { products });
  await run(clientGraph, RP1_FEATURES, { features });

  const rows = await run<{ feature: string; id: string; path: string; repo: string; ownerId: string; ownerName: string }>(hq, H7_PRODUCT_FILES, { products });
  const files = [...new Map(rows.map((r) => [r.id, { id: r.id, path: r.path, repo: r.repo, feature: r.feature }])).values()];
  await run(clientGraph, RP2_FILES, { files });
  await run(clientGraph, RP3_OWNERS, {
    owners: rows.filter((r) => r.ownerId).map((r) => ({ id: r.ownerId, name: r.ownerName, fileId: r.id })),
  });

  const imports = await run<{ from: string; to: string }>(hq, H8_PRODUCT_IMPORTS, { products });
  await run(clientGraph, IX5_IMPORTS, { imports });

  const content = await run(hq, H7B_PRODUCT_CODE_CONTENT, { products });
  for (let start = 0; start < content.length; start += CONTENT_BATCH) {
    await run(clientGraph, RP4_CODE_CONTENT, { files: content.slice(start, start + CONTENT_BATCH) });
  }
}
