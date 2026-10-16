import { describe, expect, it } from "vitest";
import { statusAfter } from "../src/pipeline/apply.js";

describe("status rules", () => {
  it("closes on a confident resolution, and asks a person when unsure", () => {
    expect(statusAfter("resolved", "open", 0.95)).toBe("resolved");
    expect(statusAfter("resolved", "open", 0.4)).toBe("possibly_resolved");
  });

  it("leaves a ticket the team closed alone when the school confirms the fix", () => {
    expect(statusAfter("resolved", "resolved", 0.4)).toBeUndefined();
    expect(statusAfter("answered", "resolved", 0.95)).toBeUndefined();
  });

  it("reopens a closed ticket that still fails", () => {
    expect(statusAfter("reopened", "resolved", 0.9)).toBe("open");
  });
});
