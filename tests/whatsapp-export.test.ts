import { describe, expect, it } from "vitest";
import { parseWhatsAppExport, type ParseOptions } from "../src/ingest/whatsapp-export.js";

const options: ParseOptions = { groupId: "grp_test", salt: "test-salt" };
const parse = (content: string, overrides: Partial<ParseOptions> = {}) =>
  parseWhatsAppExport(content, { ...options, ...overrides });

describe("parseWhatsAppExport", () => {
  it("parses Android lines (24h clock, day-first dates)", () => {
    const { messages } = parse("21/09/2026, 08:05 - Mrs Adaeze Okafor: Good morning all");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      senderName: "Mrs Adaeze Okafor",
      ts: "2026-09-21T08:05:00+01:00",
      text: "Good morning all",
      hasMedia: false,
      groupId: "grp_test",
    });
  });

  it("parses Android lines with 2-digit years and am/pm", () => {
    const { messages } = parse(
      ["21/09/26, 8:05 am - Ngozi Eze: Morning", "21/09/26, 12:30 pm - Ngozi Eze: Afternoon"].join("\n"),
    );

    expect(messages.map((m) => m.ts)).toEqual(["2026-09-21T08:05:00+01:00", "2026-09-21T12:30:00+01:00"]);
  });

  it("parses iOS lines with seconds and invisible direction marks", () => {
    const { messages } = parse("‎[21/09/2026, 08:05:33] Kemi Ojo: ‎The fix is live");

    expect(messages[0]).toMatchObject({
      senderName: "Kemi Ojo",
      ts: "2026-09-21T08:05:33+01:00",
      text: "The fix is live",
    });
  });

  it("joins multi-line messages", () => {
    const { messages } = parse(
      ["21/09/2026, 09:00 - Ngozi Eze: Steps:", "1. Open Students", "2. Click Reset", "21/09/2026, 09:01 - Kemi Ojo: ok"].join("\n"),
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("Steps:\n1. Open Students\n2. Click Reset");
  });

  it("flags media and strips the placeholders", () => {
    const { messages, stats } = parse(
      [
        "21/09/2026, 09:00 - Mrs Funke Adeyemi: <Media omitted>",
        "[21/09/2026, 09:01:00] Mrs Funke Adeyemi: ‎image omitted",
        "21/09/2026, 09:02 - Mrs Funke Adeyemi: Here is the screenshot",
        "IMG-20260921-WA0003.jpg (file attached)",
      ].join("\n"),
    );

    expect(messages.map((m) => [m.text, m.hasMedia])).toEqual([
      ["", true],
      ["", true],
      ["Here is the screenshot", true],
    ]);
    expect(stats.withMedia).toBe(3);
  });

  it("skips system lines and deleted messages", () => {
    const { messages, stats } = parse(
      [
        "21/09/2026, 07:00 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
        "21/09/2026, 07:01 - Ngozi Eze added Mr Chidi Nwosu",
        '21/09/2026, 07:02 - Ngozi Eze changed the subject from "Support" to "Ednovax: Schools Support"',
        "21/09/2026, 07:03 - Mr Chidi Nwosu: This message was deleted",
        "21/09/2026, 07:04 - Mr Chidi Nwosu: Thank you ma <This message was edited>",
      ].join("\n"),
    );

    expect(messages.map((m) => m.text)).toEqual(["Thank you ma"]);
    expect(stats).toMatchObject({ systemLines: 3, deleted: 1, messages: 1 });
  });

  it("never keeps raw phone numbers", () => {
    const { messages } = parse("21/09/2026, 09:00 - +234 803 555 0142: Abeg the score no dey save");
    const serialised = JSON.stringify(messages);

    expect(messages[0].senderName).toBe("+234 ••• 0142");
    expect(serialised).not.toContain("803");
    expect(serialised).not.toContain("5550142");
  });

  it("gives the same person the same id however the number is formatted", () => {
    const a = parse("21/09/2026, 09:00 - +234 803 555 0142: one").messages[0];
    const b = parse("21/09/2026, 09:00 - +2348035550142: two").messages[0];

    expect(a.senderId).toBe(b.senderId);
  });

  it("produces stable ids, distinct even for identical repeated messages", () => {
    const content = ["21/09/2026, 09:00 - Ngozi Eze: 🙏🏾", "21/09/2026, 09:00 - Ngozi Eze: 🙏🏾"].join("\n");
    const first = parse(content).messages.map((m) => m.id);
    const second = parse(content).messages.map((m) => m.id);

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });

  it("supports month-first exports", () => {
    const { messages } = parse("09/21/2026, 08:05 - Ngozi Eze: hi", { dateOrder: "MDY" });

    expect(messages[0].ts).toBe("2026-09-21T08:05:00+01:00");
  });
});
