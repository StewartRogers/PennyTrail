import { describe, expect, it } from "vitest";
import { fmtCurrency, fmtCurrencyShort, fmtCurrencyWhole, fmtDateShort, monthKey, monthLabel, quarterKey, yearKey } from "@/lib/format";

describe("fmtCurrency", () => {
  it("formats a positive number as USD", () => {
    expect(fmtCurrency(1234.5)).toBe("$1,234.50");
  });

  it("formats zero", () => {
    expect(fmtCurrency(0)).toBe("$0.00");
  });

  it("falls back to $0.00 for null/undefined/NaN", () => {
    expect(fmtCurrency(null)).toBe("$0.00");
    expect(fmtCurrency(undefined)).toBe("$0.00");
    expect(fmtCurrency(NaN)).toBe("$0.00");
  });

  it("formats negative amounts", () => {
    expect(fmtCurrency(-42)).toBe("-$42.00");
  });
});

describe("fmtCurrencyShort", () => {
  it("abbreviates amounts over 1000 with a 'k' suffix", () => {
    expect(fmtCurrencyShort(2500)).toBe("$2.5k");
  });

  it("keeps the negative sign on an abbreviated amount", () => {
    expect(fmtCurrencyShort(-2500)).toBe("-$2.5k");
  });

  it("doesn't abbreviate amounts under 1000", () => {
    expect(fmtCurrencyShort(999)).toBe("$999.00");
  });
});

describe("fmtCurrencyWhole", () => {
  it("formats without cents", () => {
    expect(fmtCurrencyWhole(1234.99)).toBe("$1,235");
  });

  it("falls back to $0 for null/NaN", () => {
    expect(fmtCurrencyWhole(null)).toBe("$0");
    expect(fmtCurrencyWhole(NaN)).toBe("$0");
  });
});

describe("fmtDateShort", () => {
  it("formats an ISO date", () => {
    expect(fmtDateShort("2026-03-05")).toBe("Mar 5, 2026");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(fmtDateShort(null)).toBe("");
    expect(fmtDateShort(undefined)).toBe("");
    expect(fmtDateShort("")).toBe("");
  });
});

describe("monthKey / monthLabel / quarterKey / yearKey", () => {
  it("derives a YYYY-MM month key from an ISO date", () => {
    expect(monthKey("2026-03-05")).toBe("2026-03");
  });

  it("formats a month key as a short label", () => {
    expect(monthLabel("2026-03")).toBe("Mar 26");
  });

  it("derives a quarter key from an ISO date", () => {
    expect(quarterKey("2026-01-15")).toBe("2026-Q1");
    expect(quarterKey("2026-04-01")).toBe("2026-Q2");
    expect(quarterKey("2026-12-31")).toBe("2026-Q4");
  });

  it("derives a year key from an ISO date", () => {
    expect(yearKey("2026-03-05")).toBe("2026");
  });
});
