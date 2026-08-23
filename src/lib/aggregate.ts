import type { Category, ChildVendor, ParentVendor, Transaction } from "./types";
import { monthKey } from "./format";
import { netAmountForTransaction } from "./vendors";

// Trailing N *complete* periods ending at the last fully-elapsed one — the
// current, still-in-progress month/quarter/year is deliberately excluded so
// it can't show up as a misleadingly short bar. Missing periods (no
// transactions at all) are zero-filled rather than silently skipped, so the
// chart is always a stable calendar window, not a function of which months
// happen to have data.
export function trailingPeriodKeys(group: "month" | "quarter" | "year", count: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  if (group === "month") {
    for (let i = count; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  } else if (group === "quarter") {
    const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    for (let i = count; i >= 1; i--) {
      const d = new Date(now.getFullYear(), currentQuarterStartMonth - i * 3, 1);
      keys.push(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
    }
  } else {
    for (let i = count; i >= 1; i--) {
      keys.push(String(now.getFullYear() - i));
    }
  }
  return keys;
}

export interface MonthlyAverageEntry {
  id: string;
  name: string;
  color: string;
  monthlyTotals: number[]; // aligned with MonthlyAverages.months, oldest -> newest
  avgPerMonth: number;
  total: number;
}

// A Parent (ParentVendor) — the stable vendor identity, e.g. "Netflix" —
// broken down by the raw-description Vendors (ChildVendor) matched to it,
// e.g. "NETFLIX.COM". Same Parent/Vendor language as the Vendor Mappings
// screen's "Parents" / "Vendors" tabs, so a category drills to a parent
// drills to a vendor consistently across the app.
export interface ParentAverage extends MonthlyAverageEntry {
  vendors: MonthlyAverageEntry[];
}

export interface CategoryAverage extends MonthlyAverageEntry {
  parents: ParentAverage[];
}

export interface MonthlyAverages {
  months: string[]; // oldest -> newest
  categories: CategoryAverage[];
}

// Average monthly spend by category, by parent vendor within each category,
// and by raw-description vendor within each parent, over a trailing window
// of complete months. Division is always by the fixed window size (not
// "months that had spend"), matching the Dashboard's avg/month convention —
// a vendor charged twice in a 6-month window averages to total/6, not
// total/2. Categories flagged excludeFromDashboard are dropped, same as
// every other Dashboard-style aggregate — as is any individual transaction
// flagged the same way (e.g. a one-off outlier that shouldn't skew this
// vendor's average without hiding every other charge from it). Only
// categories, parents, and vendors with nonzero spend in the window are
// returned.
export function computeMonthlyAverages(
  transactions: Transaction[],
  categories: Category[],
  parentVendors: ParentVendor[],
  childVendors: ChildVendor[],
  monthsCount = 6
): MonthlyAverages {
  const months = trailingPeriodKeys("month", monthsCount);
  const monthSet = new Set(months);
  const childById = new Map(childVendors.map((c) => [c.id, c]));
  const parentById = new Map(parentVendors.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const excludedCategoryIds = new Set(categories.filter((c) => c.excludeFromDashboard).map((c) => c.id));

  // Bucket by the leaf (ChildVendor) first — that's the finest grain the
  // data has — then roll up into parents and categories, so every level's
  // total is exactly the sum of the level below it.
  const childMonthly = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.type !== "purchase" || !t.childVendorId || t.excludeFromDashboard) continue;
    const key = monthKey(t.date);
    if (!monthSet.has(key)) continue;
    const child = childById.get(t.childVendorId);
    if (!child) continue;
    const parent = parentById.get(child.parentId);
    if (!parent || excludedCategoryIds.has(parent.category)) continue;
    let byMonth = childMonthly.get(t.childVendorId);
    if (!byMonth) {
      byMonth = new Map();
      childMonthly.set(t.childVendorId, byMonth);
    }
    byMonth.set(key, (byMonth.get(key) || 0) + netAmountForTransaction(t));
  }

  const parentChildren = new Map<string, MonthlyAverageEntry[]>();
  for (const [childId, byMonth] of childMonthly) {
    const child = childById.get(childId);
    if (!child) continue;
    const parent = parentById.get(child.parentId);
    if (!parent) continue;
    const monthlyTotals = months.map((m) => byMonth.get(m) || 0);
    const total = monthlyTotals.reduce((sum, v) => sum + v, 0);
    if (total <= 0) continue;
    const entry: MonthlyAverageEntry = {
      id: childId,
      name: child.rawName,
      color: categoryById.get(parent.category)?.color || "var(--muted)",
      monthlyTotals,
      avgPerMonth: total / monthsCount,
      total,
    };
    const list = parentChildren.get(parent.id) || [];
    list.push(entry);
    parentChildren.set(parent.id, list);
  }

  const categoryParents = new Map<string, ParentAverage[]>();
  for (const [parentId, vendors] of parentChildren) {
    const parent = parentById.get(parentId);
    if (!parent) continue;
    vendors.sort((a, b) => b.avgPerMonth - a.avgPerMonth);
    const monthlyTotals = months.map((_, i) => vendors.reduce((sum, v) => sum + v.monthlyTotals[i], 0));
    const total = monthlyTotals.reduce((sum, v) => sum + v, 0);
    const entry: ParentAverage = {
      id: parentId,
      name: parent.name,
      color: categoryById.get(parent.category)?.color || "var(--muted)",
      monthlyTotals,
      avgPerMonth: total / monthsCount,
      total,
      vendors,
    };
    const list = categoryParents.get(parent.category) || [];
    list.push(entry);
    categoryParents.set(parent.category, list);
  }

  const result: CategoryAverage[] = [];
  for (const [categoryId, parents] of categoryParents) {
    parents.sort((a, b) => b.avgPerMonth - a.avgPerMonth);
    const monthlyTotals = months.map((_, i) => parents.reduce((sum, p) => sum + p.monthlyTotals[i], 0));
    const total = monthlyTotals.reduce((sum, v) => sum + v, 0);
    const cat = categoryById.get(categoryId);
    result.push({
      id: categoryId,
      name: cat?.name || categoryId,
      color: cat?.color || "var(--muted)",
      monthlyTotals,
      avgPerMonth: total / monthsCount,
      total,
      parents,
    });
  }
  result.sort((a, b) => b.avgPerMonth - a.avgPerMonth);

  return { months, categories: result };
}
