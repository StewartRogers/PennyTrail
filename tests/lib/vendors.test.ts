import { describe, expect, it } from "vitest";
import {
  categoryIdForTransaction,
  netAmountForTransaction,
  vendorNameForTransaction,
  parentIdForTransaction,
  findParentByName,
  findChildByRawName,
} from "@/lib/vendors";
import type { ChildVendor, ParentVendor } from "@/lib/types";

const parents: ParentVendor[] = [{ id: "p1", name: "Costco", category: "groceries" }];
const children: ChildVendor[] = [{ id: "c1", parentId: "p1", rawName: "Costco Wholesale" }];
const childById = new Map(children.map((c) => [c.id, c]));
const parentById = new Map(parents.map((p) => [p.id, p]));

describe("categoryIdForTransaction", () => {
  it("resolves through childVendorId -> parentId -> category", () => {
    expect(categoryIdForTransaction({ childVendorId: "c1" }, childById, parentById)).toBe("groceries");
  });

  it("returns null when there's no childVendorId", () => {
    expect(categoryIdForTransaction({ childVendorId: null }, childById, parentById)).toBeNull();
  });

  it("returns null when the childVendorId doesn't resolve to a known child", () => {
    expect(categoryIdForTransaction({ childVendorId: "missing" }, childById, parentById)).toBeNull();
  });
});

describe("netAmountForTransaction", () => {
  it("returns the full amount when nothing was reimbursed", () => {
    expect(netAmountForTransaction({ amount: 100 })).toBe(100);
  });

  it("subtracts a partial reimbursement", () => {
    expect(netAmountForTransaction({ amount: 100, reimbursedAmount: 40 })).toBe(60);
  });

  it("treats a full reimbursement as zero net spend", () => {
    expect(netAmountForTransaction({ amount: 100, reimbursedAmount: 100 })).toBe(0);
  });
});

describe("vendorNameForTransaction / parentIdForTransaction", () => {
  it("returns the child's raw name and parent id", () => {
    expect(vendorNameForTransaction({ childVendorId: "c1" }, childById)).toBe("Costco Wholesale");
    expect(parentIdForTransaction({ childVendorId: "c1" }, childById)).toBe("p1");
  });

  it("returns null for an unlinked transaction", () => {
    expect(vendorNameForTransaction({ childVendorId: null }, childById)).toBeNull();
    expect(parentIdForTransaction({ childVendorId: null }, childById)).toBeNull();
  });
});

describe("findParentByName / findChildByRawName", () => {
  it("matches case-insensitively and trims whitespace", () => {
    expect(findParentByName(parents, "  costco  ")).toEqual(parents[0]);
    expect(findChildByRawName(children, "COSTCO WHOLESALE")).toEqual(children[0]);
  });

  it("excludes a given id from the parent search (for rename-collision checks)", () => {
    expect(findParentByName(parents, "Costco", "p1")).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findParentByName(parents, "Walmart")).toBeUndefined();
    expect(findChildByRawName(children, "Walmart")).toBeUndefined();
  });

  it("matches Unicode-equivalent names composed differently (NFC vs NFD)", () => {
    // Build an accented name from a codepoint escape (é = precomposed
    // "e with acute") and derive its NFD form (base "e" + a separate
    // combining accent codepoint) at runtime via .normalize("NFD") — this
    // guarantees two genuinely different code sequences that render
    // identically, without depending on typing distinct raw bytes by hand.
    const nfcName = "Café Vendor";
    const nfdName = nfcName.normalize("NFD");
    expect(nfcName).not.toBe(nfdName); // sanity check they're really different strings
    expect(nfcName.length).not.toBe(nfdName.length);
    const nfcParents: ParentVendor[] = [{ id: "p2", name: nfcName, category: "dining" }];
    expect(findParentByName(nfcParents, nfdName)).toEqual(nfcParents[0]);
  });
});
