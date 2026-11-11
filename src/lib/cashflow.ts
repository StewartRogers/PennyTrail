// Cash Flow math: periods, balances, and month generation. Pure functions
// over plain data, shared by the routes, the screens, and the tests — see
// docs/cash-flow-plan.md sections 3.3 and 3.4 for the rules.
//
// All money arithmetic runs in integer cents. Summing dollars as floats
// drifts (0.1 + 0.2 !== 0.3), and a balance that's off by a cent after a
// month of rows is exactly the kind of error this screen exists to rule out.

import type { BankAccount, CashFlowEntry, CashFlowItem, CashFlowMonth, CashFlowPeriod } from "./types";
import { addDays, addMonths, daysBetween, monthEnd, monthKeyOf, monthStart } from "./dates";
import { nthWeekdayOfMonth, rollToBusinessDay } from "./businessDays";
import { occurrencesBetween } from "./recurrence";

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

// First Friday, second Friday, last day of the month — where the
// spreadsheet's END OF WEEK / END OF MONTH checkpoints have always been.
export function defaultCheckpointDates(monthKey: string): [string, string, string] {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return [nthWeekdayOfMonth(year, month, 5, 1), nthWeekdayOfMonth(year, month, 5, 2), monthEnd(monthKey)];
}

export function defaultPeriods(monthKey: string, newId: () => string): CashFlowPeriod[] {
  const [first, second, end] = defaultCheckpointDates(monthKey);
  return [
    { id: newId(), endDate: first, label: "End of week" },
    { id: newId(), endDate: second, label: "End of week" },
    { id: newId(), endDate: end, label: "End of month" },
  ];
}

export function sortPeriods(periods: CashFlowPeriod[]): CashFlowPeriod[] {
  return [...periods].sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));
}

export interface PeriodSpan {
  start: string;
  end: string;
  days: number;
}

// A period runs from the day after the previous checkpoint (the 1st, for the
// first period) to its own checkpoint, inclusive. Expects periods sorted.
export function periodSpans(monthKey: string, sortedPeriods: CashFlowPeriod[]): PeriodSpan[] {
  const spans: PeriodSpan[] = [];
  let start = monthStart(monthKey);
  for (const p of sortedPeriods) {
    const days = Math.max(0, daysBetween(start, p.endDate) + 1);
    spans.push({ start, end: p.endDate, days });
    start = addDays(p.endDate, 1);
  }
  return spans;
}

// The period a date counts in: the first whose checkpoint is on or after
// it. Anything past the last checkpoint lands in the last period, so an
// entry is never silently dropped from the totals.
export function periodIndexForDate(date: string, spans: PeriodSpan[]): number {
  const index = spans.findIndex((s) => date <= s.end);
  return index === -1 ? spans.length - 1 : index;
}

export function periodSpend(period: CashFlowPeriod, span: PeriodSpan, dailySpendRate: number): number {
  if (period.spendOverride !== undefined) return period.spendOverride;
  return fromCents(toCents(dailySpendRate) * span.days);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

// Once posted, the real date decides where an entry counts.
export function entryDate(entry: Pick<CashFlowEntry, "postedDate" | "postingDate">): string {
  return entry.postedDate ?? entry.postingDate;
}

export function entryAmount(entry: Pick<CashFlowEntry, "actualAmount" | "expectedAmount">): number {
  return entry.actualAmount ?? entry.expectedAmount;
}

// Not yet confirmed: still a projection.
export function isOutstanding(entry: Pick<CashFlowEntry, "status">): boolean {
  return entry.status === "projected";
}

export function isOverdue(entry: Pick<CashFlowEntry, "status" | "postedDate" | "postingDate">, today: string): boolean {
  return isOutstanding(entry) && entryDate(entry) < today;
}

// A payment is set up once it has a confirmation number or a scheduling
// date — neither changes the status (it stays Projected), but the payment
// exists.
export function isPaymentSetUp(entry: Pick<CashFlowEntry, "status" | "confirmationCode" | "scheduledDate">): boolean {
  return entry.status === "projected" && (!!entry.confirmationCode || !!entry.scheduledDate);
}

// Only manual bills ask to be scheduled — automatic (AD) and external (X)
// items happen without you, and one with a payment set up is handled.
export function needsScheduling(entry: Pick<CashFlowEntry, "status" | "kind" | "settlement" | "confirmationCode" | "scheduledDate">): boolean {
  return entry.kind === "bill" && entry.status === "projected" && (entry.settlement ?? "manual") === "manual" && !isPaymentSetUp(entry);
}

function signedCents(entry: CashFlowEntry): number {
  const cents = toCents(entryAmount(entry));
  return entry.kind === "deposit" ? cents : -cents;
}

// ---------------------------------------------------------------------------
// Month summary
// ---------------------------------------------------------------------------

export interface EntryRow {
  entry: CashFlowEntry;
  amount: number;
  counted: boolean; // false for skipped entries
  balanceAfter: number;
}

export interface PeriodSummary {
  period: CashFlowPeriod;
  index: number;
  start: string;
  end: string;
  days: number;
  opening: number;
  spend: number;
  // What the daily rate alone gives for this period (spend, unless overridden).
  rateSpend: number;
  // The balance once Weekly Spend is taken, before any entry.
  afterSpend: number;
  deposits: number;
  bills: number;
  projected: number;
  actual?: number;
  variance?: number; // actual − projected
  impliedSpend?: number; // spend − variance
  impliedDailySpend?: number;
  rows: EntryRow[];
}

export interface MonthSummary {
  opening: number;
  periods: PeriodSummary[];
  deposits: number;
  bills: number;
  spend: number;
  // What the month ends at on paper, carrying each recorded checkpoint.
  projectedClose: number;
  // The final checkpoint if recorded, otherwise projectedClose.
  closingBalance: number;
  closingIsActual: boolean;
  // Lowest balance still ahead: only periods without a recorded checkpoint
  // count, since a recorded one is history. Null when every period is in.
  lowPoint: { balance: number; date: string } | null;
  // Sum over periods with a recorded checkpoint.
  impliedSpend: number;
  // impliedSpend per day over the recorded periods; null when none is in.
  impliedDailySpend: number | null;
  outstandingBills: { count: number; total: number };
  // Entries still Projected — zero once every amount has been confirmed.
  projectedEntries: number;
}

// Money going out across a set of entries, in dollars.
export function billsTotal(entries: Pick<CashFlowEntry, "kind" | "actualAmount" | "expectedAmount">[]): number {
  return fromCents(entries.reduce((sum, e) => (e.kind === "bill" ? sum + toCents(entryAmount(e)) : sum), 0));
}

function byEntryDate(a: CashFlowEntry, b: CashFlowEntry): number {
  const da = entryDate(a);
  const db = entryDate(b);
  return da < db ? -1 : da > db ? 1 : 0;
}

// Each period: opening (the previous checkpoint's actual balance when
// recorded, else its projection) − Weekly Spend + deposits − bills. Rows
// apply in date order (stable for ties, so the order entries were added in
// breaks them), after the Weekly Spend line, as in the spreadsheet.
export function summarizeMonth(month: CashFlowMonth, monthEntries: CashFlowEntry[]): MonthSummary {
  const periods = sortPeriods(month.periods);
  const spans = periodSpans(month.month, periods);
  const buckets: CashFlowEntry[][] = periods.map(() => []);
  for (const entry of [...monthEntries].sort(byEntryDate)) {
    if (periods.length === 0) break;
    buckets[periodIndexForDate(entryDate(entry), spans)].push(entry);
  }

  const openingCents = toCents(month.openingBalance);
  let carry = openingCents;
  let depositsCents = 0;
  let billsCents = 0;
  let spendCents = 0;
  let impliedCents = 0;
  let recordedDays = 0;
  let low: { cents: number; date: string } | null = null;
  const consider = (cents: number, date: string) => {
    if (!low || cents < low.cents) low = { cents, date };
  };

  const summaries: PeriodSummary[] = periods.map((period, index) => {
    const span = spans[index];
    const periodOpening = carry;
    const spend = toCents(periodSpend(period, span, month.dailySpendRate));
    let balance = periodOpening - spend;
    let deposits = 0;
    let bills = 0;
    const rows: EntryRow[] = [];
    for (const entry of buckets[index]) {
      const counted = entry.status !== "skipped";
      if (counted) {
        const signed = signedCents(entry);
        balance += signed;
        if (signed >= 0) deposits += signed;
        else bills -= signed;
      }
      rows.push({ entry, amount: entryAmount(entry), counted, balanceAfter: fromCents(balance) });
    }
    const projected = balance;
    const recorded = period.actualBalance !== undefined;

    if (!recorded) {
      // Weekly Spend is taken at the start of the period; a deposit whose
      // date is only an estimate is assumed to arrive at the very end, so
      // the warning errs on the cautious side.
      let running = periodOpening - spend;
      consider(running, span.start);
      const late: CashFlowEntry[] = [];
      for (const entry of buckets[index]) {
        if (entry.status === "skipped") continue;
        if (entry.dateUncertain && entry.kind === "deposit") {
          late.push(entry);
          continue;
        }
        running += signedCents(entry);
        consider(running, entryDate(entry));
      }
      for (const entry of late) {
        running += signedCents(entry);
        consider(running, span.end);
      }
    }

    depositsCents += deposits;
    billsCents += bills;
    spendCents += spend;

    const summary: PeriodSummary = {
      period,
      index,
      start: span.start,
      end: span.end,
      days: span.days,
      opening: fromCents(periodOpening),
      spend: fromCents(spend),
      rateSpend: fromCents(toCents(month.dailySpendRate) * span.days),
      afterSpend: fromCents(periodOpening - spend),
      deposits: fromCents(deposits),
      bills: fromCents(bills),
      projected: fromCents(projected),
      rows,
    };
    if (recorded) {
      const actual = toCents(period.actualBalance!);
      const variance = actual - projected;
      const implied = spend - variance;
      impliedCents += implied;
      recordedDays += span.days;
      summary.actual = fromCents(actual);
      summary.variance = fromCents(variance);
      summary.impliedSpend = fromCents(implied);
      summary.impliedDailySpend = span.days > 0 ? Math.round(implied / span.days) / 100 : undefined;
      carry = actual;
    } else {
      carry = projected;
    }
    return summary;
  });

  const last = summaries[summaries.length - 1];
  const projectedClose = last ? last.projected : fromCents(openingCents);
  const closingIsActual = !!last && last.actual !== undefined;
  const outstanding = monthEntries.filter((e) => e.kind === "bill" && isOutstanding(e));
  const lowPoint = low as { cents: number; date: string } | null;

  return {
    opening: fromCents(openingCents),
    periods: summaries,
    deposits: fromCents(depositsCents),
    bills: fromCents(billsCents),
    spend: fromCents(spendCents),
    projectedClose,
    closingBalance: closingIsActual ? last.actual! : projectedClose,
    closingIsActual,
    lowPoint: lowPoint ? { balance: fromCents(lowPoint.cents), date: lowPoint.date } : null,
    impliedSpend: fromCents(impliedCents),
    impliedDailySpend: recordedDays > 0 ? Math.round(impliedCents / recordedDays) / 100 : null,
    outstandingBills: { count: outstanding.length, total: billsTotal(outstanding) },
    projectedEntries: monthEntries.filter(isOutstanding).length,
  };
}

export function entriesForMonth(entries: CashFlowEntry[], monthId: string): CashFlowEntry[] {
  return entries.filter((e) => e.monthId === monthId);
}

// ---------------------------------------------------------------------------
// Generating a month
// ---------------------------------------------------------------------------

export function occurrenceKey(itemId: string, dueDate: string): string {
  return `${itemId}:${dueDate}`;
}

// A variable item (a card payment, a utility) starts each month at its most
// recent posted amount — the best estimate available — and a fixed item at
// its default.
export function expectedAmountFor(item: CashFlowItem, entries: CashFlowEntry[]): number {
  if (item.amountMode === "fixed") return item.defaultAmount;
  let latest: CashFlowEntry | null = null;
  for (const e of entries) {
    if (e.itemId !== item.id || e.status !== "actual") continue;
    if (!latest || entryDate(e) > entryDate(latest)) latest = e;
  }
  return latest ? entryAmount(latest) : item.defaultAmount;
}

// Each occurrence belongs to exactly one month: the month of its posting
// date. Occurrences from the neighbouring months are expanded too, because
// rolling can carry one across the boundary (rent due Saturday Oct 31 posts
// Monday Nov 2, so it's November's). The occurrence key then stops it being
// generated again if it already exists anywhere.
//
// An entry of the item already in this month whose key matches none of the
// item's occurrences — imported from the spreadsheet under the date it was
// recorded on, or generated before the item's day was changed — stands in
// for the missing occurrence nearest its date, so the same bill is never
// added (and subtracted) twice.
export function generateMonthEntries(args: {
  items: CashFlowItem[];
  month: CashFlowMonth;
  holidays: string[];
  existing: CashFlowEntry[];
  newId: () => string;
}): CashFlowEntry[] {
  const { items, month, existing, newId } = args;
  const holidays = new Set(args.holidays);
  const existingKeys = new Set(existing.map((e) => e.occurrenceKey).filter(Boolean));
  const windowStart = monthStart(addMonths(month.month, -1));
  const windowEnd = monthEnd(addMonths(month.month, 1));
  const created: CashFlowEntry[] = [];

  for (const item of items) {
    if (!item.active || item.accountId !== month.accountId) continue;
    const dueDates = occurrencesBetween(item.recurrence, windowStart, windowEnd);
    const itemKeys = new Set(dueDates.map((d) => occurrenceKey(item.id, d)));
    let missing: { dueDate: string; postingDate: string }[] = [];
    for (const dueDate of dueDates) {
      const postingDate = rollToBusinessDay(dueDate, item.roll, holidays);
      if (monthKeyOf(postingDate) !== month.month) continue;
      if (existingKeys.has(occurrenceKey(item.id, dueDate))) continue;
      missing.push({ dueDate, postingDate });
    }
    for (const e of existing) {
      if (missing.length === 0) break;
      if (e.itemId !== item.id || e.monthId !== month.id || (e.occurrenceKey && itemKeys.has(e.occurrenceKey))) continue;
      let nearest = missing[0];
      for (const m of missing) {
        if (Math.abs(daysBetween(m.postingDate, e.postingDate)) < Math.abs(daysBetween(nearest.postingDate, e.postingDate))) nearest = m;
      }
      missing = missing.filter((m) => m !== nearest);
    }
    for (const { dueDate, postingDate } of missing) {
      const key = occurrenceKey(item.id, dueDate);
      existingKeys.add(key);
      created.push({
        id: newId(),
        monthId: month.id,
        itemId: item.id,
        occurrenceKey: key,
        name: item.name,
        kind: item.kind,
        dueDate,
        postingDate,
        expectedAmount: expectedAmountFor(item, existing),
        status: "projected",
        settlement: item.settlement,
        ...(item.dateUncertain ? { dateUncertain: true } : {}),
      });
    }
  }
  return created.sort(byEntryDate);
}

export type StartMonthResult =
  | { month: CashFlowMonth; entries: CashFlowEntry[] }
  | { error: "exists" | "opening_required" };

// Creates a month: default checkpoints, the account's daily rate, entries
// from the active recurring items, and an opening balance carried from the
// previous month's close (or the one given, which takes precedence).
export function startMonth(args: {
  account: BankAccount;
  monthKey: string;
  months: CashFlowMonth[];
  entries: CashFlowEntry[];
  items: CashFlowItem[];
  openingBalance?: number;
  newId: (prefix: string) => string;
}): StartMonthResult {
  const { account, monthKey, months, entries, items, newId } = args;
  const accountMonths = months.filter((m) => m.accountId === account.id);
  if (accountMonths.some((m) => m.month === monthKey)) return { error: "exists" };

  let openingBalance: number;
  let openingSource: CashFlowMonth["openingSource"];
  const previous = accountMonths.find((m) => m.month === addMonths(monthKey, -1));
  if (args.openingBalance !== undefined && Number.isFinite(args.openingBalance)) {
    openingBalance = args.openingBalance;
    openingSource = "manual";
  } else if (previous) {
    openingBalance = summarizeMonth(previous, entriesForMonth(entries, previous.id)).closingBalance;
    openingSource = "carried";
  } else {
    return { error: "opening_required" };
  }

  const month: CashFlowMonth = {
    id: newId("cfm"),
    accountId: account.id,
    month: monthKey,
    openingBalance,
    openingSource,
    dailySpendRate: account.dailySpendRate,
    periods: defaultPeriods(monthKey, () => newId("cfp")),
    closed: false,
  };
  const created = generateMonthEntries({
    items,
    month,
    holidays: account.bankHolidays,
    existing: entries,
    newId: () => newId("cfe"),
  });
  return { month, entries: created };
}

// A carried opening balance is the previous month's close, so it has to
// follow that close when anything in the previous month changes (a
// checkpoint recorded, an amount corrected). Walks forward from the month
// after `fromMonthKey` through consecutive carried months, stopping at the
// first manual one or at a gap. Mutates `months` in place; returns how many
// openings changed.
export function propagateCarriedOpenings(
  months: CashFlowMonth[],
  entries: CashFlowEntry[],
  accountId: string,
  fromMonthKey: string
): number {
  let changed = 0;
  let previous = months.find((m) => m.accountId === accountId && m.month === fromMonthKey);
  while (previous) {
    const next = months.find((m) => m.accountId === accountId && m.month === addMonths(previous!.month, 1));
    if (!next || next.openingSource !== "carried") break;
    const close = summarizeMonth(previous, entriesForMonth(entries, previous.id)).closingBalance;
    if (toCents(next.openingBalance) !== toCents(close)) {
      next.openingBalance = close;
      changed++;
    }
    previous = next;
  }
  return changed;
}
