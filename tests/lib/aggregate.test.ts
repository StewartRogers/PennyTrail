import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeMonthlyAverages, partialCoverageNote } from "@/lib/aggregate";
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
    // The card's history starts in April, so the window's April and May.
    expect(vendor.avgPerMonth).toBeCloseTo(50 / 2);
  });

  it("includes a transaction with excludeFromDashboard left unset", () => {
    const category = makeCategory({ id: "cat_1" });
    const parent = makeParentVendor({ id: "parent_1", category: "cat_1" });
    const child = makeChildVendor({ id: "child_1", parentId: "parent_1" });
    const transactions = [makeTransaction({ id: "t1", date: "2026-04-10", amount: 50, childVendorId: "child_1" })];

    const result = computeMonthlyAverages(transactions, [category], [parent], [child], 6);

    expect(result.categories[0].parents[0].vendors[0].total).toBe(50);
  });

  // Window for NOW (2026-06-15): 2025-12 .. 2026-05.
  function setup() {
    const category = makeCategory({ id: "cat_1", name: "Groceries" });
    const parent = makeParentVendor({ id: "parent_1", category: "cat_1" });
    const child = makeChildVendor({ id: "child_1", parentId: "parent_1" });
    return { categories: [category], parents: [parent], children: [child] };
  }

  it("divides a long-held card's spend by the whole window, $0 months included", () => {
    const { categories, parents, children } = setup();
    const transactions = [
      // History back to 2025, so the card covers all six months.
      makeTransaction({ id: "old", date: "2025-08-01", type: "payment", amount: 10, childVendorId: null }),
      makeTransaction({ id: "a", date: "2026-03-10", amount: 120, childVendorId: "child_1" }),
    ];

    const result = computeMonthlyAverages(transactions, categories, parents, children, 6);

    expect(result.categories[0].avgPerMonth).toBeCloseTo(120 / 6);
  });

  it("averages a recently imported card over only the months it covers", () => {
    const { categories, parents, children } = setup();
    const transactions = [
      makeTransaction({ id: "old", cardId: "card_old", date: "2025-08-01", type: "payment", amount: 10, childVendorId: null }),
      makeTransaction({ id: "a", cardId: "card_old", date: "2026-03-10", amount: 120, childVendorId: "child_1" }),
      // card_new's first transaction is 2026-04: it covers April and May.
      makeTransaction({ id: "b", cardId: "card_new", date: "2026-04-10", amount: 60, childVendorId: "child_1" }),
    ];

    const result = computeMonthlyAverages(transactions, categories, parents, children, 6);
    const cat = result.categories[0];

    // 120 / 6 + 60 / 2 = 50, consistent at every level.
    expect(cat.avgPerMonth).toBeCloseTo(50);
    expect(cat.parents[0].avgPerMonth).toBeCloseTo(50);
    expect(cat.parents[0].vendors[0].avgPerMonth).toBeCloseTo(50);
    expect(cat.total).toBe(180);
    expect(result.coverage.get("card_new")).toEqual({ firstMonth: "2026-04", months: 2 });
    expect(result.coverage.get("card_old")?.months).toBe(6);
  });

  it("nets merchant refunds out of the averages", () => {
    const { categories, parents, children } = setup();
    const transactions = [
      makeTransaction({ id: "old", date: "2025-08-01", type: "payment", amount: 10, childVendorId: null }),
      makeTransaction({ id: "p", date: "2026-03-10", amount: 120, childVendorId: "child_1" }),
      makeTransaction({ id: "r", date: "2026-03-12", type: "credit", amount: 30, childVendorId: "child_1" }),
    ];

    const result = computeMonthlyAverages(transactions, categories, parents, children, 6);

    expect(result.categories[0].total).toBe(90);
    expect(result.categories[0].avgPerMonth).toBeCloseTo(90 / 6);
  });
});

describe("partialCoverageNote", () => {
  it("names only the cards whose history starts partway through the window", () => {
    const coverage = new Map([
      ["card_old", { firstMonth: "2025-01", months: 6 }],
      ["card_new", { firstMonth: "2026-04", months: 2 }],
    ]);
    const cards = [
      { id: "card_old", name: "Visa" },
      { id: "card_new", name: "Amex" },
    ];

    expect(partialCoverageNote(coverage, 6, cards)).toBe("Amex from Apr 26");
    expect(partialCoverageNote(new Map([["card_old", { firstMonth: "2025-01", months: 6 }]]), 6, cards)).toBeNull();
  });
});
