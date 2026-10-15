import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Settings are read from memory; give the webhook an app secret without touching FalkorDB.
vi.mock("../src/settings.js", () => ({ setting: (field: string) => (field === "whatsappAppSecret" ? "app-secret" : "") }));
const { parseWebhook, validWebhookSignature } = await import("../src/whatsapp/cloud-api.js");

const delivery = {
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ wa_id: "2348035550142", profile: { name: "Mrs Grace Danjuma" } }],
            messages: [
              { from: "2348035550142", timestamp: "1792080000", type: "text", text: { body: "The report card PDF is cut off" }, group_id: "120363000000000001" },
              { from: "2348035550199", timestamp: "1792080060", type: "image", image: { caption: "See the screenshot" }, group_id: "120363000000000001" },
              { from: "2348035550199", timestamp: "1792080120", type: "text", text: { body: "Forwarded from a teacher" }, context: { forwarded: true }, group_id: "120363000000000002" },
            ],
          },
        },
        { field: "messages", value: { statuses: [{ id: "wamid.x", status: "read" }] } },
      ],
    },
  ],
};

describe("WhatsApp Cloud API webhook", () => {
  it("turns a delivery into messages with group, sender, time and media", () => {
    expect(parseWebhook(delivery as never)).toEqual([
      { groupId: "120363000000000001", senderLabel: "Mrs Grace Danjuma", text: "The report card PDF is cut off", ts: 1792080000000, hasMedia: false, forwarded: false },
      { groupId: "120363000000000001", senderLabel: "+2348035550199", text: "See the screenshot", ts: 1792080060000, hasMedia: true, forwarded: false },
      { groupId: "120363000000000002", senderLabel: "+2348035550199", text: "Forwarded from a teacher", ts: 1792080120000, hasMedia: false, forwarded: true },
    ]);
  });

  it("accepts only deliveries signed with the app secret", () => {
    const raw = JSON.stringify(delivery);
    const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(validWebhookSignature(raw, signature)).toBe(true);
    expect(validWebhookSignature(raw, "sha256=0000")).toBe(false);
    expect(validWebhookSignature(`${raw} `, signature)).toBe(false);
  });
});
