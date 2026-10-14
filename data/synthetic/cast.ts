/**
 * The fictional cast of the "Ednovax Schools Support" WhatsApp group.
 * Every school, person and phone number here is invented (555 numbers are reserved for fiction).
 */

export interface School {
  id: string;
  name: string;
  city: string;
}

export type Role = "teacher" | "admin" | "developer" | "support";

export interface CastMember {
  /** Short key used in the scenario scripts. */
  key: string;
  name: string;
  /** How WhatsApp shows them in the export: their saved name, or a number if not saved. */
  whatsappLabel: string;
  role: Role;
  schoolId?: string;
}

export const SCHOOLS: School[] = [
  { id: "sch_royal", name: "Royal Academy", city: "Benin City" },
  { id: "sch_bright", name: "Bright Future College", city: "Lagos" },
  { id: "sch_unity", name: "Unity Model School", city: "Abuja" },
];

const member = (key: string, name: string, role: Role, schoolId?: string, whatsappLabel = name): CastMember => ({
  key, name, role, schoolId, whatsappLabel,
});

export const CAST: CastMember[] = [
  // Royal Academy
  member("adaeze", "Mrs Adaeze Okafor", "teacher", "sch_royal"),
  member("efe", "Mrs Efe Omoregie", "teacher", "sch_royal"),
  member("osaro", "Mr Osaro Igbinedion", "admin", "sch_royal"),
  // Bright Future College
  member("chidi", "Mr Chidi Nwosu", "teacher", "sch_bright"),
  member("bisi", "Miss Bisi Lawal", "teacher", "sch_bright"),
  member("funke", "Mrs Funke Adeyemi", "admin", "sch_bright"),
  // Unity Model School (Mallam Ibrahim is not a saved contact, so the export shows his number)
  member("ibrahim", "Mallam Ibrahim Musa", "teacher", "sch_unity", "+234 803 555 0142"),
  member("grace", "Mrs Grace Danjuma", "admin", "sch_unity"),
  // Ednovax team
  member("tunde", "Tunde Bakare", "developer"),
  member("kemi", "Kemi Ojo", "developer"),
  member("ngozi", "Ngozi Eze", "support"),
];

export const TEACHERS = CAST.filter((m) => m.schoolId).map((m) => m.key);
export const EVERYONE = CAST.map((m) => m.key);

export function castMember(key: string): CastMember {
  const found = CAST.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown cast member "${key}"`);
  return found;
}
