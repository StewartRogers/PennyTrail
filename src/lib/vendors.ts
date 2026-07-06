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
export function findParentByName(parents: ParentVendor[], name: string, excludeId?: string): ParentVendor | undefined {
  const lower = name.trim().toLowerCase();
  return parents.find((p) => p.id !== excludeId && p.name.trim().toLowerCase() === lower);
}

export function findChildByRawName(children: ChildVendor[], rawName: string): ChildVendor | undefined {
  const lower = rawName.trim().toLowerCase();
  return children.find((c) => c.rawName.trim().toLowerCase() === lower);
}
