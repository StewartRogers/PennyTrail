import { describe, expect, it } from "vitest";
import { emptyState, normalizeState } from "@/lib/storeState";

describe("normalizeState", () => {
  it("maps the retired entry statuses onto Projected and Actual", () => {
    const stored = {
      ...emptyState(),
      cashFlowEntries: [{ id: "a", status: "planned" }, { id: "b", status: "scheduled", confirmationCode: "123" }, { id: "c", status: "posted" }, { id: "d", status: "skipped" }, { id: "e", status: "actual" }],
    };
    const state = normalizeState(stored, "test");
    expect(state.cashFlowEntries.map((e) => e.status)).toEqual(["projected", "projected", "actual", "skipped", "actual"]);
    expect(state.cashFlowEntries[1].confirmationCode).toBe("123");
  });

  it("fills in a missing collection", () => {
    expect(normalizeState({ cards: [] }, "test").cashFlowEntries).toEqual([]);
  });
});
