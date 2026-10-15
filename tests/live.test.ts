import { describe, expect, it } from "vitest";
import { makeLiveMessage, toLagosIso } from "../src/ingest/live.js";
import { ChatClock } from "../src/runtime/clock.js";
import { resolveSender, Simulator, type SendFn } from "../src/runtime/simulator.js";

describe("chat clock", () => {
  it("never repeats a timestamp and never goes backwards", () => {
    const clock = new ChatClock();
    const a = clock.now();
    const b = clock.now();
    expect(b).toBeGreaterThan(a);
    clock.setAtLeast(a - 60_000);
    expect(clock.now()).toBeGreaterThan(b);
  });

  it("can be fast-forwarded", () => {
    const clock = new ChatClock();
    const before = clock.peek();
    clock.advance(2 * 24 * 60 * 60 * 1000);
    expect(clock.peek() - before).toBeGreaterThanOrEqual(2 * 24 * 60 * 60 * 1000);
  });
});

describe("live messages", () => {
  it("are stamped in Lagos time", () => {
    expect(toLagosIso(Date.parse("2026-10-15T08:30:00Z"))).toBe("2026-10-15T09:30:00+01:00");
  });

  it("follow the same privacy rules as exports: hashed ids, masked numbers", () => {
    const message = makeLiveMessage({ groupId: "grp_1", senderLabel: "+234 803 555 0142", text: " Abeg check am ", ts: Date.now(), salt: "s" });
    expect(message.senderName).toBe("+234 ••• 0142");
    expect(message.text).toBe("Abeg check am");
    expect(JSON.stringify(message)).not.toContain("5550142");
  });
});

describe("simulator", () => {
  const collect = () => {
    const sent: Parameters<SendFn>[0][] = [];
    return { sent, send: ((m) => sent.push(m)) as SendFn };
  };

  it("resolves short names to the cast", () => {
    expect(resolveSender("chidi")).toBe("Mr Chidi Nwosu");
    expect(resolveSender("Funke")).toBe("Mrs Funke Adeyemi");
    expect(resolveSender("A new parent")).toBe("A new parent");
  });

  it("sends prepared messages from a fitting person", () => {
    const { sent, send } = collect();
    const simulator = new Simulator(new ChatClock(), send, () => undefined);
    simulator.prepared("grp_1", "promise");
    expect(sent).toHaveLength(1);
    // Promises come from the Ednovax team, who have no school.
    expect(["Tunde Bakare", "Kemi Ojo", "Ngozi Eze"]).toContain(sent[0].senderLabel);
  });

  it("speaks as cast members by their WhatsApp label", () => {
    const { sent, send } = collect();
    new Simulator(new ChatClock(), send, () => undefined).say("grp_1", "Mallam Ibrahim Musa", "E don work");
    expect(sent[0].senderLabel).toBe("+234 803 555 0142");
  });

  it("plays a storyline with the clock jumping over the days in between", async () => {
    const { sent, send } = collect();
    const clock = new ChatClock();
    await new Simulator(clock, send, () => undefined).playStory("grp_1", "S6", 0);
    expect(sent.map((m) => m.text)).toEqual(["Login is very slow this morning 😩", "It's fine now. Ignore 🙏🏾"]);
    // 07:52 → 08:13 in the story is 21 minutes in the chat.
    expect(Math.round((sent[1].ts - sent[0].ts) / 60_000)).toBe(21);
  });
});
