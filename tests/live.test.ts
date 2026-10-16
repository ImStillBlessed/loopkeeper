import { describe, expect, it } from "vitest";
import { makeLiveMessage, toLagosIso } from "../src/ingest/live.js";
import { ChatClock } from "../src/runtime/clock.js";

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
