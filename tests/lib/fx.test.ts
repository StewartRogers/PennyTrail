import { describe, expect, it } from "vitest";
import { addDaysISO, enumerateDatesISO, fxSeriesName, resolveDailyRates } from "@/lib/fx";

describe("fxSeriesName", () => {
  it("builds the Bank of Canada series name, uppercasing the code", () => {
    expect(fxSeriesName("mxn")).toBe("FXMXNCAD");
    expect(fxSeriesName("USD")).toBe("FXUSDCAD");
  });
});

describe("addDaysISO", () => {
  it("adds days within a month", () => {
    expect(addDaysISO("2026-03-05", 3)).toBe("2026-03-08");
  });

  it("rolls over a month boundary", () => {
    expect(addDaysISO("2026-03-30", 3)).toBe("2026-04-02");
  });

  it("subtracts days (negative offset), rolling back over a month boundary", () => {
    expect(addDaysISO("2026-03-02", -5)).toBe("2026-02-25");
  });

  it("rolls over a year boundary", () => {
    expect(addDaysISO("2025-12-30", 3)).toBe("2026-01-02");
  });
});

describe("enumerateDatesISO", () => {
  it("lists every date in an inclusive range", () => {
    expect(enumerateDatesISO("2026-03-05", "2026-03-08")).toEqual(["2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
  });

  it("returns a single date when start equals end", () => {
    expect(enumerateDatesISO("2026-03-05", "2026-03-05")).toEqual(["2026-03-05"]);
  });
});

describe("resolveDailyRates", () => {
  it("uses the exact observation when one exists for the date", () => {
    const observations = [{ date: "2026-03-05", rate: 0.5 }];
    const result = resolveDailyRates(observations, ["2026-03-05"]);
    expect(result.get("2026-03-05")).toBe(0.5);
  });

  // Weekends/holidays have no observation of their own — carries forward
  // the most recent prior business day's rate, same as a statement does.
  it("carries the most recent prior observation forward across a gap", () => {
    const observations = [
      { date: "2026-03-05", rate: 0.5 },
      { date: "2026-03-09", rate: 0.55 },
    ];
    const result = resolveDailyRates(observations, ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(result.get("2026-03-06")).toBe(0.5);
    expect(result.get("2026-03-07")).toBe(0.5);
    expect(result.get("2026-03-08")).toBe(0.5);
    expect(result.get("2026-03-09")).toBe(0.55);
  });

  it("returns null for a date before the earliest observation", () => {
    const observations = [{ date: "2026-03-05", rate: 0.5 }];
    const result = resolveDailyRates(observations, ["2026-03-01"]);
    expect(result.get("2026-03-01")).toBeNull();
  });

  it("does not require observations to already be sorted", () => {
    const observations = [
      { date: "2026-03-09", rate: 0.55 },
      { date: "2026-03-05", rate: 0.5 },
    ];
    const result = resolveDailyRates(observations, ["2026-03-06"]);
    expect(result.get("2026-03-06")).toBe(0.5);
  });
});
