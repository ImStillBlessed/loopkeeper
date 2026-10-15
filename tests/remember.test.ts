import { describe, expect, it, vi } from "vitest";
import { TOOLS_BY_NAME, type ToolContext } from "../src/agent/tools.js";

describe("the agent remembering what it's told", () => {
  const remember = TOOLS_BY_NAME.get("remember")!;
  const ctx = (store?: (text: string) => Promise<void>) => ({ now: Date.now(), repos: [], remember: store }) as unknown as ToolContext;

  it("stores the statement through the client's pipeline", async () => {
    const store = vi.fn(async () => undefined);
    const result = await remember.execute({ text: "Royal Academy's ICT contact is Mr Paul Ehis" }, ctx(store));
    expect(store).toHaveBeenCalledWith("Royal Academy's ICT contact is Mr Paul Ehis");
    expect(String(result.data)).toContain("Stored");
  });

  it("stores nothing when there is nothing to store, or nowhere to store it", async () => {
    const store = vi.fn(async () => undefined);
    await remember.execute({ text: "  " }, ctx(store));
    expect(store).not.toHaveBeenCalled();
    expect((await remember.execute({ text: "A fact" }, ctx())).data).toBe("Nothing stored");
  });
});
