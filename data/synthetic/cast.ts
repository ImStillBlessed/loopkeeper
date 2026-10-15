/**
 * The fictional Ednovax clients and the people in their WhatsApp groups.
 * Every client, person and phone number here is invented (555 numbers are reserved for fiction).
 */

export type ClientType = "school" | "lecture_centre";
export type Plan = "premium" | "standard";

/**
 * Where a client's product runs. Ednovax has three shapes:
 * - own_repo: the school has a repository of its own (older SMS v1 schools)
 * - branch: schools share one repository, each deployed from its own branch (newer SMS v1 schools)
 * - multi_tenant: one codebase and database serve many tenants (the Ednovax platform)
 */
export type Tenancy = "own_repo" | "branch" | "multi_tenant";

export interface Deployment {
  product: string;
  repo: string;
  /** The branch this client is deployed from (branch tenancy); null means the repo's default branch. */
  branch: string | null;
  tenancy: Tenancy;
}

/** A customer of Ednovax. Each one gets its own graph and its own WhatsApp support group. */
export interface ClientSeed {
  id: string;
  name: string;
  type: ClientType;
  city: string;
  plan: Plan;
  /** Derived from the deployments. */
  products: string[];
  deployments: Deployment[];
  /** Other names staff use for the client (nicknames, initials), so the support hub can tell who a message is about. */
  aliases: string[];
  /** Staff id of the support agent who looks after this client. */
  agent: string;
  /** The client's WhatsApp support group. */
  group: string;
}

export type Role = "teacher" | "admin" | "developer" | "support";

export interface CastMember {
  /** Short key used in the scenario scripts. */
  key: string;
  name: string;
  /** How WhatsApp shows them in the export: their saved name, or a number if not saved. */
  whatsappLabel: string;
  role: Role;
  /** The client they work at. Ednovax staff have none: they appear in every client's group. */
  clientId?: string;
}

/** The products a set of deployments covers. */
export const productsOf = (deployments: Deployment[]) => [...new Set(deployments.map((d) => d.product))];

const client = (seed: Omit<ClientSeed, "products">): ClientSeed => ({ ...seed, products: productsOf(seed.deployments) });

/** The four demo clients show the three ways Ednovax deploys. */
export const CLIENTS: ClientSeed[] = [
  client({
    id: "royal_academy", name: "Royal Academy", type: "school", city: "Benin City", plan: "premium", agent: "stf_ngozi", group: "Royal Academy × Ednovax",
    aliases: ["Royal", "RA", "Royal Benin"],
    deployments: [
      { product: "sms_v1", repo: "ednovax/sms-royal-academy", branch: null, tenancy: "own_repo" },
      { product: "ednovax", repo: "ednovax/ednovax", branch: null, tenancy: "multi_tenant" },
    ],
  }),
  client({
    id: "bright_future", name: "Bright Future College", type: "school", city: "Lagos", plan: "standard", agent: "stf_ngozi", group: "Bright Future × Ednovax",
    aliases: ["Bright Future", "BFC", "Bright"],
    deployments: [{ product: "sms_v1", repo: "ednovax/sms-v1", branch: "bright-future", tenancy: "branch" }],
  }),
  client({
    id: "unity_model", name: "Unity Model School", type: "school", city: "Abuja", plan: "standard", agent: "stf_ifeoma", group: "Unity Model × Ednovax",
    aliases: ["Unity", "UMS", "Unity Model"],
    deployments: [{ product: "sms_v1", repo: "ednovax/sms-v1", branch: "unity-model", tenancy: "branch" }],
  }),
  client({
    id: "apex_centre", name: "Apex Tutorial Centre", type: "lecture_centre", city: "Ibadan", plan: "premium", agent: "stf_ifeoma", group: "Apex Centre × Ednovax",
    aliases: ["Apex", "Apex Ibadan", "the lecture centre"],
    deployments: [{ product: "ednovax", repo: "ednovax/ednovax", branch: null, tenancy: "multi_tenant" }],
  }),
];

const member = (key: string, name: string, role: Role, clientId?: string, whatsappLabel = name): CastMember => ({
  key, name, role, clientId, whatsappLabel,
});

export const CAST: CastMember[] = [
  // Royal Academy
  member("adaeze", "Mrs Adaeze Okafor", "teacher", "royal_academy"),
  member("efe", "Mrs Efe Omoregie", "teacher", "royal_academy"),
  member("osaro", "Mr Osaro Igbinedion", "admin", "royal_academy"),
  // Bright Future College
  member("chidi", "Mr Chidi Nwosu", "teacher", "bright_future"),
  member("bisi", "Miss Bisi Lawal", "teacher", "bright_future"),
  member("funke", "Mrs Funke Adeyemi", "admin", "bright_future"),
  // Unity Model School (Mallam Ibrahim is not a saved contact, so the export shows his number)
  member("ibrahim", "Mallam Ibrahim Musa", "teacher", "unity_model", "+234 803 555 0142"),
  member("grace", "Mrs Grace Danjuma", "admin", "unity_model"),
  // Apex Tutorial Centre
  member("femi", "Mr Femi Adebayo", "admin", "apex_centre"),
  member("halima", "Mrs Halima Bello", "teacher", "apex_centre"),
  // Ednovax team (in every group)
  member("tunde", "Tunde Bakare", "developer"),
  member("kemi", "Kemi Ojo", "developer"),
  member("ngozi", "Ngozi Eze", "support"),
];

export const TEACHERS = CAST.filter((m) => m.clientId).map((m) => m.key);
export const EVERYONE = CAST.map((m) => m.key);

export function castMember(key: string): CastMember {
  const found = CAST.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown cast member "${key}"`);
  return found;
}

/** Everyone who appears in one client's group: its own people plus the Ednovax team. */
export function castOf(clientId: string): CastMember[] {
  return CAST.filter((m) => !m.clientId || m.clientId === clientId);
}
