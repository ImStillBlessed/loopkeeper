import { config } from "../config.js";
import { getProjectGraph, listProjectIds } from "../graph/client.js";
import { M1_MIGRATE_TENANT, M2_RENAME_PROJECT, M3_RENAME_GROUP, M4_REMOVE_GROUP, M5_REMOVE_REPO_FILES, M6_REMOVE_REPO, P2_PROJECT_SUMMARY, P3_GROUP, run } from "../graph/queries.js";
import { ensureSchema } from "../graph/schema.js";
import { createProjectGraph, seedWorld } from "../graph/seed.js";
import { stableId } from "../ingest/ids.js";
import { dropRuntime } from "./project.js";

export interface ProjectSummary {
  id: string;
  name: string;
  seen: number;
  groups: number;
  repos: number;
}

export type GroupSource = "simulator" | "whatsapp_export" | "wa_cloud";

/** Every project, read from FalkorDB: a project is simply a graph named lk_<id>. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const ids = await listProjectIds();
  const projects = await Promise.all(
    ids.map(async (id) => {
      const [summary] = await run<Omit<ProjectSummary, "id">>(await getProjectGraph(id), P2_PROJECT_SUMMARY).catch(() => []);
      return summary ? { ...summary, id } : undefined;
    }),
  );
  return projects.filter((p): p is ProjectSummary => Boolean(p)).sort((a, b) => a.name.localeCompare(b.name));
}

export function projectIdFrom(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (!id) throw new Error("Give the project a name with letters or digits");
  return id;
}

/** A new project, optionally with its first WhatsApp group so it is usable straight away. */
export async function createProject(name: string, firstGroup?: { name: string; source: GroupSource }): Promise<ProjectSummary> {
  const id = projectIdFrom(name);
  if ((await listProjectIds()).includes(id)) throw new Error(`A project called "${id}" already exists`);
  await createProjectGraph(await getProjectGraph(id), { id, name: name.trim() });
  if (firstGroup) await addGroup(id, firstGroup.name, firstGroup.source);
  return { id, name: name.trim(), seen: 0, groups: firstGroup ? 1 : 0, repos: 0 };
}

export async function renameProject(id: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error("A project needs a name");
  await run(await getProjectGraph(id), M2_RENAME_PROJECT, { name: name.trim() });
}

/** Deletes the project's whole graph. There is no undo. */
export async function deleteProject(id: string): Promise<void> {
  await dropRuntime(id);
  await (await getProjectGraph(id)).delete();
}

export async function addGroup(projectId: string, name: string, source: GroupSource): Promise<{ id: string }> {
  if (!name.trim()) throw new Error("Give the group a name");
  const id = stableId("grp", [projectId, name.trim().toLowerCase(), String(Date.now())]);
  await run(await getProjectGraph(projectId), P3_GROUP, { id, name: name.trim(), source, ts: Date.now() });
  return { id };
}

export async function renameGroup(projectId: string, groupId: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error("A group needs a name");
  await run(await getProjectGraph(projectId), M3_RENAME_GROUP, { id: groupId, name: name.trim() });
}

export async function removeGroup(projectId: string, groupId: string): Promise<void> {
  await run(await getProjectGraph(projectId), M4_REMOVE_GROUP, { id: groupId });
}

export async function removeRepo(projectId: string, repo: string): Promise<void> {
  const graph = await getProjectGraph(projectId);
  await run(graph, M5_REMOVE_REPO_FILES, { id: repo });
  await run(graph, M6_REMOVE_REPO, { id: repo });
}

/**
 * On start: bring older graphs up to date, and create the demo project (fictional Ednovax schools)
 * the very first time, so there is something to try.
 */
export async function prepareProjects(): Promise<void> {
  const ids = await listProjectIds();
  for (const id of ids) {
    const graph = await getProjectGraph(id);
    await ensureSchema(graph);
    await run(graph, M1_MIGRATE_TENANT).catch(() => undefined);
  }
  if (!ids.includes(config.defaultProject)) {
    await seedWorld(await getProjectGraph(config.defaultProject), config.idHashSalt, config.defaultProject);
  }
}
