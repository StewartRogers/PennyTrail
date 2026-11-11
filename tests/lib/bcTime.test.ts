import { describe, expect, it } from "vitest";
import { bcTimeZone, bcTodayIso, bcYearMonth, fmtBcDateTime } from "@/lib/bcTime";

// These pin BC's clock independent of the machine running the tests — on
// Vercel the server is in UTC, and a device's zone data may predate the change.
describe("BC time", () => {
  it("shows a time on BC's permanent UTC−7 clock as PCT, including in November", () => {
    expect(fmtBcDateTime("2026-11-11T20:42:00.000Z")).toBe("Nov 11, 2026, 1:42 p.m. PCT");
    expect(fmtBcDateTime("2027-01-15T20:00:00.000Z")).toBe("Jan 15, 2027, 1:00 p.m. PCT");
  });

  it("uses the old Pacific rules, labelled PST or PDT, before 8 March 2026", () => {
    expect(fmtBcDateTime("2026-01-15T20:00:00.000Z")).toBe("Jan 15, 2026, 12:00 p.m. PST"); // UTC−8
    expect(fmtBcDateTime("2025-07-01T20:00:00.000Z")).toBe("Jul 1, 2025, 1:00 p.m. PDT"); // UTC−7
    expect(bcTimeZone(new Date("2026-03-08T09:59:59Z"))).toBe("America/Vancouver");
    expect(bcTimeZone(new Date("2026-03-08T10:00:00Z"))).toBe("Etc/GMT+7");
  });

  it("turns the day over at midnight in BC, not in UTC", () => {
    // 11:30 p.m. Nov 11 in BC is already Nov 12 in UTC.
    expect(bcTodayIso(new Date("2026-11-12T06:30:00Z"))).toBe("2026-11-11");
    expect(bcTodayIso(new Date("2026-11-12T07:30:00Z"))).toBe("2026-11-12");
    // New Year's Eve evening is still the old year.
    expect(bcYearMonth(new Date("2027-01-01T05:00:00Z"))).toEqual({ year: 2026, month: 12 });
  });
});
