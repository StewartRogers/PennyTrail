// Transaction classification heuristics, ported from the design handoff's
// cc-analyzer-data.js.

import type { TxnType, VendorRule } from "./types";

export function cleanVendorName(raw: string | null | undefined): string {
  let s = String(raw || "");
  s = s.replace(/^\s*(SQ|TST|POS|PP|IN|SP|PY)\s*\*\s*/i, "");
  s = s.replace(/\d{3,}/g, "");
  s = s.replace(/[*#]/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (!s) return String(raw || "").trim();
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

// Rule patterns come from a raw description with digit-runs stripped (so
// "STORAGE ABC 12312" and "STORAGE ABC 43412" both learn the pattern
// "STORAGE ABC"), collapsed to single spaces and trimmed.
export function buildVendorRulePattern(rawDescription: string): string {
  return String(rawDescription || "")
    .toUpperCase()
    .replace(/\d{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A pattern shorter than this is too generic to trust for substring
// matching — digit-stripping can otherwise leave a fragment (e.g. a bare
// "CO" or "#") that coincidentally matches unrelated descriptions.
export const MIN_PATTERN_LENGTH = 4;

export function matchVendorRule(desc: string, vendorRules: VendorRule[]): VendorRule | null {
  const upper = desc.toUpperCase();
  let best: VendorRule | null = null;
  for (const rule of vendorRules) {
    if (rule.pattern.length < MIN_PATTERN_LENGTH) continue;
    if (upper.includes(rule.pattern)) {
      if (!best || rule.pattern.length > best.pattern.length) best = rule;
    }
  }
  return best;
}

export interface Classification {
  type: TxnType;
  category: string | null;
  vendor: string;
  needsReview: boolean;
}

export function classifyTransaction(
  description: string,
  isCharge: boolean,
  vendorRules: VendorRule[],
  typeHint?: string | null,
  vendorHint?: string | null
): Classification {
  const desc = String(description || "").toUpperCase();
  const vendorHintUpper = String(vendorHint || "").toUpperCase();
  // Some banks put the only meaningful text for non-purchase lines (interest,
  // payments) in a separately-mapped Vendor/Merchant-name column, leaving
  // Description blank — e.g. description "" but vendor "PURCHASE INTEREST".
  // typeHint (a mapped Type column) and vendorHint both fold into the same
  // keyword checks as the description, but never into vendor-rule matching,
  // so an arbitrary bank type/vendor string can't corrupt learned patterns.
  const combined = desc + " " + String(typeHint || "").toUpperCase() + " " + vendorHintUpper;
  // matchVendorRule identifies WHO the transaction is with, so prefer the
  // explicit vendor text over the raw description when both are present.
  const matchSource = vendorHintUpper || desc;
  // Broad on purpose: real bank exports abbreviate inconsistently (PMT,
  // PYMT, AUTO PAY vs AUTOPAY), so these lean on recall over precision —
  // the interest exclusion below still takes priority when both appear.
  if (!isCharge && /PAYMENT|PYMT|\bPMT\b|AUTO ?PAY|THANK YOU/.test(combined) && !/INTEREST/.test(combined)) {
    return { type: "payment", category: "payment", vendor: "Card Payment", needsReview: false };
  }
  if (/CASH ?BACK|REWARDS? REDEEM|POINTS REDEEM/.test(combined)) {
    return { type: "cashback", category: "cashback", vendor: "Rewards Redemption", needsReview: false };
  }
  if (/INTEREST|FINANCE CHARGE|FINANCE CHG|INT CHRG|INT CHG/.test(combined)) {
    return { type: "fee", category: "fees_interest", vendor: "Interest Charge", needsReview: false };
  }
  if (!isCharge && /REFUND|RETURN|CREDIT ADJ/.test(combined)) {
    const m = matchVendorRule(matchSource, vendorRules);
    return {
      type: "credit",
      category: "credit_refund",
      vendor: m ? m.vendor : cleanVendorName(description),
      needsReview: false,
    };
  }
  if (!isCharge) {
    const m = matchVendorRule(matchSource, vendorRules);
    if (m) return { type: "credit", category: "credit_refund", vendor: m.vendor, needsReview: false };
    return { type: "payment", category: "payment", vendor: "Payment / Credit", needsReview: false };
  }
  const m = matchVendorRule(matchSource, vendorRules);
  if (m) return { type: "purchase", category: m.category, vendor: m.vendor, needsReview: false };
  return { type: "purchase", category: null, vendor: cleanVendorName(description), needsReview: true };
}
