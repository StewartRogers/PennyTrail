// Calendar arithmetic on ISO yyyy-mm-dd strings and yyyy-mm month keys.
//
// Everything goes through Date.UTC, never the local-time Date constructor:
// local midnight shifts by an hour across a DST change, so "add 7 days" via
// local milliseconds can land on 23:00 the previous day and print as the
// wrong date. UTC days are always exactly 86,400,000 ms long.

const DAY_MS = 86_400_000;

function parts(iso: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Not an ISO date: "${iso}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isoFromParts(year: number, month: number, day: number): string {
  return (
    String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0")
  );
}

function toUtcMs(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const dt = new Date(ms);
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

// 0 = Sunday … 6 = Saturday.
export function dayOfWeek(iso: string): number {
  return new Date(toUtcMs(iso)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidMonthKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function monthParts(monthKey: string): [number, number] {
  if (!isValidMonthKey(monthKey)) throw new Error(`Not a month key: "${monthKey}"`);
  return [Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7))];
}

export function monthKeyOf(iso: string): string {
  parts(iso);
  return iso.slice(0, 7);
}

export function monthStart(monthKey: string): string {
  const [y, m] = monthParts(monthKey);
  return isoFromParts(y, m, 1);
}

export function monthEnd(monthKey: string): string {
  const [y, m] = monthParts(monthKey);
  return isoFromParts(y, m, daysInMonth(y, m));
}

// Months since year 0 — makes "every N months" a plain modulo.
export function monthIndex(monthKey: string): number {
  const [y, m] = monthParts(monthKey);
  return y * 12 + (m - 1);
}

export function addMonths(monthKey: string, months: number): string {
  const index = monthIndex(monthKey) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0");
}

export function yearOf(iso: string): number {
  return parts(iso)[0];
}

export function dayOfMonth(iso: string): number {
  return parts(iso)[2];
}
