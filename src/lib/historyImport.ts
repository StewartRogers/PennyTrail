// Parses the monthly budget workbook — one worksheet per month — into
// Cash Flow months, and works out recurring items from the history. The
// layout is documented in docs/cash-flow-plan.md section 6.1. Pure functions
// over cell grids, so the server re-runs exactly what the preview showed.

import type {
  CashFlowEntry,
  CashFlowItem,
  CashFlowKind,
  CashFlowMonth,
  CashFlowPeriod,
  DayOfMonth,
  EntryStatus,
  Recurrence,
  Settlement,
} from "./types";
import type { RollRule } from "./types";
import { addDays, addMonths, daysBetween, daysInMonth, isoFromParts, monthEnd, monthIndex, monthKeyOf, monthStart } from "./dates";
import { rollToBusinessDay } from "./businessDays";
import { resolveDayOfMonth } from "./recurrence";
import { parseAmount } from "./csv";
import { fromCents, summarizeMonth, toCents } from "./cashflow";

export type SheetCell = string | number | boolean | null | undefined;

// Column positions, fixed by the workbook's layout and checked against the
// row 1 labels before anything is read.
const COL = { name: 0, date: 1, out: 2, in: 3, balance: 4, code: 5, day: 6, note: 8 } as const;

export interface ParsedEntry {
  row: number; // 1-based sheet row
  name: string;
  key: string;
  owner?: string;
  kind: CashFlowKind;
  date: string;
  amount: number; // 0 when blank
  status: EntryStatus;
  settlement?: Settlement;
  confirmationCode?: string;
  scheduledDate?: string;
  notes?: string;
}

export interface ParsedPeriod {
  row: number;
  endDate: string;
  label: string;
  spend: number;
  actualBalance?: number;
}

export interface ParsedMonth {
  sheetName: string;
  month: string;
  openingBalance: number;
  dailySpendRate: number;
  periods: ParsedPeriod[];
  entries: ParsedEntry[];
  warnings: string[];
  // Rows where the running balance worked out here differs from the sheet's
  // own column E.
  balanceMismatches: { row: number; sheet: number; computed: number }[];
}

export type ParseResult = { ok: true; month: ParsedMonth } | { ok: false; sheetName: string; error: string };

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function cellText(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

export function cellMoney(cell: SheetCell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const text = cellText(cell);
  if (!text) return null;
  const n = parseAmount(text);
  return Number.isFinite(n) ? n : null;
}

// Excel's day 0 is 1899-12-30 (the 1900 leap-year bug makes that the
// correct epoch for every date after February 1900).
export function excelSerialToIso(serial: number): string {
  return addDays("1899-12-30", Math.floor(serial));
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function validIso(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= daysInMonth(y, m))) return null;
  return isoFromParts(y, m, d);
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

export function cellDate(cell: SheetCell): string | null {
  if (typeof cell === "number") {
    // Dates are serials in an .xlsx export; anything outside 1982–2119 isn't one.
    return cell > 30000 && cell < 80000 ? excelSerialToIso(cell) : null;
  }
  const text = cellText(cell);
  if (!text) return null;
  let m = /^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ](\d{2}|\d{4})$/.exec(text); // 01-Jan-24
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? validIso(fullYear(Number(m[3])), month, Number(m[1])) : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text); // M/D/Y, as Google Sheets writes it
  if (m) return validIso(fullYear(Number(m[3])), Number(m[1]), Number(m[2]));
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text); // Jan 1, 2024
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? validIso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

// "** Submitted: May 20, 2025 at 12:24 a.m. ET." and "** Sep 20 2026 8:20PM"
// both record when the payment was scheduled.
export function scheduledDateFromNote(note: string): string | null {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(note);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return month ? validIso(Number(m[3]), month, Number(m[2])) : null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const OWNERS = ["SR", "KA"];

// The same item is spelled differently over the years ("CIBC Visa",
// "CIBC (Visa)"; "Mastercard PCF (KA)", "PCF (Mastercard) - KA"). The key is
// the name's words, lower-cased and sorted, without punctuation or the
// owner's initials — which come back separately.
export function normalizeItemName(raw: string): { name: string; key: string; owner?: string } {
  const name = raw.replace(/^[\s*]+/, "").replace(/\s+/g, " ").trim();
  let owner: string | undefined;
  let rest = name;
  for (const initials of OWNERS) {
    const patterns = [new RegExp(`\\(\\s*${initials}\\s*\\)`), new RegExp(`[-–]\\s*${initials}\\s*$`), new RegExp(`\\b${initials}\\b`)];
    for (const pattern of patterns) {
      if (pattern.test(rest)) {
        owner = owner ?? initials;
        rest = rest.replace(pattern, " ");
      }
    }
  }
  const words = rest
    .toLowerCase()
    .replace(/[()\-–,.:/&]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return { name, key: [...new Set(words)].sort().join(" "), ...(owner ? { owner } : {}) };
}

const DEPOSIT_NAME = /\bpay\b|benefit|deposit|refund|income|rebate/i;

// ---------------------------------------------------------------------------
// One worksheet
// ---------------------------------------------------------------------------

export function monthFromSheetName(name: string): string | null {
  const m = /^\s*([A-Za-z]{3,9})\.?\s*'?\s*(\d{2}|\d{4})\s*$/.exec(name);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${fullYear(Number(m[2]))}-${String(month).padStart(2, "0")}`;
}

function monthFromHeader(header: SheetCell[]): string | null {
  const labelIndex = (label: string) => header.findIndex((c) => cellText(c).toUpperCase() === label);
  const yi = labelIndex("YEAR");
  const mi = labelIndex("MONTH");
  if (yi < 0 || mi < 0) return null;
  const year = Number(cellText(header[yi + 1]));
  const month = Number(cellText(header[mi + 1]));
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function mode<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function parseBudgetSheet(sheetName: string, rows: SheetCell[][], today: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, sheetName, error });
  const header = rows[0] ?? [];
  const label = (col: number) => cellText(header[col]).toUpperCase();
  if (label(COL.date) !== "DATE" || label(COL.out) !== "CREDIT" || label(COL.in) !== "DEBIT" || label(COL.code) !== "NOTES") {
    return fail("Row 1 doesn't have the DATE / CREDIT / DEBIT / NOTES headings in columns B, C, D, and F");
  }
  const month = monthFromHeader(header) ?? monthFromSheetName(sheetName);
  if (!month) return fail("Couldn't tell which month this sheet is (no YEAR/MONTH in row 1, and the sheet name isn't like \"Jan 24\")");
  const openingBalance = cellMoney(header[COL.balance]);
  if (openingBalance === null) return fail("Row 1 column E should hold the opening balance");

  const warnings: string[] = [];
  const balanceMismatches: ParsedMonth["balanceMismatches"] = [];
  const periods: ParsedPeriod[] = [];
  const entries: ParsedEntry[] = [];
  // Which sheet period each entry was listed under, to compare with its date.
  const listedUnder: number[] = [];
  let pendingSpend: number | null = null;
  let running = toCents(openingBalance);

  const checkBalance = (row: number, cell: SheetCell) => {
    const sheet = cellMoney(cell);
    if (sheet === null) return;
    if (Math.abs(toCents(sheet) - running) >= 1) balanceMismatches.push({ row, sheet, computed: fromCents(running) });
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const sheetRow = r + 1;
    const rawName = cellText(row[COL.name]);
    const name = rawName.replace(/^[\s*]+/, "").trim();
    if (!name) continue; // placeholder rows and the closing summary row

    const date = cellDate(row[COL.date]);
    if (/^weekly spend$/i.test(name)) {
      const spend = cellMoney(row[COL.out]) ?? 0;
      if (pendingSpend !== null) {
        warnings.push(`Row ${sheetRow}: a second Weekly Spend before the next checkpoint — both are counted`);
        pendingSpend += spend;
      } else {
        pendingSpend = spend;
      }
      running -= toCents(spend);
      checkBalance(sheetRow, row[COL.balance]);
      continue;
    }

    if (/^end of (week|month)$/i.test(name)) {
      if (!date) {
        warnings.push(`Row ${sheetRow}: ${name} has no date — skipped`);
        continue;
      }
      const balance = cellMoney(row[COL.balance]);
      const recorded = date <= today && balance !== null;
      periods.push({
        row: sheetRow,
        endDate: date,
        label: /month/i.test(name) ? "End of month" : "End of week",
        spend: pendingSpend ?? 0,
        ...(recorded ? { actualBalance: balance! } : {}),
      });
      if (pendingSpend === null) warnings.push(`Row ${sheetRow}: no Weekly Spend in the period ending ${date}`);
      pendingSpend = null;
      // The sheet's variance (column F) is the actual balance minus the
      // projection — check it against ours.
      const sheetVariance = cellMoney(row[COL.code]);
      if (recorded) {
        const variance = toCents(balance!) - running;
        if (sheetVariance !== null && Math.abs(toCents(sheetVariance) - variance) >= 1) {
          warnings.push(`Row ${sheetRow}: the sheet's variance ${sheetVariance.toFixed(2)} doesn't match ${fromCents(variance).toFixed(2)} worked out from its rows`);
        }
        running = toCents(balance!);
      }
      continue;
    }

    if (!date) {
      warnings.push(`Row ${sheetRow}: "${name}" has no readable date — skipped`);
      continue;
    }
    const out = cellMoney(row[COL.out]);
    const inn = cellMoney(row[COL.in]);
    const outCents = toCents(out ?? 0);
    const inCents = toCents(inn ?? 0);
    running += inCents - outCents;
    checkBalance(sheetRow, row[COL.balance]);

    let kind: CashFlowKind;
    let amount: number;
    if (outCents > 0 && inCents > 0) {
      warnings.push(`Row ${sheetRow}: "${name}" has amounts in both CREDIT and DEBIT — imported as the net amount`);
      kind = inCents > outCents ? "deposit" : "bill";
      amount = fromCents(Math.abs(inCents - outCents));
    } else if (outCents !== 0) {
      kind = outCents > 0 ? "bill" : "deposit";
      amount = fromCents(Math.abs(outCents));
    } else if (inCents !== 0) {
      kind = inCents > 0 ? "deposit" : "bill";
      amount = fromCents(Math.abs(inCents));
    } else {
      kind = inn !== null && out === null ? "deposit" : out !== null ? "bill" : DEPOSIT_NAME.test(name) ? "deposit" : "bill";
      amount = 0;
    }

    const code = cellText(row[COL.code]);
    const note = cellText(row[COL.note]);
    const upper = code.toUpperCase();
    let settlement: Settlement | undefined;
    let confirmationCode: string | undefined;
    if (upper === "AD") settlement = "auto";
    else if (upper === "X") settlement = "external";
    else if (upper === "CONFIRMED") settlement = "manual";
    else if (/^\d+$/.test(code)) {
      settlement = "manual";
      // An all-9s number is the sheet's "forgot to capture" placeholder.
      if (!/^9+$/.test(code)) confirmationCode = code;
    }

    const past = date <= today;
    let status: EntryStatus;
    if (amount === 0) {
      const cancelled = /cancel|not using/i.test(note);
      status = past || settlement === "external" || cancelled ? "skipped" : "planned";
    } else if (past) {
      status = "posted";
    } else {
      status = confirmationCode || upper === "CONFIRMED" ? "scheduled" : "planned";
    }

    const scheduled = note.startsWith("**") ? scheduledDateFromNote(note) : null;
    const { key, owner } = normalizeItemName(name);
    entries.push({
      row: sheetRow,
      name,
      key,
      ...(owner ? { owner } : {}),
      kind,
      date,
      amount,
      status,
      ...(settlement ? { settlement } : {}),
      ...(confirmationCode ? { confirmationCode } : {}),
      ...(scheduled && scheduled <= date ? { scheduledDate: scheduled } : {}),
      ...(note ? { notes: note } : {}),
    });
    listedUnder.push(periods.length);
  }

  if (periods.length === 0) return fail("No END OF WEEK / END OF MONTH rows found");
  if (pendingSpend !== null) warnings.push("A Weekly Spend after the last checkpoint was ignored");

  // Period lengths, and the daily rate the estimates were made with.
  const spans: { start: string; days: number }[] = [];
  let start = monthStart(month);
  for (const p of periods) {
    spans.push({ start, days: Math.max(0, daysBetween(start, p.endDate) + 1) });
    start = addDays(p.endDate, 1);
  }
  const rates = periods
    .map((p, i) => (spans[i].days > 0 && toCents(p.spend) % spans[i].days === 0 ? toCents(p.spend) / spans[i].days : null))
    .filter((r): r is number => r !== null && r > 0);
  const dailySpendRate = fromCents(mode(rates) ?? 5000);

  entries.forEach((e, i) => {
    const byDate = periods.findIndex((p) => e.date <= p.endDate);
    const dateIndex = byDate === -1 ? periods.length - 1 : byDate;
    const listed = Math.min(listedUnder[i], periods.length - 1);
    if (dateIndex !== listed) {
      warnings.push(`Row ${e.row}: "${e.name}" is dated ${e.date} but listed under the checkpoint of ${periods[listed].endDate}`);
    }
    if (monthKeyOf(e.date) !== month) warnings.push(`Row ${e.row}: "${e.name}" is dated ${e.date}, outside ${month}`);
  });

  return {
    ok: true,
    month: { sheetName, month, openingBalance, dailySpendRate, periods, entries, warnings, balanceMismatches },
  };
}

// ---------------------------------------------------------------------------
// Recurring items from the history
// ---------------------------------------------------------------------------

export interface SeededItem {
  key: string;
  name: string;
  kind: CashFlowKind;
  amountMode: "fixed" | "variable";
  defaultAmount: number;
  recurrence: Recurrence;
  settlement: Settlement;
  dateUncertain: boolean;
  owner?: string;
  active: boolean;
  monthsSeen: number;
}

// Keys seen in fewer months than this are one-offs (an RESP transfer, a
// cancelled card's final payment) rather than recurring items.
export const MIN_MONTHS_FOR_ITEM = 3;

// "last" first: a numeric 31 clamps to the same dates, and a tie should
// read as month-end.
const DAY_CANDIDATES: DayOfMonth[] = ["last", ...Array.from({ length: 31 }, (_, i) => i + 1)];

function slotOrder(a: DayOfMonth, b: DayOfMonth): number {
  const n = (d: DayOfMonth) => (d === "last" ? 99 : d);
  return n(a) - n(b);
}

// Whether a recorded date is what "due on day D" would have produced: the
// nominal date itself (the sheet often records the due date), or it rolled
// to a business day — from this month, or from the previous one (rent due
// Saturday the 31st posts Monday the 2nd).
function explains(date: string, day: DayOfMonth, roll: RollRule, holidays: ReadonlySet<string>): boolean {
  const month = monthKeyOf(date);
  const here = resolveDayOfMonth(month, day);
  if (date === here || date === rollToBusinessDay(here, roll, holidays)) return true;
  return date === rollToBusinessDay(resolveDayOfMonth(addMonths(month, -1), day), roll, holidays);
}

function isRawDay(date: string, day: DayOfMonth): boolean {
  const d = Number(date.slice(8, 10));
  if (day !== "last") return d === day;
  return d === daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
}

// The due day that explains the most dates; ties go to the day that appears
// most often as written, then to month-end.
function bestDay(dates: string[], roll: RollRule, holidays: ReadonlySet<string>, exclude?: DayOfMonth): { day: DayOfMonth; explained: number } {
  let best: { day: DayOfMonth; explained: number; raw: number } | null = null;
  for (const day of DAY_CANDIDATES) {
    if (day === exclude) continue;
    const explained = dates.filter((d) => explains(d, day, roll, holidays)).length;
    const raw = dates.filter((d) => isRawDay(d, day)).length;
    if (!best || explained > best.explained || (explained === best.explained && raw > best.raw)) best = { day, explained, raw };
  }
  return best!;
}

export function seedItems(months: ParsedMonth[], holidays: ReadonlySet<string>): SeededItem[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort((a, b) => (a.month < b.month ? -1 : 1));
  const newest = sorted[sorted.length - 1];
  const byKey = new Map<string, ParsedEntry[]>();
  for (const m of sorted) {
    for (const e of m.entries) {
      if (!e.key) continue;
      if (!byKey.has(e.key)) byKey.set(e.key, []);
      byKey.get(e.key)!.push(e);
    }
  }

  const seeded: SeededItem[] = [];
  for (const [key, all] of byKey) {
    const monthsSeen = new Set(all.map((e) => monthKeyOf(e.date))).size;
    if (monthsSeen < MIN_MONTHS_FOR_ITEM) continue;
    const latest = all[all.length - 1];
    const inNewest = newest.entries.filter((e) => e.key === key);
    const nonzero = all.filter((e) => e.amount > 0);
    // The last year is what the item looks like now.
    const recentFrom = monthStart(addMonths(newest.month, -11));
    const recent = nonzero.filter((e) => e.date >= recentFrom);
    const basis = recent.length > 0 ? recent : nonzero.length > 0 ? nonzero : all;

    const kind = mode(basis.map((e) => e.kind)) ?? latest.kind;
    const codes = (from: string) => all.filter((e) => e.date >= from && e.settlement).map((e) => e.settlement!);
    const settlement = mode(codes(recentFrom)) ?? mode(codes("")) ?? "manual";
    const owner = inNewest.find((e) => e.owner)?.owner ?? all.find((e) => e.owner)?.owner;
    const amounts = basis.filter((e) => e.amount > 0).map((e) => e.amount);
    const lastAmounts = amounts.slice(-3);
    const amountMode = lastAmounts.length >= 2 && lastAmounts.every((a) => toCents(a) === toCents(lastAmounts[0])) ? "fixed" : "variable";
    const defaultAmount = amounts.length > 0 ? amounts[amounts.length - 1] : 0;

    seeded.push({
      key,
      name: (inNewest[0] ?? latest).name,
      kind,
      amountMode,
      defaultAmount,
      recurrence: inferRecurrence(basis, kind, holidays, latest),
      settlement,
      // A deposit someone else sends (the Child Tax Benefit) arrives on its
      // own schedule, so its day is an estimate.
      dateUncertain: kind === "deposit" && settlement === "external",
      ...(owner ? { owner } : {}),
      active: inNewest.length > 0 && !inNewest.every((e) => e.status === "skipped" && /cancel|not using/i.test(e.notes ?? "")),
      monthsSeen,
    });
  }
  return seeded.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function inferRecurrence(occurrences: ParsedEntry[], kind: CashFlowKind, holidays: ReadonlySet<string>, fallback: ParsedEntry): Recurrence {
  const dates = [...new Set(occurrences.map((e) => e.date))].sort();
  if (dates.length === 0) return { type: "monthly", day: Number(fallback.date.slice(8, 10)) };

  // Fortnightly pay: most consecutive gaps are exactly 14 days. The anchor is
  // the latest payday that actually posted — a future month's planned dates
  // are rough guesses and can be off the cycle.
  if (dates.length >= 4) {
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    if (gaps.filter((g) => g === 14).length / gaps.length >= 0.6) {
      const posted = occurrences.filter((e) => e.status === "posted").map((e) => e.date).sort();
      return { type: "everyNWeeks", n: 2, anchorDate: posted[posted.length - 1] ?? dates[dates.length - 1] };
    }
  }

  const roll: RollRule = kind === "bill" ? "next" : "previous";
  const first = bestDay(dates, roll, holidays);
  // Twice a month when a second day explains most of what the first can't
  // (KA's 15th and month-end), not just a stray date or two.
  const unexplained = dates.filter((d) => !explains(d, first.day, roll, holidays));
  if (unexplained.length >= Math.max(2, dates.length * 0.3)) {
    const second = bestDay(unexplained, roll, holidays, first.day);
    if (second.explained >= unexplained.length * 0.7) {
      return { type: "semiMonthly", days: [first.day, second.day].sort(slotOrder) as [DayOfMonth, DayOfMonth] };
    }
  }

  const day = first.day;
  const monthsSeen = [...new Set(dates.map(monthKeyOf))].sort();
  if (monthsSeen.length >= 3) {
    const gaps = monthsSeen.slice(1).map((m, i) => monthIndex(m) - monthIndex(monthsSeen[i]));
    if (gaps.filter((g) => g === 2).length / gaps.length >= 0.6) {
      return { type: "everyNMonths", n: 2, day, anchorMonth: monthsSeen[monthsSeen.length - 1] };
    }
  }
  return { type: "monthly", day };
}

// ---------------------------------------------------------------------------
// Building the records
// ---------------------------------------------------------------------------

export interface HistoryImportPlan {
  items: CashFlowItem[];
  months: CashFlowMonth[];
  entries: CashFlowEntry[];
  skippedMonths: string[]; // already in the store
}

// `existingItems` with the same name key are reused rather than duplicated;
// `existingMonths` are never overwritten. A month's opening is "carried" when
// it equals the previous imported month's close to the cent, so a later
// correction to that month flows forward (see propagateCarriedOpenings).
export function buildHistoryImport(args: {
  accountId: string;
  months: ParsedMonth[];
  seeded: SeededItem[];
  oneOffKeys: ReadonlySet<string>;
  existingItems: CashFlowItem[];
  existingMonths: CashFlowMonth[];
  today: string;
  newId: (prefix: string) => string;
}): HistoryImportPlan {
  const { accountId, seeded, oneOffKeys, existingItems, existingMonths, today, newId } = args;
  const items: CashFlowItem[] = [];
  const itemIdByKey = new Map<string, string>();
  for (const item of existingItems) {
    if (item.accountId === accountId) itemIdByKey.set(normalizeItemName(item.name).key, item.id);
  }
  for (const s of seeded) {
    if (oneOffKeys.has(s.key) || itemIdByKey.has(s.key)) continue;
    const item: CashFlowItem = {
      id: newId("cfi"),
      accountId,
      name: s.name,
      kind: s.kind,
      amountMode: s.amountMode,
      defaultAmount: s.defaultAmount,
      recurrence: s.recurrence,
      roll: s.kind === "bill" ? "next" : "previous",
      settlement: s.settlement,
      ...(s.dateUncertain ? { dateUncertain: true } : {}),
      ...(s.owner ? { owner: s.owner } : {}),
      active: s.active,
    };
    items.push(item);
    itemIdByKey.set(s.key, item.id);
  }

  const taken = new Set(existingMonths.filter((m) => m.accountId === accountId).map((m) => m.month));
  const skippedMonths: string[] = [];
  const months: CashFlowMonth[] = [];
  const entries: CashFlowEntry[] = [];
  let previous: { month: CashFlowMonth; entries: CashFlowEntry[] } | null = null;

  for (const parsed of [...args.months].sort((a, b) => (a.month < b.month ? -1 : 1))) {
    if (taken.has(parsed.month)) {
      skippedMonths.push(parsed.month);
      previous = null;
      continue;
    }
    taken.add(parsed.month);
    const periods: CashFlowPeriod[] = [];
    let start = monthStart(parsed.month);
    for (const p of parsed.periods) {
      const days = Math.max(0, daysBetween(start, p.endDate) + 1);
      const fromRate = toCents(parsed.dailySpendRate) * days;
      periods.push({
        id: newId("cfp"),
        endDate: p.endDate,
        label: p.label,
        ...(toCents(p.spend) !== fromRate ? { spendOverride: p.spend } : {}),
        ...(p.actualBalance !== undefined ? { actualBalance: p.actualBalance } : {}),
      });
      start = addDays(p.endDate, 1);
    }
    const carried =
      previous !== null &&
      previous.month.month === addMonths(parsed.month, -1) &&
      toCents(summarizeMonth(previous.month, previous.entries).closingBalance) === toCents(parsed.openingBalance);
    const allRecorded = periods.every((p) => p.actualBalance !== undefined);
    const month: CashFlowMonth = {
      id: newId("cfm"),
      accountId,
      month: parsed.month,
      openingBalance: parsed.openingBalance,
      openingSource: carried ? "carried" : "manual",
      dailySpendRate: parsed.dailySpendRate,
      periods,
      closed: allRecorded && monthEnd(parsed.month) < today,
      importedFrom: parsed.sheetName,
    };
    const monthEntries: CashFlowEntry[] = parsed.entries.map((e) => {
      const itemId = oneOffKeys.has(e.key) ? null : (itemIdByKey.get(e.key) ?? null);
      return {
        id: newId("cfe"),
        monthId: month.id,
        itemId,
        ...(itemId ? { occurrenceKey: `${itemId}:${e.date}` } : {}),
        name: e.name,
        kind: e.kind,
        dueDate: e.date,
        postingDate: e.date,
        ...(e.status === "posted" ? { postedDate: e.date } : {}),
        expectedAmount: e.amount,
        ...(e.status === "posted" ? { actualAmount: e.amount } : {}),
        status: e.status,
        ...(e.settlement ? { settlement: e.settlement } : {}),
        ...(e.scheduledDate ? { scheduledDate: e.scheduledDate } : {}),
        ...(e.confirmationCode ? { confirmationCode: e.confirmationCode } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
      };
    });
    months.push(month);
    entries.push(...monthEntries);
    previous = { month, entries: monthEntries };
  }
  return { items, months, entries, skippedMonths };
}
