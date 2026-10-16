import type { Graph } from "falkordb";
import { posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { HG1_REPO, HG3_LINK_FEATURES_TO_PRODUCT } from "../graph/hq-queries.js";
import { IX1_FILES, IX2_FEATURES, IX3_FEATURE_FILES, IX4_OWNERS, IX5_IMPORTS, IX6_CODE_CONTENT, P7_REPO_MARK, run } from "../graph/queries.js";
import { embedLocally } from "../llm/embeddings.js";
import { gh, normaliseRepo, readRepoFile } from "./api.js";
import { readCode } from "./code-reading.js";

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|py|go|java|kt|rb|php|cs|swift|vue|svelte)$/;
const SKIPPED_DIRS = /(^|\/)(node_modules|dist|build|out|\.next|vendor|coverage|\.git|__snapshots__)\//;
const PARSES_IMPORTS = /\.(tsx?|jsx?|mjs|cjs)$/;
const MAX_FILES = 600;
/** Files whose source is read (outline, imports, embedding). Larger files are usually generated. */
const MAX_READ_FILES = 400;
const MAX_READ_BYTES = 200_000;
const EMBED_BATCH = 32;
/** Folder names that hold code rather than describe a product area. */
const ROOT_FOLDERS = new Set(["src", "app", "apps", "lib", "libs", "pages", "components", "server", "client", "api", "routes", "packages", "internal", "pkg", "cmd", "web", "frontend", "backend", "source"]);

export interface IndexResult {
  repo: string;
  product: string;
  files: number;
  /** Files whose source was read and embedded. */
  read: number;
  features: number;
  owners: number;
  imports: number;
  featureSource: "features.yaml" | "folders";
}

interface FeatureSpec {
  key: string;
  name: string;
  description?: string;
  paths: string[];
}

/**
 * Reads a GitHub repository (never writes to it) and adds its code to a product in the HQ graph:
 *   files → CodeFile, imports → IMPORTS, features.yaml (or folders) → Feature + IMPLEMENTED_IN,
 *   CODEOWNERS → developers who OWN files, and each file's source → what it defines (functions,
 *   classes, routes) plus an embedding in a vector index. That is what lets "teacher message → code
 *   → owner" work, and lets a new ticket find the files most likely involved.
 * `progress` hears each step, for the dashboard.
 */
export async function indexRepository(graph: Graph, repoInput: string, product: string, progress: (step: string) => void = () => undefined): Promise<IndexResult> {
  const repo = normaliseRepo(repoInput);
  const info = await gh<{ default_branch: string; html_url: string }>(`/repos/${repo}`);
  const branch = info.default_branch;
  await run(graph, HG1_REPO, { id: repo, url: info.html_url, defaultBranch: branch, product, ts: Date.now() });

  const tree = await gh<{ tree: Array<{ path: string; type: string; sha: string; size?: number }> }>(`/repos/${repo}/git/trees/${branch}?recursive=1`);
  const files = tree.tree
    .filter((entry) => entry.type === "blob" && CODE_FILE.test(entry.path) && !SKIPPED_DIRS.test(entry.path) && !entry.path.endsWith(".d.ts"))
    .slice(0, MAX_FILES);
  const fileId = (path: string) => `${repo}:${path}`;
  const paths = new Set(files.map((f) => f.path));

  progress(`Found ${files.length} code files in ${repo}`);
  await run(graph, IX1_FILES, {
    repo,
    files: files.map((f) => ({ id: fileId(f.path), path: f.path, language: posix.extname(f.path).slice(1) })),
  });

  // Features: the repo's own features.yaml if it has one, otherwise one feature per product folder.
  const declared = await readFeaturesFile(repo, branch);
  const features = declared ?? featuresFromFolders([...paths]);
  await run(graph, IX2_FEATURES, { features: features.map(({ key, name, description }) => ({ key, name, description: description ?? null })) });
  await run(graph, HG3_LINK_FEATURES_TO_PRODUCT, { product, keys: features.map((f) => f.key) });
  const links = files.flatMap((f) => {
    const feature = features.find((spec) => spec.paths.some((prefix) => f.path.startsWith(prefix)));
    return feature ? [{ feature: feature.key, fileId: fileId(f.path) }] : [];
  });
  await run(graph, IX3_FEATURE_FILES, { links });

  // Owners from CODEOWNERS.
  const codeowners = (await readRepoFile(repo, ".github/CODEOWNERS", branch)) ?? (await readRepoFile(repo, "CODEOWNERS", branch)) ?? (await readRepoFile(repo, "docs/CODEOWNERS", branch));
  const rules = codeowners ? parseCodeowners(codeowners) : [];
  const owners = files.flatMap((f) =>
    ownersOf(f.path, rules).map((handle) => ({ handle, personId: `gh_${handle.toLowerCase()}`, fileId: fileId(f.path) })),
  );
  await run(graph, IX4_OWNERS, { owners });

  // The source of each file: what it defines, what it imports, and an embedding of both.
  const readable = files.filter((f) => (f.size ?? 0) <= MAX_READ_BYTES).slice(0, MAX_READ_FILES);
  progress(`Reading the source of ${readable.length} files`);
  const sources = await readSources(repo, readable);
  const imports = sources.flatMap(({ path, source }) => (PARSES_IMPORTS.test(path) ? importsOf(path, source, paths) : []));
  await run(graph, IX5_IMPORTS, { imports: imports.map((i) => ({ from: fileId(i.from), to: fileId(i.to) })) });

  progress(`Embedding ${sources.length} files into the code vector index`);
  const outlines = sources.map(({ path, source }) => ({ path, ...readCode(path, source) }));
  for (let start = 0; start < outlines.length; start += EMBED_BATCH) {
    const batch = outlines.slice(start, start + EMBED_BATCH);
    const embeddings = await embedLocally(batch.map((o) => o.searchText));
    await run(graph, IX6_CODE_CONTENT, {
      ts: Date.now(),
      files: batch.map((o, i) => ({ id: fileId(o.path), symbols: o.symbols, routes: o.routes, outline: o.outline, embedding: embeddings[i] })),
    });
  }

  const featureSource = declared ? "features.yaml" : "folders";
  await run(graph, P7_REPO_MARK, { id: repo, indexedAt: Date.now(), syncedAt: null, featureSource });
  progress(`Done: ${files.length} files, ${outlines.length} read, ${imports.length} imports`);

  return {
    repo,
    product,
    files: files.length,
    read: outlines.length,
    features: features.length,
    owners: new Set(owners.map((o) => o.handle)).size,
    imports: imports.length,
    featureSource,
  };
}

/**
 * features.yaml (repo root, .github/ or .loopkeeper/):
 *   features:
 *     - key: score_submission
 *       name: Score submission
 *       description: Teachers saving scores after tests
 *       paths: [lib/scores/, app/scores/]
 */
async function readFeaturesFile(repo: string, branch: string): Promise<FeatureSpec[] | undefined> {
  for (const path of ["features.yaml", "features.yml", ".github/features.yaml", ".loopkeeper/features.yaml"]) {
    const text = await readRepoFile(repo, path, branch);
    if (!text) continue;
    const parsed = parseYaml(text) as { features?: Array<Partial<FeatureSpec>> };
    return (parsed.features ?? [])
      .filter((f): f is FeatureSpec => Boolean(f.key && f.paths?.length))
      .map((f) => ({ key: f.key, name: f.name ?? titleCase(f.key), description: f.description, paths: f.paths }));
  }
  return undefined;
}

/** One feature per top-level product folder, skipping folders like src/ or app/ that just hold code. */
export function featuresFromFolders(paths: string[]): FeatureSpec[] {
  const features = new Map<string, FeatureSpec>();
  for (const path of paths) {
    const folders = path.split("/").slice(0, -1);
    const index = folders.findIndex((folder) => !ROOT_FOLDERS.has(folder.toLowerCase()) && !/^[[(@_.]/.test(folder));
    if (index === -1) continue;
    const key = folders[index].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const prefix = `${folders.slice(0, index + 1).join("/")}/`;
    const feature = features.get(key) ?? { key, name: titleCase(key), description: `Code in ${prefix}`, paths: [] };
    if (!feature.paths.includes(prefix)) feature.paths.push(prefix);
    features.set(key, feature);
  }
  return [...features.values()];
}

interface OwnerRule {
  pattern: string;
  owners: string[];
}

export function parseCodeowners(text: string): OwnerRule[] {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners: owners.filter((o) => o.startsWith("@")).map((o) => o.slice(1)) };
    })
    .filter((rule) => rule.owners.length > 0);
}

/** CODEOWNERS semantics, simplified: the last matching rule wins. */
export function ownersOf(path: string, rules: OwnerRule[]): string[] {
  let owners: string[] = [];
  for (const rule of rules) if (codeownersMatch(rule.pattern, path)) owners = rule.owners;
  return owners;
}

function codeownersMatch(pattern: string, path: string): boolean {
  if (pattern === "*") return true;
  const anchored = pattern.startsWith("/");
  const clean = pattern.replace(/^\//, "");
  if (clean.startsWith("*.")) return path.endsWith(clean.slice(1));
  if (clean.endsWith("/")) return anchored ? path.startsWith(clean) : path.startsWith(clean) || path.includes(`/${clean}`);
  if (clean.endsWith("/*")) return path.startsWith(clean.slice(0, -1)) && !path.slice(clean.length - 1).includes("/");
  return anchored ? path === clean || path.startsWith(`${clean}/`) : path === clean || path.endsWith(`/${clean}`) || path.startsWith(`${clean}/`);
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/** The source of each file (files GitHub won't return are skipped). */
async function readSources(repo: string, files: Array<{ path: string; sha: string }>): Promise<Array<{ path: string; source: string }>> {
  const sources: Array<{ path: string; source: string }> = [];
  await inParallel(files, 8, async (file) => {
    const blob = await gh<{ content: string }>(`/repos/${repo}/git/blobs/${file.sha}`);
    sources.push({ path: file.path, source: Buffer.from(blob.content, "base64").toString("utf8") });
  });
  return sources;
}

function importsOf(path: string, source: string, known: Set<string>): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const match of source.matchAll(IMPORT)) {
    const target = resolveImport(path, match[1] ?? match[2] ?? match[3] ?? match[4], known);
    if (target && target !== path) edges.push({ from: path, to: target });
  }
  return edges;
}

/** Resolves "./x", "../x" and "@/x" (→ src/x) to a file in the repo, trying the usual extensions. */
export function resolveImport(from: string, specifier: string, known: Set<string>): string | undefined {
  let bases: string[];
  if (specifier.startsWith(".")) bases = [posix.normalize(posix.join(posix.dirname(from), specifier))];
  else if (specifier.startsWith("@/") || specifier.startsWith("~/")) bases = [`src/${specifier.slice(2)}`, specifier.slice(2)];
  else return undefined;
  const stripped = bases.flatMap((base) => [base, base.replace(/\.(js|mjs|cjs)$/, "")]);
  for (const base of stripped) for (const ext of EXTENSIONS) if (known.has(base + ext)) return base + ext;
  return undefined;
}

async function inParallel<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]).catch(() => undefined);
  });
  await Promise.all(workers);
}

function titleCase(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
