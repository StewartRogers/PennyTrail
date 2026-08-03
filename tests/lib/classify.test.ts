import { describe, expect, it } from "vitest";
import { cleanVendorName, coreTokens, resolveVendor, classifyTransactionType } from "@/lib/classify";
import type { ChildVendor, ParentVendor } from "@/lib/types";

describe("cleanVendorName", () => {
  it("strips POS/card-processor prefixes", () => {
    expect(cleanVendorName("SQ *COFFEE SHOP")).toBe("Coffee Shop");
  });

  it("strips long digit runs (reference numbers)", () => {
    // "." is treated as a word boundary by the title-casing step, same as
    // a space, so "ca" capitalizes too — a pre-existing quirk, not
    // something this suite is asserting is ideal, just documenting it.
    expect(cleanVendorName("AMAZON.CA 1234567890")).toBe("Amazon.Ca");
  });

  it("keeps a parenthesized numbered-company designation", () => {
    expect(cleanVendorName("Top Ten Produce (2001) Ltd")).toBe("Top Ten Produce (2001) Ltd");
  });

  it("collapses a phone number down to nothing but doesn't leave a stray hyphen", () => {
    expect(cleanVendorName("CALL 877-946-3184")).toBe("Call");
  });

  it("removes a multi-hyphen artifact left after stripping a digit run between two real words", () => {
    // The original single hyphen between "Some" and "Corp" is a legitimate
    // word-joiner and stays; only the double-hyphen artifact left where
    // the digit run used to be (between "Corp" and "Store") collapses.
    expect(cleanVendorName("SOME-CORP-98765-STORE")).toBe("Some-Corp Store");
  });

  it("keeps a legitimate single hyphen between two real words", () => {
    expect(cleanVendorName("T-MOBILE")).toBe("T-Mobile");
    expect(cleanVendorName("7-ELEVEN")).toBe("7-Eleven");
  });

  it("title-cases an all-caps name without capitalizing the letter after an apostrophe", () => {
    expect(cleanVendorName("MCDONALD'S")).toBe("Mcdonald's");
  });

  it("drops tokens with two or more separate digit groups (scrambled reference codes)", () => {
    expect(cleanVendorName("IMPARK P3ECC5FC58")).toBe("Impark");
  });

  it("returns an empty-safe string for null/undefined input", () => {
    expect(cleanVendorName(null)).toBe("");
    expect(cleanVendorName(undefined)).toBe("");
  });
});

describe("coreTokens", () => {
  it("drops bare numbers", () => {
    expect(coreTokens("STORE 04")).toEqual(["STORE"]);
  });

  it("keeps a word with one attached digit run, stripped of its digits", () => {
    expect(coreTokens("IMPARK00011770H")).toEqual(["IMPARKH"]);
  });

  it("drops a scrambled reference code with 2+ digit groups", () => {
    expect(coreTokens("P3ECC5FC58")).toEqual([]);
  });

  it("keeps a parenthesized number as-is", () => {
    expect(coreTokens("CORP (2001)")).toEqual(["CORP", "(2001)"]);
  });
});

describe("resolveVendor", () => {
  const parents: ParentVendor[] = [{ id: "p1", name: "Costco", category: "groceries" }];
  const children: ChildVendor[] = [{ id: "c1", parentId: "p1", rawName: "Costco Wholesale" }];

  it("returns an exact match on the child's raw name (case-insensitive)", () => {
    expect(resolveVendor("costco wholesale", children, parents)).toEqual({ kind: "exact", childVendorId: "c1" });
  });

  it("returns none for a completely unrelated name", () => {
    expect(resolveVendor("Totally Unrelated Vendor", children, parents)).toEqual({ kind: "none" });
  });

  it("returns none for an empty cleaned name", () => {
    expect(resolveVendor("", children, parents)).toEqual({ kind: "none" });
  });

  it("fuzzy-matches when the new name's tokens are a subset of an existing parent's tokens", () => {
    // "Costco Gas" only makes sense as a fuzzy match if the SMALLER token
    // set is contained in the larger — here {GAS} is not related to Costco
    // at all, so this should NOT match; this guards the containment
    // direction rather than a same-word coincidence.
    expect(resolveVendor("Random Gas Station", children, parents)).toEqual({ kind: "none" });
  });

  it("documents the known false-positive risk: a short parent name is contained by an unrelated longer name", () => {
    // This is the exact scenario flagged in review: a one-word parent like
    // "Shell" can fuzzy-match a completely unrelated vendor that happens to
    // share that single token. The fix (see transactions/import route) is
    // to still require review for a "fuzzy" result rather than changing
    // this matching rule — this test documents the containment behavior
    // as-is so a future change to it is a deliberate, visible decision.
    const shellParents: ParentVendor[] = [{ id: "p2", name: "Shell", category: "gas" }];
    expect(resolveVendor("Shell Vacations Club", [], shellParents)).toEqual({ kind: "fuzzy", parentId: "p2" });
  });
});

describe("classifyTransactionType", () => {
  it("classifies a payment", () => {
    expect(classifyTransactionType("PAYMENT THANK YOU", false)).toBe("payment");
  });

  it("does not classify an interest charge as a payment even with THANK YOU-adjacent wording", () => {
    expect(classifyTransactionType("INTEREST CHARGE ON PURCHASES", false)).toBe("fee");
  });

  it("classifies cashback", () => {
    expect(classifyTransactionType("CASHBACK REDEMPTION", false)).toBe("cashback");
  });

  it("classifies an annual fee as a fee", () => {
    expect(classifyTransactionType("ANNUAL FEE", true)).toBe("fee");
  });

  it("classifies an annual fee refund as a credit, not a fee", () => {
    expect(classifyTransactionType("ANNUAL FEE REFUND", false)).toBe("credit");
  });

  it("classifies a refund as a credit", () => {
    expect(classifyTransactionType("MERCHANDISE RETURN", false)).toBe("credit");
  });

  it("classifies a charge as a purchase by default", () => {
    expect(classifyTransactionType("COFFEE SHOP", true)).toBe("purchase");
  });

  it("classifies a non-charge with no other signal as a payment", () => {
    expect(classifyTransactionType("MISC CREDIT LINE ITEM", false)).toBe("payment");
  });

  it("uses the vendor-hint column when description is blank", () => {
    expect(classifyTransactionType("", false, undefined, "PURCHASE INTEREST")).toBe("fee");
  });
});
