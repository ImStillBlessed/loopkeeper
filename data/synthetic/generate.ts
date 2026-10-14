/**
 * Writes the synthetic chat to data/synthetic/output/:
 *   ednovax-schools-support.android.txt   WhatsApp export, Android format
 *   ednovax-schools-support.ios.txt       Same chat, iOS format
 *   ednovax-schools-support.labels.json   Ground truth per message (relevant? type? scenario?) for scoring triage
 *   roster.json                           Schools and people (who works where), the seed for the graph
 *
 * Usage: npm run data:generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAST, SCHOOLS } from "./cast.js";
import { buildChat, formatExport, GROUP_NAME } from "./generator.js";

const outputDir = join(import.meta.dirname, "output");
const baseName = "ednovax-schools-support";
mkdirSync(outputDir, { recursive: true });

const chat = buildChat();

writeFileSync(join(outputDir, `${baseName}.android.txt`), formatExport(chat, "android"));
writeFileSync(join(outputDir, `${baseName}.ios.txt`), formatExport(chat, "ios"));

const labels = chat.map((event, index) => ({
  index,
  sender: event.sender,
  text: event.text,
  hasMedia: Boolean(event.hasMedia),
  ...event.label,
}));
writeFileSync(join(outputDir, `${baseName}.labels.json`), JSON.stringify(labels, null, 2) + "\n");

const roster = { group: GROUP_NAME, schools: SCHOOLS, people: CAST };
writeFileSync(join(outputDir, "roster.json"), JSON.stringify(roster, null, 2) + "\n");

const relevant = labels.filter((l) => l.relevant);
const byScenario = Object.groupBy(relevant, (l) => l.scenario ?? "?");
console.log(`Wrote ${chat.length} messages to ${outputDir}`);
console.log(`  noise:    ${chat.length - relevant.length} (${Math.round((100 * (chat.length - relevant.length)) / chat.length)}%)`);
console.log(`  relevant: ${relevant.length}`);
for (const [scenario, items] of Object.entries(byScenario)) {
  console.log(`    ${scenario}: ${items?.length}`);
}
