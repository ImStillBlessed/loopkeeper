import type { Graph } from "falkordb";
import { DEMO_VISITOR, SLA_POLICIES, STAFF } from "../../data/demo/staff.js";
import type { ClientSeed } from "../../data/synthetic/cast.js";
import { CODE_FILES, DEMO_REPOS, FEATURES, PRODUCTS } from "../../data/synthetic/product.js";
import { hashPassword } from "../auth.js";
import { config } from "../config.js";
import {
  H13_SLA_SEED,
  H15_CLIENT_UPSERT,
  H16_CLIENT_PRODUCTS,
  H17_CLIENT_AGENT,
  H1_PRODUCTS_SEED,
  H2_FEATURES_SEED,
  H3_CODE_SEED,
  H4_IMPORTS_SEED,
  H22_MARK_SEED_VERSION,
  H24_STAFF_ENSURE,
  HD1_SET_DEPLOYMENTS,
} from "../graph/hq-queries.js";
import { P1_CLIENT, P3_GROUP, run, S2_SCHOOLS, S3_PEOPLE, S4_WORKS_AT } from "../graph/queries.js";
import { getFalkorDB } from "../graph/client.js";
import { ensureSchema } from "../graph/schema.js";
import { personId } from "../ingest/ids.js";
import { copyProductReference } from "./replicate.js";

/** The demo client's WhatsApp group id. */
export const groupIdOf = (clientId: string) => `grp_${clientId}`;

/** Wipe a graph. Deleting one that doesn't exist yet is fine. */
export async function resetGraph(graph: Graph): Promise<void> {
  await graph.delete().catch(() => undefined);
}

/** Deletes every graph the app keeps (HQ, clients, the hub, Ask). Settings live elsewhere and stay. */
export async function resetAllGraphs(): Promise<void> {
  const db = await getFalkorDB();
  for (const name of await db.list()) if (name.startsWith("lk_")) await resetGraph(db.selectGraph(name));
}

/** Someone in a client's WhatsApp group when it is set up. */
export interface GroupMember {
  name: string;
  role: string;
  /** How WhatsApp shows them, if not by name (an unsaved number). */
  whatsappLabel?: string;
  /** Works at the client (a teacher), rather than at Ednovax. */
  atClient: boolean;
}

/**
 * HQ, the first time the app starts: Ednovax's products with their features and code,
 * the staff who log in, SLA policies, and the client registry.
 */
export async function seedHq(hq: Graph, salt: string, clients: ClientSeed[]): Promise<void> {
  await ensureSchema(hq);
  const ownerName = (staffId: string) => STAFF.find((s) => s.id === staffId)!.name;

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
        ownerId: personId(ownerName(f.owner), salt),
        ownerName: ownerName(f.owner),
      })),
    });
    await run(hq, H4_IMPORTS_SEED, { imports: files.flatMap((f) => (f.imports ?? []).map((to) => ({ from: id(f.path), to: id(to) }))) });
  }

  await ensureStaff(hq);
  await run(hq, H13_SLA_SEED, { policies: SLA_POLICIES });
  for (const client of clients) await registerClient(hq, client);
  await run(hq, H22_MARK_SEED_VERSION, { version: DEMO_DATA_VERSION });
}

/**
 * The staff accounts and the demo visitor. Run at every start, so an account added to the code
 * appears on a server that was seeded before; existing passwords are never changed.
 */
export async function ensureStaff(hq: Graph): Promise<void> {
  await run(hq, H24_STAFF_ENSURE, {
    staff: [
      ...STAFF.map((s) => ({ ...s, passwordHash: hashPassword(config.demo.password) })),
      { ...DEMO_VISITOR, passwordHash: hashPassword(config.demo.visitorPassword) },
    ],
  });
}

/**
 * Bumped whenever the demo's products, clients, staff or deployments change shape. On startup, a
 * database seeded with an older version starts again from scratch (only the settings are kept).
 */
export const DEMO_DATA_VERSION = 3;

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
export async function seedClientGraph(
  hq: Graph,
  graph: Graph,
  client: Pick<ClientSeed, "id" | "name" | "city" | "products"> & { group?: string },
  salt: string,
  members: GroupMember[] = [],
): Promise<void> {
  await ensureSchema(graph);
  const ts = Date.now();
  await run(graph, P1_CLIENT, { id: client.id, name: client.name, ts });
  await run(graph, S2_SCHOOLS, { schools: [{ id: client.id, name: client.name, city: client.city }] });

  if (client.group) {
    const groupId = groupIdOf(client.id);
    await run(graph, P3_GROUP, { id: groupId, name: client.group, source: "simulator", ts });
    const idOf = (m: GroupMember) => personId(m.whatsappLabel ?? m.name, salt);
    await run(graph, S3_PEOPLE, { groupId, people: members.map((m) => ({ id: idOf(m), name: m.name, role: m.role })) });
    await run(graph, S4_WORKS_AT, { links: members.filter((m) => m.atClient).map((m) => ({ personId: idOf(m), schoolId: client.id })) });
  }

  await copyProductReference(hq, graph, client.products);
}
