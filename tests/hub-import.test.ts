import { describe, expect, it } from "vitest";
import { HubImport, type ImportProgress } from "../src/hub/import.js";
import type { SupportHub } from "../src/hub/support-hub.js";

/** A hub that routes by the first word, and already knows messages starting with "old". */
function fakeHub(delayMs = 0) {
  const seen: string[] = [];
  const hub = {
    async receive(_sender: string, text: string) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      seen.push(text);
      if (text.startsWith("old")) return "known";
      if (text.startsWith("hello")) return "ignored";
      if (text.startsWith("unclear")) return "pending";
      return "routed";
    },
  } as unknown as SupportHub;
  return { hub, seen };
}

const messages = (texts: string[]) => texts.map((text, i) => ({ sender: "Staff", text, ts: i }));
const finished = async (job: HubImport) => {
  while (job.running) await new Promise((resolve) => setTimeout(resolve, 5));
  return job.status()!;
};

describe("importing an exported hub chat", () => {
  it("routes every message in order and counts where they went, skipping ones imported before", async () => {
    const reports: ImportProgress[] = [];
    const { hub, seen } = fakeHub();
    const job = new HubImport(hub, (p) => reports.push(p));
    job.start(messages(["old one", "Royal: scores", "hello all", "unclear thing", "Apex: receipts"]));
    const done = await finished(job);
    expect(seen).toEqual(["old one", "Royal: scores", "hello all", "unclear thing", "Apex: receipts"]);
    expect(done).toMatchObject({ state: "done", total: 5, done: 5, skipped: 1, routed: 2, ignored: 1, pending: 1 });
    // Progress is reported when it starts and when it ends, not once per message.
    expect(reports.length).toBeLessThan(5);
    expect(reports.at(-1)?.state).toBe("done");
  });

  it("stops when asked, keeping what was done, and refuses a second import while one runs", async () => {
    const { hub } = fakeHub(20);
    const job = new HubImport(hub, () => undefined);
    job.start(messages(Array.from({ length: 50 }, (_, i) => `msg ${i}`)));
    expect(() => job.start(messages(["another"]))).toThrow(/already running/);
    await new Promise((resolve) => setTimeout(resolve, 70));
    job.stop();
    const done = await finished(job);
    expect(done.state).toBe("stopped");
    expect(done.done).toBeGreaterThan(0);
    expect(done.done).toBeLessThan(50);
  });
});
