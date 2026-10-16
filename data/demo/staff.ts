/**
 * The Ednovax team who sign in to the support desk. These accounts are always driven by people:
 * only the schools' teachers are simulated.
 */

export type StaffRole = "admin" | "lead" | "agent" | "developer";

export interface StaffSeed {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** Their job, shown next to their name. */
  title: string;
}

/** Shown on the login screen so judges can sign in. */
export const DEMO_PASSWORD = "ednovax-demo";

export const STAFF: StaffSeed[] = [
  { id: "stf_support", name: "Ednovax Support", email: "support@ednovax.com", role: "admin", title: "Support desk" },
  { id: "stf_blessed", name: "Blessed Oigbochie", email: "blessed@ednovax.com", role: "lead", title: "Tech lead" },
  { id: "stf_maro", name: "Maro Orode", email: "maro@ednovax.com", role: "admin", title: "CTO" },
];

/** SLA per plan: how fast the first reply and the fix must come. */
export const SLA_POLICIES = [
  { plan: "premium", firstResponseMins: 60, resolveMins: 24 * 60 },
  { plan: "standard", firstResponseMins: 4 * 60, resolveMins: 72 * 60 },
];
