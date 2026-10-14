import type { Graph } from "falkordb";
import { CAST, SCHOOLS } from "../../data/synthetic/cast.js";
import { GROUP_NAME } from "../../data/synthetic/generator.js";
import { CODE_FILES, DEMO_REPO, FEATURES, SCHOOL_FEATURES } from "../../data/synthetic/product.js";
import { personId } from "../ingest/ids.js";
import { run, S1_TENANT, S2_SCHOOLS, S3_PEOPLE, S4_WORKS_AT, S5_FEATURES, S6_CODE, S7_IMPORTS } from "./queries.js";
import { ensureSchema } from "./schema.js";

export const DEMO_GROUP_ID = "grp_ednovax_support";

/** Wipe the tenant graph. Used by "Reset demo". */
export async function resetGraph(graph: Graph): Promise<void> {
  await graph.delete().catch(() => {
    // Deleting a graph that doesn't exist yet is fine.
  });
}

/**
 * Loads the world that exists before any chat is read: the client org, its group, schools,
 * people (from the contact roster), product features and the code behind them.
 */
export async function seedWorld(graph: Graph, salt: string, tenant: string): Promise<void> {
  await ensureSchema(graph);

  const idOf = (castKey: string) => {
    const member = CAST.find((m) => m.key === castKey);
    if (!member) throw new Error(`Unknown cast member "${castKey}"`);
    return personId(member.whatsappLabel, salt);
  };

  await run(graph, S1_TENANT, {
    tenantId: tenant,
    tenantName: "Ednovax",
    groupId: DEMO_GROUP_ID,
    groupName: GROUP_NAME,
    source: "whatsapp_export",
  });
  await run(graph, S2_SCHOOLS, { schools: SCHOOLS });
  await run(graph, S3_PEOPLE, {
    groupId: DEMO_GROUP_ID,
    people: CAST.map((m) => ({ id: idOf(m.key), name: m.name, role: m.role })),
  });
  await run(graph, S4_WORKS_AT, {
    links: CAST.filter((m) => m.schoolId).map((m) => ({ personId: idOf(m.key), schoolId: m.schoolId })),
  });
  await run(graph, S5_FEATURES, {
    features: FEATURES.map((f) => ({
      ...f,
      schoolIds: Object.keys(SCHOOL_FEATURES).filter((schoolId) => SCHOOL_FEATURES[schoolId].includes(f.key)),
    })),
  });
  await run(graph, S6_CODE, {
    repo: DEMO_REPO,
    files: CODE_FILES.map((f) => ({ path: f.path, feature: f.feature, ownerId: idOf(f.owner) })),
  });
  await run(graph, S7_IMPORTS, {
    imports: CODE_FILES.flatMap((f) => (f.imports ?? []).map((to) => ({ from: f.path, to }))),
  });
}
