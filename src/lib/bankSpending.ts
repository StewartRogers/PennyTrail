// Day-to-day spending from imported bank lines, per cash-flow period, next
// to the period's Weekly Spend estimate and the spend implied by its
// checkpoint. See docs/cash-flow-plan.md phase 5.

import type { BankTransaction, CashFlowEntry, CashFlowMonth } from "./types";
import { isSpendingType } from "./bankClassify";
import { fromCents, periodSpans, sortPeriods, summarizeMonth, toCents } from "./cashflow";

export interface PeriodSpending {
  periodId: string;
  start: string;
  end: string;
  days: number;
  estimate: number;
  impliedSpend?: number;
  spent: number;
  lines: number;
  // Bill payments with no planned entry behind them — money out that the
  // plan didn't expect.
  unplannedBills: number;
  byCategory: { categoryId: string | null; amount: number }[];
  // Whether lines have been imported through the end of the period.
  complete: boolean;
}

// A spending line: purchases, cash, and fees, plus an e-transfer out that
// isn't matched to a planned entry (rent sent by e-transfer is a bill).
export function countsAsSpending(t: BankTransaction): boolean {
  if (t.direction !== "out") return false;
  if (isSpendingType(t.type)) return !t.entryId;
  return t.type === "etransfer" && !t.entryId;
}

export function spendingByPeriod(args: {
  month: CashFlowMonth;
  entries: CashFlowEntry[];
  bankTransactions: BankTransaction[];
  categoryOf: (t: BankTransaction) => string | null;
}): PeriodSpending[] {
  const { month } = args;
  const periods = sortPeriods(month.periods);
  const spans = periodSpans(month.month, periods);
  const summary = summarizeMonth(month, args.entries);
  const lines = args.bankTransactions.filter((t) => t.accountId === month.accountId);
  const latest = lines.reduce((max, t) => (t.date > max ? t.date : max), "");

  return periods.map((p, i) => {
    const span = spans[i];
    const inPeriod = lines.filter((t) => t.date >= span.start && t.date <= span.end);
    const spending = inPeriod.filter(countsAsSpending);
    const byCategory = new Map<string | null, number>();
    for (const t of spending) {
      const c = args.categoryOf(t);
      byCategory.set(c, (byCategory.get(c) ?? 0) + toCents(t.amount));
    }
    const unplanned = inPeriod.filter((t) => t.direction === "out" && t.type === "bill_payment" && !t.entryId);
    const ps = summary.periods[i];
    return {
      periodId: p.id,
      start: span.start,
      end: span.end,
      days: span.days,
      estimate: ps.spend,
      ...(ps.impliedSpend !== undefined ? { impliedSpend: ps.impliedSpend } : {}),
      spent: fromCents(spending.reduce((sum, t) => sum + toCents(t.amount), 0)),
      lines: spending.length,
      unplannedBills: fromCents(unplanned.reduce((sum, t) => sum + toCents(t.amount), 0)),
      byCategory: [...byCategory.entries()].map(([categoryId, cents]) => ({ categoryId, amount: fromCents(cents) })).sort((a, b) => b.amount - a.amount),
      complete: latest >= span.end,
    };
  });
}
