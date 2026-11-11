// Expands a CashFlowItem's Recurrence into nominal due dates. Business-day
// rolling happens afterwards (businessDays.ts) — these are the dates the
// bill or deposit is *nominally* due.

import type { DayOfMonth, Recurrence } from "./types";
import { addDays, addMonths, daysBetween, daysInMonth, isoFromParts, monthIndex, monthKeyOf } from "./dates";

// A numeric day past the end of the month clamps to the last day ("31" in
// February is the 28th or 29th), so a "monthly on the 31st" item never skips
// a short month.
export function resolveDayOfMonth(monthKey: string, day: DayOfMonth): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const last = daysInMonth(year, month);
  const d = day === "last" ? last : Math.min(Math.max(1, Math.trunc(day)), last);
  return isoFromParts(year, month, d);
}

function monthsInRange(start: string, end: string): string[] {
  const months: string[] = [];
  for (let m = monthKeyOf(start); m <= monthKeyOf(end); m = addMonths(m, 1)) months.push(m);
  return months;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// Every nominal due date in [start, end], inclusive, ascending.
export function occurrencesBetween(recurrence: Recurrence, start: string, end: string): string[] {
  if (start > end) return [];
  const inRange = (d: string) => d >= start && d <= end;
  let dates: string[] = [];

  switch (recurrence.type) {
    case "monthly":
      dates = monthsInRange(start, end).map((m) => resolveDayOfMonth(m, recurrence.day));
      break;
    case "everyNMonths": {
      const n = Math.max(1, Math.trunc(recurrence.n));
      const anchor = monthIndex(recurrence.anchorMonth);
      dates = monthsInRange(start, end)
        .filter((m) => mod(monthIndex(m) - anchor, n) === 0)
        .map((m) => resolveDayOfMonth(m, recurrence.day));
      break;
    }
    case "semiMonthly":
      for (const m of monthsInRange(start, end)) {
        for (const day of recurrence.days) dates.push(resolveDayOfMonth(m, day));
      }
      break;
    case "everyNWeeks": {
      const step = 7 * Math.max(1, Math.trunc(recurrence.n));
      // First step k with anchor + k·step on or after start; k can be
      // negative, so an anchor after the range still produces earlier dates.
      let k = Math.ceil(daysBetween(recurrence.anchorDate, start) / step);
      for (let d = addDays(recurrence.anchorDate, k * step); d <= end; k++, d = addDays(recurrence.anchorDate, k * step)) {
        dates.push(d);
      }
      break;
    }
    case "once":
      dates = [recurrence.date];
      break;
  }

  return [...new Set(dates.filter(inRange))].sort();
}
