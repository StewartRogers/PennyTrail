import { describe, expect, it } from "vitest";
import { parseCSV, parseAmount, parseDateFlexible, guessMapping } from "@/lib/csv";

describe("parseCSV", () => {
  it("parses a simple comma-separated grid", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCSV('a,"b, with comma",c\n1,2,3')).toEqual([
      ["a", "b, with comma", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles escaped double quotes inside a quoted field", () => {
    expect(parseCSV('a,"say ""hi""",c')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("handles CRLF and bare LF line endings", () => {
    expect(parseCSV("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops fully-blank rows", () => {
    expect(parseCSV("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseAmount", () => {
  it("parses a plain positive number", () => {
    expect(parseAmount("42.50")).toBe(42.5);
  });

  it("treats parenthesized amounts as negative", () => {
    expect(parseAmount("(12.34)")).toBe(-12.34);
  });

  it("strips currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
  });

  it("respects a leading ascii minus sign", () => {
    expect(parseAmount("-99.99")).toBe(-99.99);
  });

  it("normalizes a unicode minus sign (U+2212) to negative", () => {
    expect(parseAmount("−12.00")).toBe(-12);
  });

  it("normalizes an en dash used as a minus sign", () => {
    expect(parseAmount("–12.00")).toBe(-12);
  });

  it("does not double-flip sign on a malformed double hyphen", () => {
    expect(parseAmount("--5")).toBe(-5);
  });

  it("returns NaN for empty or non-numeric input", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
    expect(parseAmount(undefined)).toBeNaN();
  });
});

describe("parseDateFlexible", () => {
  it("parses MM/DD/YYYY", () => {
    expect(parseDateFlexible("03/05/2026", "MM/DD/YYYY")).toBe("2026-03-05");
  });

  it("parses DD/MM/YYYY", () => {
    expect(parseDateFlexible("05/03/2026", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("parses YYYY-MM-DD", () => {
    expect(parseDateFlexible("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
  });

  it("expands a two-digit year for MM/DD/YY", () => {
    expect(parseDateFlexible("03/05/26", "MM/DD/YYYY")).toBe("2026-03-05");
  });

  it("expands a two-digit year for DD/MM/YY too, not just the default format", () => {
    expect(parseDateFlexible("05/03/26", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("expands a two-digit year for YYYY-MM-DD given a 2-digit leading component", () => {
    expect(parseDateFlexible("26-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
  });

  it("rejects an out-of-range month", () => {
    expect(parseDateFlexible("13/05/2026", "MM/DD/YYYY")).toBeNull();
  });

  it("rejects an out-of-range day", () => {
    expect(parseDateFlexible("02/32/2026", "MM/DD/YYYY")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseDateFlexible("", "MM/DD/YYYY")).toBeNull();
    expect(parseDateFlexible(null, "MM/DD/YYYY")).toBeNull();
  });

  it("returns null when a component is missing", () => {
    expect(parseDateFlexible("03/2026", "MM/DD/YYYY")).toBeNull();
  });

  it("parses a full month name with a comma", () => {
    expect(parseDateFlexible("May 21, 2026", "Month DD, YYYY")).toBe("2026-05-21");
  });

  it("parses a full month name without a comma", () => {
    expect(parseDateFlexible("May 21 2026", "Month DD, YYYY")).toBe("2026-05-21");
  });

  it("parses an abbreviated month name", () => {
    expect(parseDateFlexible("Jan 5, 2026", "Month DD, YYYY")).toBe("2026-01-05");
  });

  it("is case-insensitive for the month name", () => {
    expect(parseDateFlexible("december 25, 2026", "Month DD, YYYY")).toBe("2026-12-25");
  });

  it("rejects an unrecognized month name", () => {
    expect(parseDateFlexible("Frobuary 5, 2026", "Month DD, YYYY")).toBeNull();
  });

  it("rejects an out-of-range day for Month DD, YYYY", () => {
    expect(parseDateFlexible("Feb 30, 2026", "Month DD, YYYY")).toBeNull();
  });

  it("parses YYYYMMDD", () => {
    expect(parseDateFlexible("20260813", "YYYYMMDD")).toBe("2026-08-13");
  });

  it("rejects YYYYMMDD with the wrong number of digits", () => {
    expect(parseDateFlexible("2026813", "YYYYMMDD")).toBeNull();
    expect(parseDateFlexible("202608130", "YYYYMMDD")).toBeNull();
  });

  it("rejects an out-of-range month for YYYYMMDD", () => {
    expect(parseDateFlexible("20261301", "YYYYMMDD")).toBeNull();
  });

  it("rejects a calendar-impossible day for YYYYMMDD", () => {
    expect(parseDateFlexible("20260230", "YYYYMMDD")).toBeNull();
  });

  it("parses YYYY-MM-DD HH:MM:SS, discarding the time", () => {
    expect(parseDateFlexible("2026-03-24 23:43:39", "YYYY-MM-DD HH:MM:SS")).toBe("2026-03-24");
  });

  it("also accepts a T separator (ISO 8601 datetime)", () => {
    expect(parseDateFlexible("2026-03-24T23:43:39", "YYYY-MM-DD HH:MM:SS")).toBe("2026-03-24");
  });

  it("accepts the date-time format even without seconds", () => {
    expect(parseDateFlexible("2026-03-24 23:43", "YYYY-MM-DD HH:MM:SS")).toBe("2026-03-24");
  });

  it("rejects a bare date with no time for YYYY-MM-DD HH:MM:SS", () => {
    expect(parseDateFlexible("2026-03-24", "YYYY-MM-DD HH:MM:SS")).toBeNull();
  });

  it("rejects a calendar-impossible date for YYYY-MM-DD HH:MM:SS", () => {
    expect(parseDateFlexible("2026-02-30 12:00:00", "YYYY-MM-DD HH:MM:SS")).toBeNull();
  });
});

describe("guessMapping", () => {
  it("guesses common header names", () => {
    const headers = ["Transaction Date", "Description", "Amount"];
    expect(guessMapping(headers)).toEqual({
      dateCol: 0,
      descCol: 1,
      amountCol: 2,
      debitCol: -1,
      creditCol: -1,
      categoryCol: -1,
      typeCol: -1,
    });
  });

  it("finds split debit/credit columns", () => {
    const headers = ["Date", "Details", "Debit", "Credit"];
    const guess = guessMapping(headers);
    expect(guess.debitCol).toBe(2);
    expect(guess.creditCol).toBe(3);
  });

  it("returns -1 for columns it can't find", () => {
    const guess = guessMapping(["Col A", "Col B"]);
    expect(guess.dateCol).toBe(-1);
    expect(guess.descCol).toBe(-1);
  });

  it("falls back to substring matching when no exact header matches", () => {
    const guess = guessMapping(["Post Date", "Merchant Name"]);
    expect(guess.dateCol).toBe(0);
    expect(guess.descCol).toBe(1);
  });
});
