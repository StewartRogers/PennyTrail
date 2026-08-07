import { describe, expect, it } from "vitest";
import { classifyTransactionType, cleanVendorName, resolveVendor } from "@/lib/classify";
import { categorySpendForTransaction } from "@/lib/vendors";
import { makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";

describe("cleanVendorName numbered-company handling", () => {
  // \d{3,} could backtrack to a substring of a parenthesized number that no
  // longer sat against the parens, so the guard silently failed past 4 digits.
  it.each(["ACME HOLDINGS (20015) LTD", "ACME HOLDINGS (123456) LTD", "ACME HOLDINGS (2001) LTD"])(
    "keeps the registration number in %s",
    (raw) => {
      const digits = raw.match(/\((\d+)\)/)![1];

      expect(cleanVendorName(raw)).toContain(`(${digits})`);
    }
  );

  it("still strips unparenthesized reference digit runs", () => {
    expect(cleanVendorName("AMAZON.CA 1234567890")).not.toMatch(/\d{3,}/);
  });
});

describe("resolveVendor picks the closest match, not the first", () => {
  const shell = makeParentVendor({ id: "p1", name: "Shell" });
  const shellGas = makeParentVendor({ id: "p2", name: "Shell Gas Station" });

  it("prefers the more specific parent for a longer name", () => {
    const match = resolveVendor("Shell Gas Station Toronto", [], [shell, shellGas]);

    expect(match).toEqual({ kind: "fuzzy", parentId: "p2" });
  });

  it("gives the same answer whichever order the parents were created in", () => {
    const forward = resolveVendor("Shell Gas Station Toronto", [], [shell, shellGas]);
    const reversed = resolveVendor("Shell Gas Station Toronto", [], [shellGas, shell]);

    expect(reversed).toEqual(forward);
  });

  it("prefers the exact-length parent for a short name", () => {
    const match = resolveVendor("Shell", [], [shellGas, shell]);

    expect(match).toEqual({ kind: "fuzzy", parentId: "p1" });
  });

  it("still returns an exact child match ahead of any fuzzy one", () => {
    const child = makeChildVendor({ id: "c1", parentId: "p1", rawName: "Shell Gas Station Toronto" });
    const match = resolveVendor("Shell Gas Station Toronto", [child], [shell, shellGas]);

    expect(match).toEqual({ kind: "exact", childVendorId: "c1" });
  });
});

describe("classifyTransactionType cashback guard", () => {
  it("does not treat cash back taken at the till as a reward", () => {
    expect(classifyTransactionType("SAFEWAY #123 CASH BACK 40.00", true)).toBe("purchase");
  });

  it("still recognizes a genuine cashback credit", () => {
    expect(classifyTransactionType("CASH BACK REWARD", false)).toBe("cashback");
    expect(classifyTransactionType("POINTS REDEEM", false)).toBe("cashback");
  });
});

describe("categorySpendForTransaction", () => {
  it("subtracts a refund instead of adding it", () => {
    const purchase = makeTransaction({ id: "t1", type: "purchase", amount: 100 });
    const refund = makeTransaction({ id: "t2", type: "credit", amount: 100 });

    expect(categorySpendForTransaction(purchase) + categorySpendForTransaction(refund)).toBe(0);
  });

  it("subtracts cashback and ignores card payments", () => {
    expect(categorySpendForTransaction(makeTransaction({ type: "cashback", amount: 25 }))).toBe(-25);
    expect(categorySpendForTransaction(makeTransaction({ type: "payment", amount: 500 }))).toBe(0);
  });

  it("counts fees as spend", () => {
    expect(categorySpendForTransaction(makeTransaction({ type: "fee", amount: 12 }))).toBe(12);
  });

  it("still nets out a reimbursement on a purchase", () => {
    expect(categorySpendForTransaction(makeTransaction({ type: "purchase", amount: 100, reimbursedAmount: 40 }))).toBe(60);
  });
});
