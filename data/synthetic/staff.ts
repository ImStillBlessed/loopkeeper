/**
 * Demo Ednovax staff who can log in to the support desk. Fictional people, demo-only password.
 * Developers and support staff also appear in clients' WhatsApp groups (see cast.ts, by `castKey`).
 */

export type StaffRole = "admin" | "lead" | "agent" | "developer";

export interface StaffSeed {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** Their key in the WhatsApp cast, if they chat with clients. */
  castKey?: string;
}

/** Shown on the login screen so judges can try every role. */
export const DEMO_PASSWORD = "ednovax-demo";

export const STAFF: StaffSeed[] = [
  { id: "stf_admin", name: "Dayo Akande", email: "admin@ednovax.demo", role: "admin" },
  { id: "stf_lead", name: "Bola Ajayi", email: "lead@ednovax.demo", role: "lead" },
  { id: "stf_ngozi", name: "Ngozi Eze", email: "ngozi@ednovax.demo", role: "agent", castKey: "ngozi" },
  { id: "stf_ifeoma", name: "Ifeoma Obi", email: "ifeoma@ednovax.demo", role: "agent" },
  { id: "stf_tunde", name: "Tunde Bakare", email: "tunde@ednovax.demo", role: "developer", castKey: "tunde" },
  { id: "stf_kemi", name: "Kemi Ojo", email: "kemi@ednovax.demo", role: "developer", castKey: "kemi" },
];

/** SLA per plan: how fast the first reply and the fix must come. */
export const SLA_POLICIES = [
  { plan: "premium", firstResponseMins: 60, resolveMins: 24 * 60 },
  { plan: "standard", firstResponseMins: 4 * 60, resolveMins: 72 * 60 },
];
