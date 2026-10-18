// Store-level Cash Flow operations shared by the routes — each takes the
// whole AppState inside an updateState mutator and keeps the collections
// consistent with each other (entry ↔ bank line links, carried openings).

import type { AppState, BankTransaction, CashFlowEntry, CashFlowMonth } from "./types";
import { addMonths, monthKeyOf } from "./dates";
import { entryDate, propagateCarriedOpenings } from "./cashflow";

// After anything in a month changes, its close may have moved — and every
// following month that carries its opening from it has to follow.
export function refreshOpeningsFrom(state: AppState, month: CashFlowMonth): void {
  propagateCarriedOpenings(state.cashFlowMonths, state.cashFlowEntries, month.accountId, month.month);
}

// A month's opening can also be carried from the month before; refresh from
// there when a month's own opening source changes to "carried".
export function refreshOpeningOf(state: AppState, month: CashFlowMonth): void {
  propagateCarriedOpenings(state.cashFlowMonths, state.cashFlowEntries, month.accountId, addMonths(month.month, -1));
}

export function findMonthFor(state: AppState, accountId: string, date: string): CashFlowMonth | undefined {
  const key = monthKeyOf(date);
  return state.cashFlowMonths.find((m) => m.accountId === accountId && m.month === key);
}

// Marks an entry as settled by a bank line: posted on the line's date, for
// the line's amount. Moves the entry to the line's month if it crosses one,
// so the balance moves where the money actually moved.
export function linkEntry(state: AppState, entry: CashFlowEntry, txn: BankTransaction): { error: string } | null {
  const month = state.cashFlowMonths.find((m) => m.id === entry.monthId);
  if (!month) return { error: "missing_month" };
  if (month.accountId !== txn.accountId) return { error: "account_mismatch" };
  const target = findMonthFor(state, txn.accountId, txn.date);
  if (!target) return { error: "no_month" };
  entry.status = "posted";
  entry.postedDate = txn.date;
  entry.actualAmount = txn.amount;
  entry.bankTransactionId = txn.id;
  entry.monthId = target.id;
  txn.entryId = entry.id;
  refreshOpeningsFrom(state, month);
  if (target.id !== month.id) refreshOpeningsFrom(state, target);
  return null;
}

// Undoes linkEntry. The entry goes back to scheduled if it was scheduled
// (it has a confirmation number or a scheduling date), otherwise planned,
// and back into the month its expected posting date belongs to.
export function unlinkEntry(state: AppState, txn: BankTransaction): void {
  const entry = state.cashFlowEntries.find((e) => e.id === txn.entryId);
  delete txn.entryId;
  if (!entry) return;
  const before = state.cashFlowMonths.find((m) => m.id === entry.monthId);
  delete entry.bankTransactionId;
  delete entry.postedDate;
  delete entry.actualAmount;
  entry.status = entry.confirmationCode || entry.scheduledDate ? "scheduled" : "planned";
  if (before) {
    const home = findMonthFor(state, before.accountId, entryDate(entry));
    if (home) entry.monthId = home.id;
    refreshOpeningsFrom(state, before);
    if (home && home.id !== before.id) refreshOpeningsFrom(state, home);
  }
}

// Removing bank lines must not leave entries pointing at lines that are
// gone. The entries keep their posted status — the payment still happened —
// and only lose the link.
export function detachBankLines(state: AppState, removed: Set<string>): void {
  for (const e of state.cashFlowEntries) {
    if (e.bankTransactionId && removed.has(e.bankTransactionId)) delete e.bankTransactionId;
  }
}

// Removing entries must not leave bank lines pointing at them.
export function detachEntries(state: AppState, removed: Set<string>): void {
  for (const t of state.bankTransactions) {
    if (t.entryId && removed.has(t.entryId)) delete t.entryId;
  }
}
