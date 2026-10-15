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

/**
 * Two kinds of graph:
 *   lk_hq            Ednovax itself: products, code, staff, the client registry, cross-client patterns
 *   lk_client_<id>   one per client: its WhatsApp groups, contacts, messages, tickets, promises
 * A client's graph never holds another client's data, so a query can't leak across clients.
 */
export const HQ_GRAPH = "lk_hq";
const CLIENT_PREFIX = "lk_client_";

export function clientGraphName(clientId: string): string {
  if (!/^[a-z0-9_]+$/.test(clientId)) {
    throw new Error(`Invalid client id "${clientId}": use lowercase letters, digits and underscores`);
  }
  return `${CLIENT_PREFIX}${clientId}`;
}

export async function getHqGraph(): Promise<Graph> {
  return (await getFalkorDB()).selectGraph(HQ_GRAPH);
}

export async function getClientGraph(clientId: string): Promise<Graph> {
  return (await getFalkorDB()).selectGraph(clientGraphName(clientId));
}

/** Client ids that have a graph in FalkorDB. */
export async function listClientGraphIds(): Promise<string[]> {
  const graphs = await (await getFalkorDB()).list();
  return graphs.filter((name) => name.startsWith(CLIENT_PREFIX)).map((name) => name.slice(CLIENT_PREFIX.length));
}

export async function graphExists(name: string): Promise<boolean> {
  return (await (await getFalkorDB()).list()).includes(name);
}

export async function closeFalkorDB(): Promise<void> {
  if (!connection) return;
  const db = await connection;
  connection = undefined;
  await db.close();
}
