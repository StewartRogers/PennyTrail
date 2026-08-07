import type { ChildVendor, ParentVendor, Transaction } from "./types";

// Category is never stored on a Transaction — it's always derived live
// through childVendorId -> ChildVendor.parentId -> ParentVendor.category,
// so there's no denormalized copy that can go stale or disagree with itself.
export function categoryIdForTransaction(
  txn: Pick<Transaction, "childVendorId">,
  childById: Map<string, ChildVendor>,
  parentById: Map<string, ParentVendor>
): string | null {
  if (!txn.childVendorId) return null;
  const child = childById.get(txn.childVendorId);
  if (!child) return null;
  return parentById.get(child.parentId)?.category ?? null;
}

// Spend actually kept after any reimbursement — this is what every total
// (dashboard KPIs, trend, breakdown, category totals) should sum, not the
// raw charge amount, so a partially-reimbursed purchase still counts for
// what wasn't recovered.
export function netAmountForTransaction(txn: Pick<Transaction, "amount" | "reimbursedAmount">): number {
  return txn.amount - (txn.reimbursedAmount || 0);
}

// Net spend for a transaction, signed by what the transaction actually does
// to that category's total. `amount` is always stored positive (the import
// route does Math.abs), so summing raw net amounts across types added refunds
// to spend instead of subtracting them: a $100 purchase and its $100 refund —
// which resolve to the same vendor, and therefore the same category — showed
// as $200 spent rather than $0.
//   purchase/fee   a cost against the category
//   credit/cashback a refund or reward that gives spend back
//   payment        a card payment, not category spend at all
export function categorySpendForTransaction(txn: Pick<Transaction, "amount" | "reimbursedAmount" | "type">): number {
  if (txn.type === "payment") return 0;
  const net = netAmountForTransaction(txn);
  return txn.type === "credit" || txn.type === "cashback" ? -net : net;
}

export function vendorNameForTransaction(txn: Pick<Transaction, "childVendorId">, childById: Map<string, ChildVendor>): string | null {
  if (!txn.childVendorId) return null;
  return childById.get(txn.childVendorId)?.rawName ?? null;
}

export function parentIdForTransaction(txn: Pick<Transaction, "childVendorId">, childById: Map<string, ChildVendor>): string | null {
  if (!txn.childVendorId) return null;
  return childById.get(txn.childVendorId)?.parentId ?? null;
}

// Parent names and vendor (child) names are each unique — case-insensitive,
// trimmed — so these are the single place that decides "does this name
// already exist" for every create/rename path to check against.
function normalizeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

export function findParentByName(parents: ParentVendor[], name: string, excludeId?: string): ParentVendor | undefined {
  const normalized = normalizeName(name);
  return parents.find((p) => p.id !== excludeId && normalizeName(p.name) === normalized);
}

export function findChildByRawName(children: ChildVendor[], rawName: string): ChildVendor | undefined {
  const normalized = normalizeName(rawName);
  return children.find((c) => normalizeName(c.rawName) === normalized);
}
