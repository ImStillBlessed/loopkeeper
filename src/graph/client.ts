import { FalkorDB, type Graph } from "falkordb";
import { config } from "../config.js";

let connection: Promise<FalkorDB> | undefined;

/** One shared connection per process. */
export function getFalkorDB(): Promise<FalkorDB> {
  connection ??= FalkorDB.connect({
    socket: { host: config.falkordb.host, port: config.falkordb.port },
    username: config.falkordb.username,
    password: config.falkordb.password,
  });
  return connection;
}

/**
 * Each tenant (client org) gets its own graph: lk_<tenant>.
 * FalkorDB keeps graphs fully separate, so one client's data can never leak into another's queries.
 */
export function tenantGraphName(tenant: string): string {
  if (!/^[a-z0-9_]+$/.test(tenant)) {
    throw new Error(`Invalid tenant slug "${tenant}": use lowercase letters, digits and underscores`);
  }
  return `lk_${tenant}`;
}

export async function getTenantGraph(tenant: string = config.tenant): Promise<Graph> {
  const db = await getFalkorDB();
  return db.selectGraph(tenantGraphName(tenant));
}

export async function closeFalkorDB(): Promise<void> {
  if (!connection) return;
  const db = await connection;
  connection = undefined;
  await db.close();
}
