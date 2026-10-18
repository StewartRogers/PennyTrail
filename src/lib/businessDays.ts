// Bank business days. The bank only posts on business days, and what moves
// the balance is the posting date — so every cash-flow entry is placed by
// its business-day-adjusted date (see RollRule in types.ts and
// docs/cash-flow-plan.md section 2.2).

import type { RollRule } from "./types";
import { addDays, dayOfWeek, daysInMonth, isoFromParts } from "./dates";

export function isWeekend(iso: string): boolean {
  const dow = dayOfWeek(iso);
  return dow === 0 || dow === 6;
}

// Easter Sunday, by the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoFromParts(year, month, day);
}

// The nth (1-based) given weekday (0 = Sunday) of a month.
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const first = isoFromParts(year, month, 1);
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  if (day > daysInMonth(year, month)) throw new Error(`No ${n}th weekday ${weekday} in ${year}-${month}`);
  return isoFromParts(year, month, day);
}

export interface Holiday {
  date: string;
  name: string;
}

// Payments Canada's non-business days plus BC's Family Day and BC Day. A
// holiday that falls on a weekend is observed on the next weekday not
// already taken by another holiday — so Christmas on a Saturday is observed
// Monday the 27th and Boxing Day (Sunday) Tuesday the 28th. The list is
// only the default: each bank account stores its own editable copy.
export function canadianBankHolidays(year: number): Holiday[] {
  const victoriaDay = (() => {
    // The Monday before May 25: the last Monday on or before May 24.
    let d = isoFromParts(year, 5, 24);
    while (dayOfWeek(d) !== 1) d = addDays(d, -1);
    return d;
  })();
  const nominal: Holiday[] = [
    { date: isoFromParts(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 2, 1, 3), name: "Family Day" },
    { date: addDays(easterSunday(year), -2), name: "Good Friday" },
    { date: victoriaDay, name: "Victoria Day" },
    { date: isoFromParts(year, 7, 1), name: "Canada Day" },
    { date: nthWeekdayOfMonth(year, 8, 1, 1), name: "BC Day" },
    { date: nthWeekdayOfMonth(year, 9, 1, 1), name: "Labour Day" },
    { date: isoFromParts(year, 9, 30), name: "National Day for Truth and Reconciliation" },
    { date: nthWeekdayOfMonth(year, 10, 1, 2), name: "Thanksgiving" },
    { date: isoFromParts(year, 11, 11), name: "Remembrance Day" },
    { date: isoFromParts(year, 12, 25), name: "Christmas Day" },
    { date: isoFromParts(year, 12, 26), name: "Boxing Day" },
  ];
  // Fixed-weekday holidays are never on a weekend; only the fixed-date ones
  // move. Process in date order so a moved holiday sees every date already
  // claimed before it.
  nominal.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const taken = new Set(nominal.filter((h) => !isWeekend(h.date)).map((h) => h.date));
  return nominal.map((h) => {
    if (!isWeekend(h.date)) return h;
    let observed = addDays(h.date, 1);
    while (isWeekend(observed) || taken.has(observed)) observed = addDays(observed, 1);
    taken.add(observed);
    return { date: observed, name: `${h.name} (observed)` };
  });
}

export function defaultBankHolidays(fromYear: number, toYear: number): string[] {
  const dates: string[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of canadianBankHolidays(year)) dates.push(h.date);
  }
  return [...new Set(dates)].sort();
}

export function isBusinessDay(iso: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(iso) && !holidays.has(iso);
}

// On or after `iso`.
export function nextBusinessDay(iso: string, holidays: ReadonlySet<string>): string {
  let d = iso;
  while (!isBusinessDay(d, holidays)) d = addDays(d, 1);
  return d;
}

// On or before `iso`.
export function previousBusinessDay(iso: string, holidays: ReadonlySet<string>): string {
  let d = iso;
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

export function rollToBusinessDay(iso: string, rule: RollRule, holidays: ReadonlySet<string>): string {
  if (rule === "next") return nextBusinessDay(iso, holidays);
  if (rule === "previous") return previousBusinessDay(iso, holidays);
  return iso;
}
