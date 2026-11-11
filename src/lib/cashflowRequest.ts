// Request-body validation for the Cash Flow routes. Every reader returns
// null for anything unusable, so a route can answer 400 instead of storing
// a malformed value.

import type { CashFlowKind, DayOfMonth, EntryStatus, Recurrence, RollRule, Settlement } from "./types";
import { isValidIsoDate } from "./request";
import { isValidMonthKey } from "./dates";

// Past this, an amount is a typo or a hostile request, not a household bill.
export const MAX_AMOUNT = 1_000_000_000;

// A money amount, rounded to the cent. Floats arrive with binary noise
// (0.1 + 0.2 sent as 0.30000000000000004); rounding here keeps every stored
// amount an exact number of cents.
export function readMoney(value: unknown, opts: { allowNegative?: boolean } = {}): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_AMOUNT) return null;
  if (!opts.allowNegative && value < 0) return null;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function readIsoDate(value: unknown): string | null {
  return typeof value === "string" && isValidIsoDate(value) ? value : null;
}

export function readMonthKey(value: unknown): string | null {
  return isValidMonthKey(value) ? value : null;
}

export function readKind(value: unknown): CashFlowKind | null {
  return value === "bill" || value === "deposit" ? value : null;
}

export function readRoll(value: unknown): RollRule | null {
  return value === "next" || value === "previous" || value === "none" ? value : null;
}

export function readSettlement(value: unknown): Settlement | null {
  return value === "manual" || value === "auto" || value === "external" ? value : null;
}

export function readStatus(value: unknown): EntryStatus | null {
  return value === "projected" || value === "actual" || value === "skipped" ? value : null;
}

function readDay(value: unknown): DayOfMonth | null {
  if (value === "last") return "last";
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

export function readRecurrence(value: unknown): Recurrence | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const n = typeof r.n === "number" && Number.isInteger(r.n) && r.n >= 1 && r.n <= 12 ? r.n : null;
  switch (r.type) {
    case "monthly": {
      const day = readDay(r.day);
      return day === null ? null : { type: "monthly", day };
    }
    case "everyNMonths": {
      const day = readDay(r.day);
      const anchorMonth = readMonthKey(r.anchorMonth);
      return day === null || n === null || !anchorMonth ? null : { type: "everyNMonths", n, day, anchorMonth };
    }
    case "semiMonthly": {
      if (!Array.isArray(r.days) || r.days.length !== 2) return null;
      const a = readDay(r.days[0]);
      const b = readDay(r.days[1]);
      return a === null || b === null || a === b ? null : { type: "semiMonthly", days: [a, b] };
    }
    case "everyNWeeks": {
      const anchorDate = readIsoDate(r.anchorDate);
      return n === null || !anchorDate ? null : { type: "everyNWeeks", n, anchorDate };
    }
    case "once": {
      const date = readIsoDate(r.date);
      return date ? { type: "once", date } : null;
    }
    default:
      return null;
  }
}

// Optional free text: absent stays absent, a string is trimmed and capped.
export function readOptionalText(value: unknown, max: number): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false };
  return { ok: true, value: trimmed || undefined };
}
