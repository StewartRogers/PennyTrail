import { describe, expect, it } from "vitest";
import { guessMapping, parseAmount, parseCSV, parseDateFlexible } from "@/lib/csv";

describe("parseCSV quote handling", () => {
  // A quote only opens a quoted field at the start of a field. Previously any
  // bare `"` opened quote mode, so one inch-mark swallowed the rest of the file.
  it("treats a mid-field quote as a literal character", () => {
    const rows = parseCSV('Date,Description,Amount\n2026-01-02,BEST BUY 21" TV,100.00\n2026-01-03,COFFEE,5.00');

    expect(rows).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-01-02", 'BEST BUY 21" TV', "100.00"],
      ["2026-01-03", "COFFEE", "5.00"],
    ]);
  });

  it("still parses properly quoted fields, including commas and escaped quotes", () => {
    const rows = parseCSV('Date,Description\n2026-01-02,"SMITH, JOHN"\n2026-01-03,"SAY ""HI"""');

    expect(rows).toEqual([
      ["Date", "Description"],
      ["2026-01-02", "SMITH, JOHN"],
      ["2026-01-03", 'SAY "HI"'],
    ]);
  });

  it("still handles a newline inside a quoted field", () => {
    const rows = parseCSV('Date,Description\n2026-01-02,"LINE ONE\nLINE TWO"');

    expect(rows).toEqual([
      ["Date", "Description"],
      ["2026-01-02", "LINE ONE\nLINE TWO"],
    ]);
  });
});

describe("parseDateFlexible calendar validation", () => {
  it.each([
    ["02/30/2026", "MM/DD/YYYY"],
    ["04/31/2026", "MM/DD/YYYY"],
    ["2026-02-31", "YYYY-MM-DD"],
    ["31/04/2026", "DD/MM/YYYY"],
    ["02/29/2027", "MM/DD/YYYY"],
  ])("rejects the impossible date %s", (input, format) => {
    expect(parseDateFlexible(input, format)).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(parseDateFlexible("02/29/2028", "MM/DD/YYYY")).toBe("2028-02-29");
  });

  it("still parses ordinary dates", () => {
    expect(parseDateFlexible("03/05/2026", "MM/DD/YYYY")).toBe("2026-03-05");
    expect(parseDateFlexible("05/03/2026", "DD/MM/YYYY")).toBe("2026-03-05");
    expect(parseDateFlexible("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
  });
});

describe("parseAmount separator handling", () => {
  it("reads US grouping", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("1,234")).toBe(1234);
  });

  it("reads a decimal comma", () => {
    expect(parseAmount("12,34")).toBe(12.34);
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("refuses a corrupt mixed-separator cell rather than inventing a number", () => {
    // Previously 1.234 — a plausible-looking value that got imported.
    expect(parseAmount("1.234.56")).toBeNaN();
  });

  it("reads European grouping when every group is well formed", () => {
    expect(parseAmount("1.234.567")).toBe(1234567);
  });

  it("detects accounting parentheses even when a symbol precedes them", () => {
    expect(parseAmount("($1,234.56)")).toBe(-1234.56);
    expect(parseAmount("$(1,234.56)")).toBe(-1234.56);
    expect(parseAmount("(1,234.56)")).toBe(-1234.56);
  });

  it("still handles plain and negative values", () => {
    expect(parseAmount("100.00")).toBe(100);
    expect(parseAmount("-42.50")).toBe(-42.5);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
  });
});

describe("guessMapping", () => {
  it("prefers the transaction date over the posting date regardless of column order", () => {
    const headers = ["Post Date", "Transaction Date", "Description", "Amount"];

    expect(guessMapping(headers).dateCol).toBe(1);
  });

  it("does not map one combined Debit/Credit column as both amount columns", () => {
    const mapping = guessMapping(["Date", "Description", "Debit/Credit", "Amount"]);

    expect(mapping.debitCol).toBe(-1);
    expect(mapping.creditCol).toBe(-1);
    expect(mapping.amountCol).toBe(3);
  });

  it("still maps genuinely separate debit and credit columns", () => {
    const mapping = guessMapping(["Date", "Description", "Debit", "Credit"]);

    expect(mapping.debitCol).toBe(2);
    expect(mapping.creditCol).toBe(3);
  });
});
