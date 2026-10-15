import { HW2_LINK_GROUP } from "../graph/hq-queries.js";
import { P3_GROUP, run } from "../graph/queries.js";
import type { World } from "../runtime/world.js";

/**
 * Links a WhatsApp group on the support number to a client: the client's graph gets a group for it,
 * and HQ remembers which client the WhatsApp group id belongs to (ids only, never messages).
 */
export async function linkWhatsAppGroup(world: World, clientId: string, waGroupId: string, name: string, inviteLink: string | null = null): Promise<string> {
  const groupId = `grp_${clientId}_wa`;
  await run(world.client(clientId).graph, P3_GROUP, { id: groupId, name, source: "wa_cloud", ts: world.clock.peek() });
  await run(world.hq, HW2_LINK_GROUP, { id: waGroupId, clientId, groupId, name, inviteLink, ts: world.clock.peek() });
  return groupId;
}
