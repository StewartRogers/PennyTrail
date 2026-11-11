import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  isValidMonthKey,
  monthEnd,
  monthIndex,
  monthKeyOf,
  monthStart,
} from "@/lib/dates";

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("is exact across DST changes (Mar 8 and Nov 1, 2026 in Canada)", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-01", 14)).toBe("2026-03-15");
  });

  it("handles large steps", () => {
    expect(addDays("2024-01-01", 366)).toBe("2025-01-01"); // 2024 is a leap year
    expect(addDays("2025-01-01", 365)).toBe("2026-01-01");
  });
});

describe("daysBetween", () => {
  it("counts whole days, signed", () => {
    expect(daysBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(daysBetween("2026-10-02", "2026-10-01")).toBe(-1);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(28);
    expect(daysBetween("2024-02-01", "2024-03-01")).toBe(29);
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31); // spans the DST change
  });
});

describe("dayOfWeek", () => {
  it("returns 0 for Sunday through 6 for Saturday", () => {
    expect(dayOfWeek("2026-10-18")).toBe(0);
    expect(dayOfWeek("2026-10-02")).toBe(5);
    expect(dayOfWeek("2026-10-31")).toBe(6);
    expect(dayOfWeek("2024-01-01")).toBe(1);
  });
});

describe("month helpers", () => {
  it("knows month lengths, including leap Februaries", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // century rule
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("finds a month's first and last day", () => {
    expect(monthStart("2026-11")).toBe("2026-11-01");
    expect(monthEnd("2026-11")).toBe("2026-11-30");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
  });

  it("adds months across years in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 14)).toBe("2027-12");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
  });

  it("orders months by index", () => {
    expect(monthIndex("2026-01") - monthIndex("2025-12")).toBe(1);
    expect(monthIndex("2027-03") - monthIndex("2026-03")).toBe(12);
  });

  it("validates month keys", () => {
    expect(isValidMonthKey("2026-10")).toBe(true);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-1")).toBe(false);
    expect(isValidMonthKey(202610)).toBe(false);
  });

  it("takes the month of a date", () => {
    expect(monthKeyOf("2026-10-31")).toBe("2026-10");
    expect(() => monthKeyOf("10/31/2026")).toThrow();
  });
});
