import { query } from "./queries.js";

/**
 * The central support hub's own graph (lk_hub). It holds the hub's messages and where each was
 * routed. It is separate from HQ on purpose: HQ never stores message text.
 */

export const HB1_SAVE = query("HB1", "Record a hub message and where it went", `
  CREATE (m:HubMessage {
    id: $id, ts: $ts, sender: $sender, text: $text, status: $status,
    clientIds: $clientIds, method: $method, reason: $reason
  })`);

export const HB2_ROUTE = query("HB2", "Route a waiting hub message to clients (by a person)", `
  MATCH (m:HubMessage {id: $id})
  SET m.status = 'routed', m.clientIds = $clientIds, m.method = $method, m.reason = $reason
  RETURN m.id AS id, m.ts AS ts, m.sender AS sender, m.text AS text`);

export const HB3_IGNORE = query("HB3", "Mark a hub message as not about any client", `
  MATCH (m:HubMessage {id: $id})
  SET m.status = 'ignored', m.reason = $reason`);

export const HB4_FEED = query("HB4", "The latest hub messages, oldest first", `
  MATCH (m:HubMessage)
  WITH m ORDER BY m.ts DESC LIMIT $limit
  RETURN m.id AS id, m.ts AS ts, m.sender AS sender, m.text AS text, m.status AS status,
         coalesce(m.clientIds, []) AS clientIds, coalesce(m.method, '') AS method, coalesce(m.reason, '') AS reason
  ORDER BY ts`);

export const HB5_LAST_ROUTED_BY = query("HB5", "The client a sender's previous hub message went to, if recent", `
  MATCH (m:HubMessage {sender: $sender, status: 'routed'})
  WHERE m.ts >= $since
  WITH m ORDER BY m.ts DESC LIMIT 1
  RETURN m.clientIds AS clientIds`);

export const HB6_RESET = query("HB6", "Forget the hub's messages", `
  MATCH (m:HubMessage)
  DETACH DELETE m`);

export const HB7_PENDING_COUNT = query("HB7", "How many hub messages wait for a person to route them", `
  MATCH (m:HubMessage {status: 'pending'})
  RETURN count(m) AS pending`);

/** In each client graph: is there a contact (not Ednovax staff) with this name or id? */
export const HB8_FIND_CONTACT = query("HB8", "A client contact by name or hashed id (used to route hub messages)", `
  MATCH (p:Person)
  WHERE NOT p.role IN ['developer', 'support']
    AND (p.id = $personId OR toLower(p.name) = toLower($name) OR toLower(p.name) ENDS WITH toLower(' ' + $name))
  RETURN count(p) AS matches`);
