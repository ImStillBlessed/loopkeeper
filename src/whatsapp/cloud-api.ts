import { createHmac, timingSafeEqual } from "node:crypto";
import { setting } from "../settings.js";

/**
 * Meta's WhatsApp Cloud API, for the Ednovax support number. Groups are created by the support number
 * (Groups API: invite-only, small groups), messages arrive by webhook, replies go out through /messages.
 *
 * Every Meta-specific request and payload shape is in this file. The group fields follow Meta's Groups
 * API as published by integrators at the time of writing; check them against Meta's reference
 * (developers.facebook.com → WhatsApp Business Platform → Groups API) when the number is approved.
 */

const GRAPH_API = "https://graph.facebook.com/v23.0";

export function cloudApiConfigured(): boolean {
  return Boolean(setting("whatsappAccessToken") && setting("whatsappPhoneNumberId"));
}

async function graphApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!cloudApiConfigured()) throw new Error("WhatsApp isn't connected yet. Add the access token and phone number ID in Settings → Connections.");
  const response = await fetch(`${GRAPH_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${setting("whatsappAccessToken")}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw Object.assign(new Error(`WhatsApp: ${body.error?.message ?? `request failed (${response.status})`}`), { status: response.status });
  return body;
}

/** Sends a text message into a group, from the support number. */
export async function sendGroupText(groupId: string, text: string): Promise<void> {
  await graphApi(`/${setting("whatsappPhoneNumberId")}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", recipient_type: "group", to: groupId, type: "text", text: { body: text } },
  });
}

/** Creates a group owned by the support number. People join through the invite link (groups are invite-only). */
export async function createGroup(subject: string, description: string): Promise<{ groupId: string; inviteLink: string | null }> {
  const created = await graphApi<{ id: string }>(`/${setting("whatsappPhoneNumberId")}/groups`, {
    method: "POST",
    body: { messaging_product: "whatsapp", subject, description },
  });
  const invite = await graphApi<{ invite_link?: string }>(`/${created.id}/invite_link`).catch(() => ({}) as { invite_link?: string });
  return { groupId: created.id, inviteLink: invite.invite_link ?? null };
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

/** Meta signs each delivery with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export function validWebhookSignature(raw: string, header: string | undefined): boolean {
  const secret = setting("whatsappAppSecret");
  if (!secret) return true; // Not set up yet: accept (useful while testing with ngrok).
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** One incoming message, in the shape the rest of Loopkeeper needs. */
export interface IncomingWhatsApp {
  /** The group it was sent in; null for a one-to-one chat with the support number. */
  groupId: string | null;
  /** The sender's WhatsApp profile name, or their number when there is none. */
  senderLabel: string;
  text: string;
  ts: number;
  hasMedia: boolean;
  forwarded: boolean;
}

interface WebhookMessage {
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
  context?: { forwarded?: boolean; frequently_forwarded?: boolean };
  group_id?: string;
  group?: { id?: string };
}

interface WebhookBody {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: WebhookMessage[];
        group_id?: string;
      };
    }>;
  }>;
}

/** The messages in a webhook delivery. Status updates and other events are skipped. */
export function parseWebhook(body: WebhookBody): IncomingWhatsApp[] {
  const out: IncomingWhatsApp[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const message of value.messages) {
        const text = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? message.document?.filename ?? "";
        const hasMedia = ["image", "document", "video", "audio", "sticker"].includes(message.type);
        if (!text && !hasMedia) continue;
        out.push({
          groupId: message.group_id ?? message.group?.id ?? value.group_id ?? null,
          senderLabel: names.get(message.from) || `+${message.from}`,
          text,
          ts: Number(message.timestamp) * 1000,
          hasMedia,
          forwarded: Boolean(message.context?.forwarded || message.context?.frequently_forwarded),
        });
      }
    }
  }
  return out;
}
