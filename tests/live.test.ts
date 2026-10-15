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
  const ALL = ["royal_academy", "bright_future", "unity_model", "apex_centre"];
  const collect = () => {
    const sent: Parameters<SendFn>[0][] = [];
    return { sent, simulator: new Simulator(new ChatClock(), (m) => sent.push(m), () => undefined, () => ALL) };
  };

  it("resolves short names to the cast, preferring the client's own people", () => {
    expect(resolveSender("chidi")).toBe("Mr Chidi Nwosu");
    expect(resolveSender("Funke", "bright_future")).toBe("Mrs Funke Adeyemi");
    expect(resolveSender("A new parent")).toBe("A new parent");
  });

  it("sends prepared messages to the given client, from a fitting person", () => {
    const { sent, simulator } = collect();
    simulator.prepared("apex_centre", "issue");
    expect(sent[0].clientId).toBe("apex_centre");
    // Problems are reported by the client's own people.
    expect(["Mr Femi Adebayo", "Mrs Halima Bello"]).toContain(sent[0].senderLabel);

    simulator.prepared("apex_centre", "promise");
    expect(["Tunde Bakare", "Kemi Ojo", "Ngozi Eze"]).toContain(sent[1].senderLabel);
  });

  it("speaks as cast members by their WhatsApp label", () => {
    const { sent, simulator } = collect();
    simulator.say("unity_model", "Mallam Ibrahim Musa", "E don work");
    expect(sent[0]).toMatchObject({ clientId: "unity_model", senderLabel: "+234 803 555 0142" });
  });

  it("plays a storyline into each teacher's own client, with staff replying in the same group", async () => {
    const { sent, simulator } = collect();
    await simulator.playStory("S1", 0);
    const bySender = new Map(sent.map((m) => [m.senderLabel, m.clientId]));
    expect(bySender.get("Mrs Adaeze Okafor")).toBe("royal_academy");
    expect(bySender.get("Mr Chidi Nwosu")).toBe("bright_future");
    expect(bySender.get("+234 803 555 0142")).toBe("unity_model");
    // Tunde answers right after Mallam Ibrahim, so in Unity's group.
    expect(sent.find((m) => m.text.includes("timing out"))?.clientId).toBe("unity_model");
  });

  it("plays a storyline now, in order, without moving the clock ahead", async () => {
    const { sent, simulator } = collect();
    const before = Date.now();
    await simulator.playStory("S6", 0);
    expect(sent.map((m) => m.text)).toEqual(["Login is very slow this morning 😩", "It's fine now. Ignore 🙏🏾"]);
    expect(sent[1].ts).toBeGreaterThan(sent[0].ts);
    expect(sent[1].ts - before).toBeLessThan(60_000);
  });
});
