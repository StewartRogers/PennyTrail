import type { Card, Category, ChildVendor, ParentVendor, Transaction } from "./types";
import { monthKey, monthLabel } from "./format";
import { bcYearMonth } from "./bcTime";
import { dashboardSpendForTransaction, isDashboardSpend } from "./vendors";

// Trailing N *complete* periods ending at the last fully-elapsed one — the
// current, still-in-progress month/quarter/year is deliberately excluded so
// it can't show up as a misleadingly short bar. Missing periods (no
// transactions at all) are zero-filled rather than silently skipped, so the
// chart is always a stable calendar window, not a function of which months
// happen to have data.
export function trailingPeriodKeys(group: "month" | "quarter" | "year", count: number): string[] {
  // The current period is BC's, not the device's (see bcTime.ts).
  const { year, month } = bcYearMonth();
  const monthIndex = month - 1;
  const keys: string[] = [];
  if (group === "month") {
    for (let i = count; i >= 1; i--) {
      const d = new Date(year, monthIndex - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  } else if (group === "quarter") {
    const currentQuarterStartMonth = Math.floor(monthIndex / 3) * 3;
    for (let i = count; i >= 1; i--) {
      const d = new Date(year, currentQuarterStartMonth - i * 3, 1);
      keys.push(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
    }
  } else {
    for (let i = count; i >= 1; i--) {
      keys.push(String(year - i));
    }
  }
  return keys;
}

// The current, still-in-progress month/quarter/year on BC's calendar — the
// one period trailingPeriodKeys leaves out.
export function currentPeriodKey(group: "month" | "quarter" | "year"): string {
  const { year, month } = bcYearMonth();
  if (group === "month") return `${year}-${String(month).padStart(2, "0")}`;
  if (group === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return String(year);
}

export interface CardCoverage {
  firstMonth: string;
  months: number; // how many of the window's months fall on/after firstMonth
}

// For each card, how much of an averaging window its history actually
// covers. A card imported only from September has no data for the months
// before it — those aren't $0 months, they're months nobody imported — so
// its spend is averaged over the months it covers, not the whole window.
export function cardCoverage(transactions: Pick<Transaction, "cardId" | "date">[], windowMonths: string[]): Map<string, CardCoverage> {
  const first = new Map<string, string>();
  for (const t of transactions) {
    const m = monthKey(t.date);
    const f = first.get(t.cardId);
    if (!f || m < f) first.set(t.cardId, m);
  }
  const coverage = new Map<string, CardCoverage>();
  for (const [cardId, firstMonth] of first) {
    coverage.set(cardId, { firstMonth, months: windowMonths.filter((m) => m >= firstMonth).length });
  }
  return coverage;
}

// "Amex Cobalt from Sep 26" for each card whose history starts partway
// through the window; null when every card covers all of it.
export function partialCoverageNote(coverage: Map<string, CardCoverage>, windowLength: number, cards: Pick<Card, "id" | "name">[]): string | null {
  const parts = cards
    .map((card) => ({ card, cov: coverage.get(card.id) }))
    .filter(({ cov }) => cov && cov.months > 0 && cov.months < windowLength)
    .map(({ card, cov }) => `${card.name} from ${monthLabel(cov!.firstMonth)}`);
  return parts.length ? parts.join(" · ") : null;
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
  coverage: Map<string, CardCoverage>;
}

// Average monthly spend by category, by parent vendor within each category,
// and by raw-description vendor within each parent, over a trailing window
// of complete months. Spend is purchases less refunds, same as the
// Dashboard (dashboardSpendForTransaction).
//
// Each card's spend is divided by the months of the window its history
// covers (cardCoverage), not "months that had spend": a vendor charged twice
// on a long-held card averages to total/6, not total/2 — but a card imported
// only two months ago averages over those two, not over four months that
// were never imported. Categories flagged excludeFromDashboard are dropped,
// same as every other Dashboard-style aggregate — as is any individual
// transaction flagged the same way (e.g. a one-off outlier that shouldn't
// skew this vendor's average without hiding every other charge from it).
// Only categories, parents, and vendors with positive spend in the window
// are returned.
export function computeMonthlyAverages(
  transactions: Transaction[],
  categories: Category[],
  parentVendors: ParentVendor[],
  childVendors: ChildVendor[],
  monthsCount = 6
): MonthlyAverages {
  const months = trailingPeriodKeys("month", monthsCount);
  const monthSet = new Set(months);
  const coverage = cardCoverage(transactions, months);
  const childById = new Map(childVendors.map((c) => [c.id, c]));
  const parentById = new Map(parentVendors.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const excludedCategoryIds = new Set(categories.filter((c) => c.excludeFromDashboard).map((c) => c.id));

  // Bucket by the leaf (ChildVendor) first — that's the finest grain the
  // data has — then roll up into parents and categories, so every level's
  // total is exactly the sum of the level below it.
  const childMonthly = new Map<string, Map<string, number>>();
  // Each transaction's share of its vendor's monthly average: its spend over
  // the number of window months its own card covers.
  const childAvg = new Map<string, number>();
  for (const t of transactions) {
    if (!isDashboardSpend(t) || !t.childVendorId || t.excludeFromDashboard) continue;
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
    const spend = dashboardSpendForTransaction(t);
    byMonth.set(key, (byMonth.get(key) || 0) + spend);
    // In the window, so its card covers at least this month.
    const covered = coverage.get(t.cardId)?.months || 1;
    childAvg.set(t.childVendorId, (childAvg.get(t.childVendorId) || 0) + spend / covered);
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
      avgPerMonth: childAvg.get(childId) || 0,
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
      avgPerMonth: vendors.reduce((sum, v) => sum + v.avgPerMonth, 0),
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
      avgPerMonth: parents.reduce((sum, p) => sum + p.avgPerMonth, 0),
      total,
      parents,
    });
  }
  result.sort((a, b) => b.avgPerMonth - a.avgPerMonth);

  return { months, categories: result, coverage };
}
