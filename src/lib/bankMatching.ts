// Links imported bank lines to the cash-flow entries they settle, and
// rebuilds checkpoint balances from imported lines. See
// docs/cash-flow-plan.md phase 5. Suggestions only — nothing is linked until
// the user confirms.

import type { BankTransaction, CashFlowEntry, CashFlowItem, CashFlowMonth } from "./types";
import { daysBetween } from "./dates";
import { entryAmount, fromCents, isOutstanding, sortPeriods, toCents } from "./cashflow";

export interface MatchSuggestion {
  bankTransactionId: string;
  entryId: string;
  confidence: "exact" | "likely";
  daysApart: number;
  reasons: string[];
}

// Words too generic to identify an item on their own.
const GENERIC = new Set(["visa", "mastercard", "the", "and", "pay", "payment", "first", "second", "bill", "card"]);

function significantWords(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w.toLowerCase()) && w !== "SR" && w !== "KA");
}

function textMatches(details: string, entry: CashFlowEntry, item: CashFlowItem | undefined): string | null {
  const text = ` ${details.toUpperCase().replace(/\s+/g, " ")} `;
  const matchText = item?.matchText?.trim().toUpperCase();
  if (matchText) return text.includes(matchText) ? `matches "${item!.matchText}"` : null;
  const words = significantWords(entry.name);
  const hit = words.find((w) => new RegExp(`[^A-Z0-9]${w}[^A-Z0-9]`).test(text));
  return hit ? `mentions "${hit}"` : null;
}

export function suggestMatches(args: {
  bankTransactions: BankTransaction[];
  entries: CashFlowEntry[];
  items: CashFlowItem[];
  months: CashFlowMonth[];
  toleranceDays?: number;
}): MatchSuggestion[] {
  const tolerance = args.toleranceDays ?? 5;
  const itemById = new Map(args.items.map((i) => [i.id, i]));
  const accountByMonth = new Map(args.months.map((m) => [m.id, m.accountId]));
  const candidates: MatchSuggestion[] = [];

  for (const txn of args.bankTransactions) {
    if (txn.entryId) continue;
    for (const entry of args.entries) {
      if (entry.bankTransactionId || !isOutstanding(entry)) continue;
      if (accountByMonth.get(entry.monthId) !== txn.accountId) continue;
      if ((entry.kind === "deposit") !== (txn.direction === "in")) continue;
      const targets = [entry.postingDate, entry.scheduledDate].filter((d): d is string => !!d);
      const daysApart = Math.min(...targets.map((d) => Math.abs(daysBetween(d, txn.date))));
      if (daysApart > tolerance) continue;

      const item = entry.itemId ? itemById.get(entry.itemId) : undefined;
      const text = textMatches(txn.rawDescription, entry, item);
      const amountExact = toCents(entryAmount(entry)) === toCents(txn.amount);
      const variable = item?.amountMode === "variable";
      const reasons: string[] = [];
      if (text) reasons.push(text);
      if (amountExact) reasons.push("same amount");
      reasons.push(daysApart === 0 ? "same day" : `${daysApart} day${daysApart === 1 ? "" : "s"} apart`);

      let confidence: MatchSuggestion["confidence"] | null = null;
      if (text && amountExact) confidence = "exact";
      else if (text && variable) confidence = "likely";
      else if (amountExact && daysApart <= 3) confidence = "likely";
      if (confidence) candidates.push({ bankTransactionId: txn.id, entryId: entry.id, confidence, daysApart, reasons });
    }
  }

  // Best first, then each line and each entry used at most once.
  candidates.sort((a, b) => (a.confidence === b.confidence ? a.daysApart - b.daysApart : a.confidence === "exact" ? -1 : 1));
  const usedTxns = new Set<string>();
  const usedEntries = new Set<string>();
  const result: MatchSuggestion[] = [];
  for (const c of candidates) {
    if (usedTxns.has(c.bankTransactionId) || usedEntries.has(c.entryId)) continue;
    usedTxns.add(c.bankTransactionId);
    usedEntries.add(c.entryId);
    result.push(c);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Balances from imported lines
// ---------------------------------------------------------------------------

// Start + funds in − funds out for the account's lines dated after
// `fromDate` up to and including `toDate`.
export function deriveBalance(args: {
  accountId: string;
  startBalance: number;
  fromDate: string;
  toDate: string;
  bankTransactions: BankTransaction[];
}): number {
  let cents = toCents(args.startBalance);
  for (const t of args.bankTransactions) {
    if (t.accountId !== args.accountId || t.date <= args.fromDate || t.date > args.toDate) continue;
    cents += t.direction === "in" ? toCents(t.amount) : -toCents(t.amount);
  }
  return fromCents(cents);
}

// How long after a recorded balance the first imported line may start and
// still be taken to cover the time since: an account can sit quiet over a
// long weekend, but not for weeks.
const MAX_UNCOVERED_DAYS = 7;

export interface CheckpointSuggestion {
  periodId: string;
  balance: number;
  basedOn: { date: string; balance: number };
  lines: number;
}

// For each unrecorded checkpoint in `month`, the balance rebuilt from the
// last recorded checkpoint before it (in this month or an earlier one) plus
// the imported lines since — offered for the user to confirm against the
// banking app, never stored on its own. Only offered when at least one line
// has been imported in the gap, and only up to the latest imported line, so
// a half-imported period isn't suggested.
export function suggestCheckpointBalances(args: {
  month: CashFlowMonth;
  months: CashFlowMonth[];
  bankTransactions: BankTransaction[];
}): CheckpointSuggestion[] {
  const { month } = args;
  const accountTxns = args.bankTransactions.filter((t) => t.accountId === month.accountId);
  if (accountTxns.length === 0) return [];
  const latestLine = accountTxns.reduce((max, t) => (t.date > max ? t.date : max), "");
  const earliestLine = accountTxns.reduce((min, t) => (t.date < min ? t.date : min), latestLine);
  const recorded: { date: string; balance: number }[] = [];
  for (const m of args.months) {
    if (m.accountId !== month.accountId) continue;
    for (const p of m.periods) if (p.actualBalance !== undefined) recorded.push({ date: p.endDate, balance: p.actualBalance });
  }
  recorded.sort((a, b) => (a.date < b.date ? -1 : 1));

  const suggestions: CheckpointSuggestion[] = [];
  for (const p of sortPeriods(month.periods)) {
    if (p.actualBalance !== undefined || p.endDate > latestLine) continue;
    const base = [...recorded].reverse().find((r) => r.date < p.endDate);
    if (!base) continue;
    // The lines have to reach back to the recorded balance they build on. If
    // the earliest imported line is well after it (the last checkpoint is
    // September's and the first CSV starts in November), a stretch of
    // activity is missing and the sum would be wrong.
    if (daysBetween(base.date, earliestLine) > MAX_UNCOVERED_DAYS) continue;
    const lines = accountTxns.filter((t) => t.date > base.date && t.date <= p.endDate).length;
    if (lines === 0) continue;
    suggestions.push({
      periodId: p.id,
      balance: deriveBalance({ accountId: month.accountId, startBalance: base.balance, fromDate: base.date, toDate: p.endDate, bankTransactions: accountTxns }),
      basedOn: base,
      lines,
    });
  }
  return suggestions;
}
