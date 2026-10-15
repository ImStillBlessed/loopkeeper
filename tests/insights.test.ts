import { describe, expect, it } from "vitest";
import { analytics, slaFor, type Ticket } from "../src/hq/insights.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const premium = { plan: "premium", firstResponseMins: 60, resolveMins: 24 * 60 };
const t0 = Date.UTC(2026, 9, 15, 8);

describe("SLA", () => {
  it("waits on the first reply, then on the fix", () => {
    const waiting = slaFor({ createdAt: t0, firstResponseAt: 0, resolvedAt: 0, status: "open" }, premium, t0 + 20 * MINUTE);
    expect(waiting).toMatchObject({ state: "on_track", stage: "response", dueAt: t0 + HOUR });

    const replied = slaFor({ createdAt: t0, firstResponseAt: t0 + 30 * MINUTE, resolvedAt: 0, status: "in_progress" }, premium, t0 + 2 * HOUR);
    expect(replied).toMatchObject({ state: "on_track", stage: "resolution", dueAt: t0 + 24 * HOUR });
  });

  it("is due soon in the last quarter of the window, and breached after it", () => {
    expect(slaFor({ createdAt: t0, firstResponseAt: 0, resolvedAt: 0, status: "open" }, premium, t0 + 50 * MINUTE).state).toBe("due_soon");
    expect(slaFor({ createdAt: t0, firstResponseAt: 0, resolvedAt: 0, status: "open" }, premium, t0 + 61 * MINUTE).state).toBe("breached");
  });

  it("judges resolved tickets by when they were fixed", () => {
    expect(slaFor({ createdAt: t0, firstResponseAt: t0 + MINUTE, resolvedAt: t0 + 5 * HOUR, status: "resolved" }, premium, t0 + 99 * HOUR).state).toBe("met");
    expect(slaFor({ createdAt: t0, firstResponseAt: t0 + MINUTE, resolvedAt: t0 + 30 * HOUR, status: "resolved" }, premium, t0 + 99 * HOUR).state).toBe("missed");
  });

  it("only gives feature requests a first-reply target", () => {
    const request = slaFor({ createdAt: t0, firstResponseAt: t0 + 20 * MINUTE, resolvedAt: 0, status: "open", kind: "feature_request" }, premium, t0 + 30 * 24 * HOUR);
    expect(request).toMatchObject({ state: "met", stage: "response" });
  });
});

describe("analytics", () => {
  it("counts the last 30 days and takes medians", () => {
    const now = t0 + 24 * HOUR;
    const ticket = (overrides: Partial<Ticket>): Ticket => ({
      id: "iss", title: "", kind: "bug", status: "resolved", severity: "high", feature: "login", createdAt: t0, updatedAt: t0,
      firstResponseAt: t0 + 30 * MINUTE, resolvedAt: t0 + 4 * HOUR, messages: 1, merged: 0, owner: "", escalated: false, moods: [],
      clientId: "a", clientName: "A", plan: "premium", sla: { state: "met", stage: "resolution", dueAt: 0, firstResponseDue: 0, resolveDue: 0 },
      ...overrides,
    });
    const result = analytics(
      [ticket({}), ticket({ firstResponseAt: t0 + 90 * MINUTE, resolvedAt: t0 + 8 * HOUR }), ticket({ status: "open", firstResponseAt: 0, resolvedAt: 0, sla: { state: "breached", stage: "resolution", dueAt: 0, firstResponseDue: 0, resolveDue: 0 } })],
      now,
      new Map([["login", "Login"]]),
    );
    expect(result.totals).toEqual({ opened: 3, resolved: 2, open: 1 });
    expect(result.medianFirstResponseMins).toBe(60);
    expect(result.medianResolveHours).toBe(6);
    expect(result.slaCompliance).toBe(67);
    expect(result.byFeature).toEqual([{ label: "Login", value: 3 }]);
  });
});
