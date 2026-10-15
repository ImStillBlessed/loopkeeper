import type { Graph } from "falkordb";
import { castOf, CAST, CLIENTS, type ClientSeed } from "../../data/synthetic/cast.js";
import { CODE_FILES, DEMO_REPOS, FEATURES, PRODUCTS } from "../../data/synthetic/product.js";
import { DEMO_PASSWORD, SLA_POLICIES, STAFF } from "../../data/synthetic/staff.js";
import { hashPassword } from "../auth.js";
import {
  H10_STAFF_SEED,
  H13_SLA_SEED,
  H15_CLIENT_UPSERT,
  H16_CLIENT_PRODUCTS,
  H17_CLIENT_AGENT,
  H1_PRODUCTS_SEED,
  H2_FEATURES_SEED,
  H3_CODE_SEED,
  H4_IMPORTS_SEED,
  H22_MARK_SEED_VERSION,
  HD1_SET_DEPLOYMENTS,
} from "../graph/hq-queries.js";
import { P1_CLIENT, P3_GROUP, run, S2_SCHOOLS, S3_PEOPLE, S4_WORKS_AT } from "../graph/queries.js";
import { ensureSchema } from "../graph/schema.js";
import { personId } from "../ingest/ids.js";
import { copyProductReference } from "./replicate.js";

/** The demo client's WhatsApp group id. */
export const groupIdOf = (clientId: string) => `grp_${clientId}`;

/** Wipe a graph. Deleting one that doesn't exist yet is fine. */
export async function resetGraph(graph: Graph): Promise<void> {
  await graph.delete().catch(() => undefined);
}

/**
 * HQ, the first time the app starts: Ednovax's products with their features and code,
 * the staff who log in, SLA policies, and the client registry.
 */
export async function seedHq(hq: Graph, salt: string): Promise<void> {
  await ensureSchema(hq);
  const castPersonId = (castKey: string) => personId(CAST.find((m) => m.key === castKey)!.whatsappLabel, salt);

  await run(hq, H1_PRODUCTS_SEED, { products: PRODUCTS });
  await run(hq, H2_FEATURES_SEED, { features: FEATURES });
  for (const [product, files] of Object.entries(CODE_FILES)) {
    const repo = DEMO_REPOS[product];
    const id = (path: string) => `${repo}:${path}`;
    await run(hq, H3_CODE_SEED, {
      files: files.map((f) => ({
        id: id(f.path),
        path: f.path,
        repo,
        feature: f.feature,
        ownerId: castPersonId(f.owner),
        ownerName: CAST.find((m) => m.key === f.owner)!.name,
      })),
    });
    await run(hq, H4_IMPORTS_SEED, { imports: files.flatMap((f) => (f.imports ?? []).map((to) => ({ from: id(f.path), to: id(to) }))) });
  }

  await run(hq, H10_STAFF_SEED, { staff: STAFF.map((s) => ({ ...s, passwordHash: hashPassword(DEMO_PASSWORD) })) });
  await run(hq, H13_SLA_SEED, { policies: SLA_POLICIES });
  for (const client of CLIENTS) await registerClient(hq, client);
  await run(hq, H22_MARK_SEED_VERSION, { version: DEMO_DATA_VERSION });
}

/**
 * Bumped whenever the demo's products, clients or deployments change shape. On startup, demo data
 * from an older version is rebuilt (HQ and the demo clients' graphs); real clients are not touched.
 */
export const DEMO_DATA_VERSION = 2;

/** Adds or updates a client in the HQ registry. */
export async function registerClient(hq: Graph, client: Omit<ClientSeed, "group" | "aliases" | "deployments"> & Partial<Pick<ClientSeed, "aliases" | "deployments">>): Promise<void> {
  await run(hq, H15_CLIENT_UPSERT, { id: client.id, name: client.name, type: client.type, plan: client.plan, city: client.city, aliases: client.aliases ?? null, ts: Date.now() });
  await run(hq, H16_CLIENT_PRODUCTS, { id: client.id, products: client.products });
  // Left out when only the basics are edited, so existing deployments stay.
  if (client.deployments) await run(hq, HD1_SET_DEPLOYMENTS, { id: client.id, deployments: client.deployments });
  if (client.agent) await run(hq, H17_CLIENT_AGENT, { id: client.id, agentId: client.agent });
}

/**
 * A client's own graph: the client, its school (or centre), its WhatsApp group with the people in it,
 * and a copy of the product reference for the products it uses.
 */
export async function seedClientGraph(hq: Graph, graph: Graph, client: Pick<ClientSeed, "id" | "name" | "city" | "products"> & { group?: string }, salt: string): Promise<void> {
  await ensureSchema(graph);
  const ts = Date.now();
  await run(graph, P1_CLIENT, { id: client.id, name: client.name, ts });
  await run(graph, S2_SCHOOLS, { schools: [{ id: client.id, name: client.name, city: client.city }] });

  if (client.group) {
    const groupId = groupIdOf(client.id);
    await run(graph, P3_GROUP, { id: groupId, name: client.group, source: "simulator", ts });
    const people = castOf(client.id);
    await run(graph, S3_PEOPLE, { groupId, people: people.map((m) => ({ id: personId(m.whatsappLabel, salt), name: m.name, role: m.role })) });
    await run(graph, S4_WORKS_AT, {
      links: people.filter((m) => m.clientId).map((m) => ({ personId: personId(m.whatsappLabel, salt), schoolId: client.id })),
    });
  }

  await copyProductReference(hq, graph, client.products);
}
