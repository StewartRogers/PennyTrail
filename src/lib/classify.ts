// Transaction classification: determining TxnType (purchase/payment/credit/
// cashback/fee) from keyword heuristics, and vendor resolution (which
// Parent/Child vendor a transaction belongs to, and therefore its
// category) via resolveVendor below. These are independent — a
// transaction's type no longer implies or locks a category; see
// ParentVendor/ChildVendor in types.ts.

import type { ChildVendor, ParentVendor, TxnType } from "./types";

export function cleanVendorName(raw: string | null | undefined): string {
  let s = String(raw || "");
  s = s.replace(/^\s*(SQ|TST|POS|PP|IN|SP|PY)\s*\*\s*/i, "");
  // Digits wrapped in parentheses — e.g. "Top Ten Produce (2001) Ltd", a
  // numbered-company designation common in Canadian business names — are
  // almost never a per-transaction reference code (those aren't
  // parenthesized in real bank exports), so they're excluded from the
  // digit-run strip below rather than being mistaken for noise.
  s = s.replace(/(?<!\()\d{3,}(?!\))/g, "");
  // Stripping digits in place can leave a hyphen with nothing useful still
  // attached to it — a phone number like "877-946-3184" becomes "--" once
  // its digit groups are gone. Collapse any hyphen run that isn't actually
  // joining two real words (legitimate hyphenated names like "T-Mobile" or
  // "7-Eleven" are untouched, since those hyphens sit between word characters).
  s = s.replace(/(?<![A-Za-z0-9])-+|-+(?![A-Za-z0-9])/g, " ");
  s = s.replace(/[*#]/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (!s) return String(raw || "").trim();
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

// Splits a cleaned vendor name into meaningful "core" tokens for fuzzy
// matching (see resolveVendor below):
// - A bare number ("10", "04") is noise on its own (store #, order #) —
//   dropped.
// - A word with exactly one attached digit run ("IMPARK00011770H") keeps
//   just the word.
// - A word with two or more separate digit groups ("P3ECC5FC58") is a
//   scrambled per-transaction reference code, not a real word with a
//   number attached, and carries no vendor-identity signal — dropped whole.
// - A parenthesized number ("(2001)") is a business's own registration
//   number, not noise, and is kept as-is.
export function coreTokens(name: string): string[] {
  const tokens = String(name || "")
    .toUpperCase()
    .replace(/[*#]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  return tokens
    .filter((token) => {
      if (/^\(\d+\)$/.test(token)) return true;
      if (/^\d+$/.test(token)) return false;
      const digitGroups = token.match(/\d+/g) || [];
      if (digitGroups.length >= 2) return false;
      return true;
    })
    .map((token) => (/^\(\d+\)$/.test(token) ? token : token.replace(/\d+/g, "")))
    .filter(Boolean);
}

export type VendorMatch =
  | { kind: "exact"; childVendorId: string }
  | { kind: "fuzzy"; parentId: string }
  | { kind: "none" };

// Decides which vendor a cleaned name belongs to. This never mutates
// anything: a "fuzzy" result means the caller should create a new
// ChildVendor linked to the given parent; a "none" result means a brand
// new Parent+Child should be created once the user has categorized it.
// Once a ChildVendor exists (whichever way it got created), its parentId
// is authoritative from then on — this function only ever decides where a
// *new* child lands, never re-evaluates an existing one, so a user
// correction is never silently undone by a later import.
export function resolveVendor(cleanedName: string, childVendors: ChildVendor[], parentVendors: ParentVendor[]): VendorMatch {
  const lower = cleanedName.trim().toLowerCase();
  if (!lower) return { kind: "none" };

  const exact = childVendors.find((c) => c.rawName.trim().toLowerCase() === lower);
  if (exact) return { kind: "exact", childVendorId: exact.id };

  const newCore = new Set(coreTokens(cleanedName));
  if (newCore.size === 0) return { kind: "none" };

  // Confidence = containment: the smaller token set (new candidate vs. the
  // parent's own name) must be *fully* contained in the larger one. This
  // deliberately compares against the parent's name alone, not the union of
  // every child it already has — accumulating children's tokens would mean
  // a parent with both a "Toronto" and an "Oakville" child could no longer
  // match a third city, since neither city name contains the other.
  for (const parent of parentVendors) {
    const known = new Set(coreTokens(parent.name));
    if (known.size === 0) continue;
    const [smaller, larger] = newCore.size <= known.size ? [newCore, known] : [known, newCore];
    const contained = [...smaller].every((t) => larger.has(t));
    if (contained) return { kind: "fuzzy", parentId: parent.id };
  }

  return { kind: "none" };
}

// Determines a transaction's type from keyword heuristics alone — this no
// longer implies a category (see ParentVendor/ChildVendor for that).
export function classifyTransactionType(
  description: string,
  isCharge: boolean,
  typeHint?: string | null,
  vendorHint?: string | null
): TxnType {
  const desc = String(description || "").toUpperCase();
  const vendorHintUpper = String(vendorHint || "").toUpperCase();
  // Some banks put the only meaningful text for non-purchase lines (interest,
  // payments) in a separately-mapped Vendor/Merchant-name column, leaving
  // Description blank — e.g. description "" but vendor "PURCHASE INTEREST".
  const combined = desc + " " + String(typeHint || "").toUpperCase() + " " + vendorHintUpper;

  // Broad on purpose: real bank exports abbreviate inconsistently (PMT,
  // PYMT, AUTO PAY vs AUTOPAY), so these lean on recall over precision —
  // the interest exclusion below still takes priority when both appear.
  if (!isCharge && /PAYMENT|PYMT|\bPMT\b|AUTO ?PAY|THANK YOU/.test(combined) && !/INTEREST/.test(combined)) {
    return "payment";
  }
  if (/CASH ?BACK|REWARDS? REDEEM|POINTS REDEEM/.test(combined)) return "cashback";
  // The refund exclusion matters here: a credit-side "Annual Fee Reversal"
  // or "Annual Fee Refund" line is a credit, not a fee.
  if (
    /\bANNUAL FEE\b|\bMEMBERSHIP FEE\b|\bCARD FEE\b/.test(combined) &&
    !(!isCharge && /REFUND|RETURN|REVERSAL|CREDIT ADJ/.test(combined))
  ) {
    return "fee";
  }
  if (/INTEREST|FINANCE CHARGE|FINANCE CHG|INT CHRG|INT CHG/.test(combined)) return "fee";
  if (!isCharge && /REFUND|RETURN|CREDIT ADJ/.test(combined)) return "credit";
  if (!isCharge) return "payment";
  return "purchase";
}
