import { describe, expect, it } from "vitest";
import { occurrencesBetween, resolveDayOfMonth } from "@/lib/recurrence";

describe("resolveDayOfMonth", () => {
  it("clamps days past the end of the month", () => {
    expect(resolveDayOfMonth("2026-02", 31)).toBe("2026-02-28");
    expect(resolveDayOfMonth("2024-02", 31)).toBe("2024-02-29");
    expect(resolveDayOfMonth("2026-04", 31)).toBe("2026-04-30");
    expect(resolveDayOfMonth("2026-04", 0)).toBe("2026-04-01");
  });

  it("resolves 'last'", () => {
    expect(resolveDayOfMonth("2026-02", "last")).toBe("2026-02-28");
    expect(resolveDayOfMonth("2024-02", "last")).toBe("2024-02-29");
    expect(resolveDayOfMonth("2026-10", "last")).toBe("2026-10-31");
  });
});

describe("occurrencesBetween", () => {
  it("monthly", () => {
    expect(occurrencesBetween({ type: "monthly", day: 15 }, "2026-01-01", "2026-03-31")).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
  });

  it("monthly on the 31st never skips a short month", () => {
    expect(occurrencesBetween({ type: "monthly", day: 31 }, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("includes both ends of the range", () => {
    expect(occurrencesBetween({ type: "monthly", day: 1 }, "2026-10-01", "2026-11-01")).toEqual(["2026-10-01", "2026-11-01"]);
    expect(occurrencesBetween({ type: "monthly", day: 15 }, "2026-10-16", "2026-11-14")).toEqual([]);
  });

  it("semi-monthly on the 15th and last day, in a leap February (KA's pay)", () => {
    expect(occurrencesBetween({ type: "semiMonthly", days: [15, "last"] }, "2024-02-01", "2024-03-31")).toEqual([
      "2024-02-15",
      "2024-02-29",
      "2024-03-15",
      "2024-03-31",
    ]);
  });

  it("semi-monthly days that clamp to the same date count once", () => {
    expect(occurrencesBetween({ type: "semiMonthly", days: [30, "last"] }, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
  });

  it("every 2 months from an anchor (BC Hydro)", () => {
    const hydro = { type: "everyNMonths" as const, n: 2, day: 23, anchorMonth: "2026-10" };
    expect(occurrencesBetween(hydro, "2026-07-01", "2027-02-28")).toEqual(["2026-08-23", "2026-10-23", "2026-12-23", "2027-02-23"]);
  });

  it("every 2 months with the anchor after the range", () => {
    const rec = { type: "everyNMonths" as const, n: 2, day: 1, anchorMonth: "2026-12" };
    expect(occurrencesBetween(rec, "2026-01-01", "2026-06-30")).toEqual(["2026-02-01", "2026-04-01", "2026-06-01"]);
  });

  it("every 2 weeks gives three paydays in October 2026 (SR's pay)", () => {
    const sr = { type: "everyNWeeks" as const, n: 2, anchorDate: "2026-10-15" };
    expect(occurrencesBetween(sr, "2026-10-01", "2026-10-31")).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
    expect(occurrencesBetween(sr, "2026-11-01", "2026-11-30")).toEqual(["2026-11-12", "2026-11-26"]);
  });

  it("every 2 weeks works before the anchor and across a year boundary", () => {
    const sr = { type: "everyNWeeks" as const, n: 2, anchorDate: "2026-10-15" };
    expect(occurrencesBetween(sr, "2026-09-01", "2026-09-30")).toEqual(["2026-09-03", "2026-09-17"]);
    expect(occurrencesBetween(sr, "2026-12-01", "2027-01-31")).toEqual(["2026-12-10", "2026-12-24", "2027-01-07", "2027-01-21"]);
  });

  it("every 2 weeks over a full year gives 26 dates, all 14 days apart", () => {
    const sr = { type: "everyNWeeks" as const, n: 2, anchorDate: "2026-10-15" };
    const dates = occurrencesBetween(sr, "2026-01-01", "2026-12-31");
    expect(dates).toHaveLength(26);
    for (let i = 1; i < dates.length; i++) {
      const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
      expect(gap).toBe(14);
    }
  });

  it("once", () => {
    expect(occurrencesBetween({ type: "once", date: "2026-10-19" }, "2026-10-01", "2026-10-31")).toEqual(["2026-10-19"]);
    expect(occurrencesBetween({ type: "once", date: "2026-11-19" }, "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("an inverted range is empty", () => {
    expect(occurrencesBetween({ type: "monthly", day: 1 }, "2026-11-01", "2026-10-01")).toEqual([]);
  });
});
