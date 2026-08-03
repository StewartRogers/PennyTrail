import { describe, expect, it } from "vitest";
import { sortCategoriesByName, defaultCategories, TYPE_META } from "@/lib/categories";

describe("sortCategoriesByName", () => {
  it("sorts alphabetically by name", () => {
    const input = [{ name: "Zebra" }, { name: "Apple" }, { name: "Mango" }];
    expect(sortCategoriesByName(input).map((c) => c.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("doesn't mutate the input array", () => {
    const input = [{ name: "B" }, { name: "A" }];
    sortCategoriesByName(input);
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });
});

describe("defaultCategories", () => {
  it("returns a non-empty set of categories with unique ids", () => {
    const cats = defaultCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
  });

  it("returns a fresh array each call (no shared mutable state)", () => {
    const first = defaultCategories();
    first.push({ id: "extra", name: "Extra", color: "oklch(0 0 0)" });
    expect(defaultCategories().some((c) => c.id === "extra")).toBe(false);
  });
});

describe("TYPE_META", () => {
  it("has an entry for every transaction type", () => {
    for (const type of ["purchase", "payment", "credit", "cashback", "fee"] as const) {
      expect(TYPE_META[type]).toBeDefined();
      expect(typeof TYPE_META[type].label).toBe("string");
      expect(typeof TYPE_META[type].color).toBe("string");
    }
  });
});
