import { FalkorDB, type Graph } from "falkordb";
import { config } from "../config.js";

let connection: Promise<FalkorDB> | undefined;

/** One shared connection per process. */
export function getFalkorDB(): Promise<FalkorDB> {
  connection ??= FalkorDB.connect({
    socket: { host: config.falkordb.host, port: config.falkordb.port },
    username: config.falkordb.username,
    password: config.falkordb.password,
  }).then((db) => {
    // Without a listener, a dropped socket (e.g. the database restarting) would crash the process.
    // The client reconnects by itself; queries in flight fail and are reported where they ran.
    db.on("error", (error: Error) => console.warn(`FalkorDB connection: ${error.message}`));
    return db;
  });
  return connection;
}

const GRAPH_PREFIX = "lk_";

/**
 * Each project gets its own graph: lk_<project>.
 * FalkorDB keeps graphs fully separate, so one client's data can never leak into another's queries.
 */
export function projectGraphName(project: string): string {
  if (!/^[a-z0-9_]+$/.test(project)) {
    throw new Error(`Invalid project id "${project}": use lowercase letters, digits and underscores`);
  }
  return `${GRAPH_PREFIX}${project}`;
}

export async function getProjectGraph(project: string = config.defaultProject): Promise<Graph> {
  const db = await getFalkorDB();
  return db.selectGraph(projectGraphName(project));
}

/** Project ids that have a graph in FalkorDB (test graphs excluded). */
export async function listProjectIds(): Promise<string[]> {
  const db = await getFalkorDB();
  const graphs = await db.list();
  return graphs
    .filter((name) => name.startsWith(GRAPH_PREFIX) && !/^lk_(test|smoketest)/.test(name))
    .map((name) => name.slice(GRAPH_PREFIX.length));
}

export async function closeFalkorDB(): Promise<void> {
  if (!connection) return;
  const db = await connection;
  connection = undefined;
  await db.close();
}
