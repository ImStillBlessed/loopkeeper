import { Hono } from "hono";
import { HW1_SEEN_GROUP, HW3_GROUP } from "../graph/hq-queries.js";
import { run } from "../graph/queries.js";
import { getWorld } from "../runtime/world.js";
import { setting } from "../settings.js";
import { parseWebhook, validWebhookSignature } from "../whatsapp/cloud-api.js";

/**
 * WhatsApp Cloud API webhook: in the Meta app, set the callback URL to /api/whatsapp/webhook, the verify
 * token to the one in Settings, and subscribe to messages (and the group fields).
 *
 * - the central support hub group → routed to the client each message is about
 * - a group linked to a client → that client's own pipeline
 * - any other group → remembered, so staff can link it in Settings
 */
export const whatsappWebhook = new Hono();

/** Meta checks the URL once: echo the challenge if the verify token matches. */
whatsappWebhook.get("/", (c) => {
  const ok = c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === setting("whatsappVerifyToken") && setting("whatsappVerifyToken");
  return ok ? c.text(c.req.query("hub.challenge") ?? "") : c.text("Verify token doesn't match", 403);
});

whatsappWebhook.post("/", async (c) => {
  const raw = await c.req.text();
  if (!validWebhookSignature(raw, c.req.header("x-hub-signature-256"))) return c.json({ error: "Bad signature" }, 401);
  const world = await getWorld();

  for (const message of parseWebhook(JSON.parse(raw))) {
    const text = message.hasMedia && !message.text ? "[photo]" : message.text;
    if (!message.groupId) continue; // One-to-one chats aren't part of the group workflow (yet).

    if (message.groupId === setting("whatsappHubGroupId")) {
      void world.supportHub.receive(message.senderLabel, message.forwarded ? `Forwarded: ${text}` : text, message.ts);
      continue;
    }
    const [linked] = await run<{ clientId: string | null; groupId: string | null }>(world.hq, HW3_GROUP, { id: message.groupId });
    if (linked?.clientId && linked.groupId) {
      await world.client(linked.clientId).receive(message.senderLabel, text, { groupId: linked.groupId, ts: message.ts, hasMedia: message.hasMedia });
    } else {
      await run(world.hq, HW1_SEEN_GROUP, { id: message.groupId, name: null, ts: message.ts });
    }
  }
  // Meta retries anything but a 200, so always acknowledge once the signature is good.
  return c.json({ ok: true });
});
