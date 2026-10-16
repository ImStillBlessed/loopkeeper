/**
 * What the desk keeps from reading a source file: the names it defines (functions, classes, routes)
 * and a short outline. The outline is embedded, so a teacher's words ("scores won't save") can find
 * the code that does it (saveScores in lib/scores/submit.ts) through FalkorDB's vector index.
 * The source itself is never stored; it is read again from GitHub when a ticket needs it.
 */

const MAX_SYMBOLS = 40;
const MAX_OUTLINE = 700;

/** Definitions worth naming, across the languages Ednovax uses. Each pattern's first group is the name. */
const DEFINITIONS: RegExp[] = [
  // JavaScript / TypeScript
  /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\n)\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  // Python
  /(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/g,
  // Go
  /(?:^|\n)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
  // PHP, Java, Kotlin, C# methods with a visibility keyword
  /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:function\s+|fun\s+|[\w<>[\],?\s]+\s+)([A-Za-z_]\w*)\s*\(/g,
];

/** HTTP routes: Express/Hono (app.get('/x')), Laravel (Route::post('/x')), Flask/FastAPI (@app.get('/x')). */
const ROUTES = /(?:\b(?:app|router|api|route|Route::)\.?|@\w+\.)(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

const IGNORED = new Set(["if", "for", "while", "switch", "catch", "function", "return", "constructor", "render", "default", "main", "init", "get", "set"]);

export interface CodeOutline {
  symbols: string[];
  routes: string[];
  /** Names, routes and the file's opening comment, in a few lines. */
  outline: string;
  /** What gets embedded: the path and names split into plain words, plus the outline. */
  searchText: string;
}

export function readCode(path: string, source: string): CodeOutline {
  const symbols = new Set<string>();
  for (const pattern of DEFINITIONS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name && name.length > 2 && !IGNORED.has(name)) symbols.add(name);
      if (symbols.size >= MAX_SYMBOLS) break;
    }
  }
  const routes = [...new Set([...source.matchAll(ROUTES)].map((m) => `${m[1].toUpperCase()} ${m[2]}`))].slice(0, 15);
  const comment = openingComment(source);

  const outline = [
    symbols.size ? `Defines: ${[...symbols].join(", ")}` : "",
    routes.length ? `Routes: ${routes.join(", ")}` : "",
    comment ? `About: ${comment}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_OUTLINE);

  const searchText = [words(path), [...symbols].map(words).join(", "), routes.join(", "), comment].filter(Boolean).join(". ");
  return { symbols: [...symbols], routes, outline, searchText };
}

/** "lib/scores/saveScores.ts" → "lib scores save scores ts", so plain English can match code names. */
export function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\:]+/g, " ")
    .toLowerCase()
    .trim();
}

/** The first block or line comment at the top of a file, if it says something. */
function openingComment(source: string): string {
  const head = source.slice(0, 2000);
  const block = /\/\*\*?([\s\S]*?)\*\//.exec(head)?.[1] ?? /^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(head)?.[1];
  const lines = block ?? [...head.matchAll(/^\s*(?:\/\/|#)(?!!)\s?(.*)$/gm)].slice(0, 4).map((m) => m[1]).join(" ");
  return lines
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
