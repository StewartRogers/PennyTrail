import { describe, expect, it } from "vitest";
import { deriveBalance, suggestCheckpointBalances, suggestMatches } from "@/lib/bankMatching";
import { countsAsSpending, spendingByPeriod } from "@/lib/bankSpending";
import { defaultPeriods, sortPeriods } from "@/lib/cashflow";
import type { BankTransaction, CashFlowEntry, CashFlowItem, CashFlowMonth } from "@/lib/types";

let seq = 0;
const id = (p: string) => `${p}_${++seq}`;

function month(overrides: Partial<CashFlowMonth> = {}): CashFlowMonth {
  const key = overrides.month ?? "2026-10";
  return { id: "m_oct", accountId: "acct", month: key, openingBalance: 5000, openingSource: "manual", dailySpendRate: 50, periods: defaultPeriods(key, () => id("p")), closed: false, ...overrides };
}

function txn(overrides: Partial<BankTransaction>): BankTransaction {
  return { id: id("bt"), accountId: "acct", date: "2026-10-01", rawDescription: "POS MERCHANDISE SDM", amount: 10, direction: "out", type: "purchase", childVendorId: null, needsReview: false, ...overrides };
}

function entry(overrides: Partial<CashFlowEntry>): CashFlowEntry {
  return { id: id("e"), monthId: "m_oct", itemId: null, name: "Entry", kind: "bill", dueDate: "2026-10-01", postingDate: "2026-10-01", expectedAmount: 100, status: "planned", ...overrides };
}

function item(overrides: Partial<CashFlowItem>): CashFlowItem {
  return { id: id("i"), accountId: "acct", name: "Item", kind: "bill", amountMode: "fixed", defaultAmount: 100, recurrence: { type: "monthly", day: 1 }, roll: "next", settlement: "manual", active: true, ...overrides };
}

describe("suggestMatches", () => {
  const m = month();

  it("matches pay by direction, amount, and name", () => {
    const pay = entry({ name: "Stewart Pay", kind: "deposit", expectedAmount: 3000, postingDate: "2026-10-01" });
    const line = txn({ rawDescription: "PAYROLL STEWART CO", amount: 3000, direction: "in", type: "deposit" });
    expect(suggestMatches({ bankTransactions: [line], entries: [pay], items: [], months: [m] })).toEqual([
      { bankTransactionId: line.id, entryId: pay.id, confidence: "exact", daysApart: 0, reasons: ['mentions "STEWART"', "same amount", "same day"] },
    ]);
  });

  it("uses an item's match text instead of its name", () => {
    const rent = item({ name: "152 Rent (first)", matchText: "E-TRANSFER SEND PERSON" });
    const e = entry({ itemId: rent.id, name: "152 Rent (first)", expectedAmount: 1500, postingDate: "2026-11-02" });
    const line = txn({ rawDescription: " INTERAC E-TRANSFER SEND PERSON", amount: 1500, date: "2026-11-02", type: "etransfer" });
    const [s] = suggestMatches({ bankTransactions: [line], entries: [e], items: [rent], months: [m] });
    expect(s.confidence).toBe("exact");
    expect(s.reasons[0]).toBe('matches "E-TRANSFER SEND PERSON"');
  });

  it("matches a variable bill by name even when the amount differs", () => {
    const hydro = item({ name: "BC Hydro", amountMode: "variable" });
    const e = entry({ itemId: hydro.id, name: "BC Hydro", expectedAmount: 150, postingDate: "2026-10-23" });
    const line = txn({ rawDescription: "ONLINE BANKING PAYMENT BC HYDRO", amount: 188.77, date: "2026-10-26", type: "bill_payment" });
    const [s] = suggestMatches({ bankTransactions: [line], entries: [e], items: [hydro], months: [m] });
    expect(s).toMatchObject({ confidence: "likely", daysApart: 3 });
  });

  it("matches on the exact amount alone only within 3 days", () => {
    const e = entry({ name: "Mystery", expectedAmount: 42.42, postingDate: "2026-10-10" });
    const near = txn({ rawDescription: "SOMETHING", amount: 42.42, date: "2026-10-13" });
    const far = txn({ rawDescription: "SOMETHING", amount: 42.42, date: "2026-10-14" });
    expect(suggestMatches({ bankTransactions: [near], entries: [e], items: [], months: [m] })).toHaveLength(1);
    expect(suggestMatches({ bankTransactions: [far], entries: [e], items: [], months: [m] })).toHaveLength(0);
  });

  it("doesn't match a fixed bill by name when the amount is off", () => {
    const rent = item({ name: "Rent", amountMode: "fixed" });
    const e = entry({ itemId: rent.id, name: "Rent", expectedAmount: 1500 });
    const line = txn({ rawDescription: "BILL PAYMENT RENT", amount: 1400 });
    expect(suggestMatches({ bankTransactions: [line], entries: [e], items: [rent], months: [m] })).toEqual([]);
  });

  it("ignores lines and entries outside the date window, the wrong direction, or already done", () => {
    const e = entry({ name: "Fortis", expectedAmount: 40, postingDate: "2026-10-26" });
    expect(suggestMatches({ bankTransactions: [txn({ rawDescription: "FORTIS", amount: 40, date: "2026-11-01" })], entries: [e], items: [], months: [m] })).toEqual([]);
    expect(suggestMatches({ bankTransactions: [txn({ rawDescription: "FORTIS", amount: 40, date: "2026-10-26", direction: "in" })], entries: [e], items: [], months: [m] })).toEqual([]);
    const posted = { ...e, status: "posted" as const };
    expect(suggestMatches({ bankTransactions: [txn({ rawDescription: "FORTIS", amount: 40, date: "2026-10-26" })], entries: [posted], items: [], months: [m] })).toEqual([]);
    const linked = txn({ rawDescription: "FORTIS", amount: 40, date: "2026-10-26", entryId: "elsewhere" });
    expect(suggestMatches({ bankTransactions: [linked], entries: [e], items: [], months: [m] })).toEqual([]);
  });

  it("measures the window from the scheduled date too", () => {
    const e = entry({ name: "Fortis", expectedAmount: 40, postingDate: "2026-10-26", scheduledDate: "2026-10-12" });
    const early = txn({ rawDescription: "FORTIS", amount: 40, date: "2026-10-13" });
    expect(suggestMatches({ bankTransactions: [early], entries: [e], items: [], months: [m] })).toHaveLength(1);
  });

  it("only matches within the same account", () => {
    const e = entry({ name: "Fortis", expectedAmount: 40 });
    const other = txn({ accountId: "acct_2", rawDescription: "FORTIS", amount: 40 });
    expect(suggestMatches({ bankTransactions: [other], entries: [e], items: [], months: [m] })).toEqual([]);
  });

  it("gives each line and each entry at most one match, best first", () => {
    const pay1 = entry({ name: "Stewart Pay", kind: "deposit", expectedAmount: 3000, postingDate: "2026-10-01" });
    const pay2 = entry({ name: "Stewart Pay", kind: "deposit", expectedAmount: 3000, postingDate: "2026-10-15" });
    const line1 = txn({ rawDescription: "PAYROLL STEWART", amount: 3000, direction: "in", date: "2026-10-01", type: "deposit" });
    const line2 = txn({ rawDescription: "PAYROLL STEWART", amount: 3000, direction: "in", date: "2026-10-15", type: "deposit" });
    const result = suggestMatches({ bankTransactions: [line2, line1], entries: [pay1, pay2], items: [], months: [m] });
    expect(result.map((r) => [r.bankTransactionId, r.entryId])).toEqual([
      [line2.id, pay2.id],
      [line1.id, pay1.id],
    ]);
  });

  it("ignores generic words like the card network", () => {
    const e = entry({ name: "CIBC (Visa)", expectedAmount: 222.47 });
    const line = txn({ rawDescription: "POS MERCHANDISE VISA STORE", amount: 10 });
    expect(suggestMatches({ bankTransactions: [line], entries: [e], items: [], months: [m] })).toEqual([]);
  });
});

describe("deriveBalance", () => {
  it("adds funds in and subtracts funds out after the start date, through the end date", () => {
    const lines = [
      txn({ date: "2026-10-02", amount: 999, direction: "out" }), // on the start date: already in the start balance
      txn({ date: "2026-10-03", amount: 3000, direction: "in" }),
      txn({ date: "2026-10-05", amount: 25.87, direction: "out" }),
      txn({ date: "2026-10-09", amount: 6, direction: "out" }),
      txn({ date: "2026-10-10", amount: 500, direction: "out" }), // after the end
      txn({ date: "2026-10-05", amount: 1, direction: "out", accountId: "other" }),
    ];
    expect(deriveBalance({ accountId: "acct", startBalance: 1000.1, fromDate: "2026-10-02", toDate: "2026-10-09", bankTransactions: lines })).toBe(3968.23);
  });

  it("stays exact over many cent amounts", () => {
    const lines = Array.from({ length: 999 }, () => txn({ date: "2026-10-05", amount: 0.07, direction: "out" }));
    expect(deriveBalance({ accountId: "acct", startBalance: 100, fromDate: "2026-10-01", toDate: "2026-10-31", bankTransactions: lines })).toBe(30.07);
  });
});

describe("suggestCheckpointBalances", () => {
  it("rebuilds an unrecorded checkpoint from the last recorded one", () => {
    const m = month();
    const [p1, p2, p3] = sortPeriods(m.periods);
    p1.actualBalance = 2000;
    const lines = [
      txn({ date: "2026-10-03", amount: 100, direction: "in" }),
      txn({ date: "2026-10-08", amount: 40.5, direction: "out" }),
      txn({ date: "2026-10-12", amount: 10, direction: "out" }),
    ];
    const s = suggestCheckpointBalances({ month: m, months: [m], bankTransactions: lines });
    // P2 (Oct 9): 2,000 + 100 − 40.50. P3 (Oct 31) isn't offered: lines only reach Oct 12.
    expect(s).toEqual([{ periodId: p2.id, balance: 2059.5, basedOn: { date: "2026-10-02", balance: 2000 }, lines: 2 }]);
    expect(s.some((x) => x.periodId === p3.id)).toBe(false);
  });

  it("starts from the previous month's last checkpoint", () => {
    const sep = month({ id: "m_sep", month: "2026-09" });
    sortPeriods(sep.periods)[2].actualBalance = 1000;
    const oct = month();
    const [p1] = sortPeriods(oct.periods);
    const lines = [txn({ date: "2026-10-01", amount: 300, direction: "out" }), txn({ date: "2026-10-05", amount: 1, direction: "out" })];
    const s = suggestCheckpointBalances({ month: oct, months: [sep, oct], bankTransactions: lines });
    expect(s[0]).toEqual({ periodId: p1.id, balance: 700, basedOn: { date: "2026-09-30", balance: 1000 }, lines: 1 });
  });

  it("offers nothing without a recorded checkpoint to start from, or without lines", () => {
    const m = month();
    expect(suggestCheckpointBalances({ month: m, months: [m], bankTransactions: [] })).toEqual([]);
    expect(suggestCheckpointBalances({ month: m, months: [m], bankTransactions: [txn({ date: "2026-10-31" })] })).toEqual([]);
  });
});

describe("spending", () => {
  it("counts purchases, cash, fees, and unmatched e-transfers out", () => {
    expect(countsAsSpending(txn({ type: "purchase" }))).toBe(true);
    expect(countsAsSpending(txn({ type: "atm" }))).toBe(true);
    expect(countsAsSpending(txn({ type: "fee" }))).toBe(true);
    expect(countsAsSpending(txn({ type: "etransfer" }))).toBe(true);
    expect(countsAsSpending(txn({ type: "etransfer", entryId: "rent" }))).toBe(false);
    expect(countsAsSpending(txn({ type: "bill_payment" }))).toBe(false);
    expect(countsAsSpending(txn({ type: "transfer" }))).toBe(false);
    expect(countsAsSpending(txn({ type: "deposit", direction: "in" }))).toBe(false);
    expect(countsAsSpending(txn({ type: "etransfer", direction: "in" }))).toBe(false);
  });

  it("totals spending per period against the estimate, by category", () => {
    const m = month();
    const [p1] = sortPeriods(m.periods);
    p1.actualBalance = 4850; // 5,000 − 100 spend → projected 4,900, so implied spend 150
    const lines = [
      txn({ date: "2026-10-01", amount: 25.87, childVendorId: "sdm" }),
      txn({ date: "2026-10-02", amount: 6, childVendorId: "abc" }),
      txn({ date: "2026-10-02", amount: 1999, type: "etransfer", entryId: "rent" }), // rent, not spending
      txn({ date: "2026-10-02", amount: 80, type: "bill_payment" }), // unplanned bill
      txn({ date: "2026-10-05", amount: 12.13, childVendorId: "sdm" }),
    ];
    const categories: Record<string, string> = { sdm: "cat_pharmacy", abc: "cat_food" };
    const result = spendingByPeriod({ month: m, entries: [], bankTransactions: lines, categoryOf: (t) => (t.childVendorId ? categories[t.childVendorId] : null) });
    expect(result[0]).toMatchObject({ estimate: 100, impliedSpend: 150, spent: 31.87, lines: 2, unplannedBills: 80, complete: true });
    expect(result[0].byCategory).toEqual([
      { categoryId: "cat_pharmacy", amount: 25.87 },
      { categoryId: "cat_food", amount: 6 },
    ]);
    expect(result[1]).toMatchObject({ estimate: 350, spent: 12.13, complete: false });
    expect(result[2]).toMatchObject({ estimate: 1100, spent: 0, lines: 0, complete: false });
  });
});
