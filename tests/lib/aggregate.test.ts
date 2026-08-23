import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeMonthlyAverages } from "@/lib/aggregate";
import { makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";

// computeMonthlyAverages windows on a trailing count of *complete* months
// ending at "now" — freeze the clock so the window is assertable.
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeMonthlyAverages", () => {
  it("drops a transaction flagged excludeFromDashboard without hiding its vendor's other transactions", () => {
    const category = makeCategory({ id: "cat_1" });
    const parent = makeParentVendor({ id: "parent_1", category: "cat_1" });
    const child = makeChildVendor({ id: "child_1", parentId: "parent_1" });
    const transactions = [
      makeTransaction({ id: "t1", date: "2026-04-10", amount: 50, childVendorId: "child_1" }),
      // A one-off outlier from the same vendor, excluded individually.
      makeTransaction({ id: "t2", date: "2026-04-15", amount: 5000, childVendorId: "child_1", excludeFromDashboard: true }),
    ];

    const result = computeMonthlyAverages(transactions, [category], [parent], [child], 6);

    const vendor = result.categories[0].parents[0].vendors[0];
    expect(vendor.total).toBe(50);
    expect(vendor.avgPerMonth).toBeCloseTo(50 / 6);
  });

  it("includes a transaction with excludeFromDashboard left unset", () => {
    const category = makeCategory({ id: "cat_1" });
    const parent = makeParentVendor({ id: "parent_1", category: "cat_1" });
    const child = makeChildVendor({ id: "child_1", parentId: "parent_1" });
    const transactions = [makeTransaction({ id: "t1", date: "2026-04-10", amount: 50, childVendorId: "child_1" })];

    const result = computeMonthlyAverages(transactions, [category], [parent], [child], 6);

    expect(result.categories[0].parents[0].vendors[0].total).toBe(50);
  });
});
