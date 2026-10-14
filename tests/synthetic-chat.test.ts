import { describe, expect, it } from "vitest";
import { buildChat, formatExport } from "../data/synthetic/generator.js";
import { parseWhatsAppExport } from "../src/ingest/whatsapp-export.js";

const chat = buildChat();
const parse = (format: "android" | "ios") =>
  parseWhatsAppExport(formatExport(chat, format), { groupId: "grp_support", salt: "test-salt" });

describe("synthetic chat", () => {
  it("is deterministic for a given seed", () => {
    expect(formatExport(buildChat(), "android")).toBe(formatExport(chat, "android"));
  });

  it("is mostly noise, like a real school group (brief: 55–65%)", () => {
    const noiseShare = chat.filter((e) => !e.label.relevant).length / chat.length;
    expect(noiseShare).toBeGreaterThanOrEqual(0.55);
    expect(noiseShare).toBeLessThanOrEqual(0.65);
  });

  it("contains every planted scenario", () => {
    const scenarios = new Set(chat.map((e) => e.label.scenario).filter(Boolean));
    expect([...scenarios].sort()).toEqual(["BG", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
  });

  it("S1 is reported by three different schools", () => {
    const reporters = new Set(chat.filter((e) => e.label.scenario === "S1" && e.label.type === "bug").map((e) => e.sender));
    expect(reporters).toEqual(new Set(["adaeze", "efe", "chidi", "ibrahim"]));
  });

  for (const format of ["android", "ios"] as const) {
    it(`round-trips through the ${format} parser message for message`, () => {
      const { messages, stats } = parse(format);

      expect(messages).toHaveLength(chat.length);
      expect(messages.map((m) => m.text)).toEqual(chat.map((e) => e.text));
      expect(messages.map((m) => m.hasMedia)).toEqual(chat.map((e) => Boolean(e.hasMedia)));
      expect(stats.systemLines).toBe(6);
    });
  }

  it("gives the same ids no matter which phone exported the chat", () => {
    // iOS includes seconds, so message ids differ; people must still match.
    const androidSenders = parse("android").messages.map((m) => m.senderId);
    const iosSenders = parse("ios").messages.map((m) => m.senderId);
    expect(iosSenders).toEqual(androidSenders);
  });

  it("masks the unsaved contact's phone number", () => {
    const names = new Set(parse("android").messages.map((m) => m.senderName));
    expect(names).toContain("+234 ••• 0142");
    expect([...names].join()).not.toContain("555");
  });
});
