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

export function matchVendorRule(desc: string, vendorRules: VendorRule[]): VendorRule | null {
  const upper = desc.toUpperCase();
  let best: VendorRule | null = null;
  for (const rule of vendorRules) {
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
  vendorRules: VendorRule[]
): Classification {
  const desc = String(description || "").toUpperCase();
  if (!isCharge && /PAYMENT|AUTOPAY|THANK YOU/.test(desc) && !/INTEREST/.test(desc)) {
    return { type: "payment", category: "payment", vendor: "Card Payment", needsReview: false };
  }
  if (/CASH ?BACK|REWARDS? REDEEM|POINTS REDEEM/.test(desc)) {
    return { type: "cashback", category: "cashback", vendor: "Rewards Redemption", needsReview: false };
  }
  if (/INTEREST CHARGE|FINANCE CHARGE/.test(desc)) {
    return { type: "fee", category: "fees_interest", vendor: "Interest Charge", needsReview: false };
  }
  if (!isCharge && /REFUND|RETURN|CREDIT ADJ/.test(desc)) {
    const m = matchVendorRule(desc, vendorRules);
    return {
      type: "credit",
      category: "credit_refund",
      vendor: m ? m.vendor : cleanVendorName(description),
      needsReview: false,
    };
  }
  if (!isCharge) {
    const m = matchVendorRule(desc, vendorRules);
    if (m) return { type: "credit", category: "credit_refund", vendor: m.vendor, needsReview: false };
    return { type: "payment", category: "payment", vendor: "Payment / Credit", needsReview: false };
  }
  const m = matchVendorRule(desc, vendorRules);
  if (m) return { type: "purchase", category: m.category, vendor: m.vendor, needsReview: false };
  return { type: "purchase", category: null, vendor: cleanVendorName(description), needsReview: true };
}
