import { describe, expect, it } from "vitest";
import {
  canadianBankHolidays,
  defaultBankHolidays,
  easterSunday,
  isBusinessDay,
  nextBusinessDay,
  nthWeekdayOfMonth,
  previousBusinessDay,
  rollToBusinessDay,
} from "@/lib/businessDays";

const holidays2026 = new Set(defaultBankHolidays(2026, 2027));

function datesFor(year: number): Record<string, string> {
  return Object.fromEntries(canadianBankHolidays(year).map((h) => [h.name, h.date]));
}

describe("easterSunday", () => {
  it.each([
    [2008, "2008-03-23"],
    [2019, "2019-04-21"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"], // the latest possible date
  ])("%i is %s", (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe("nthWeekdayOfMonth", () => {
  it("finds the nth weekday", () => {
    expect(nthWeekdayOfMonth(2026, 10, 1, 2)).toBe("2026-10-12"); // Thanksgiving
    expect(nthWeekdayOfMonth(2026, 11, 5, 1)).toBe("2026-11-06"); // first Friday
    expect(nthWeekdayOfMonth(2026, 5, 5, 1)).toBe("2026-05-01"); // the 1st itself
  });

  it("rejects a weekday the month doesn't have", () => {
    expect(() => nthWeekdayOfMonth(2026, 2, 1, 5)).toThrow();
  });
});

describe("canadianBankHolidays", () => {
  it("lists 2026's dates", () => {
    expect(datesFor(2026)).toEqual({
      "New Year's Day": "2026-01-01",
      "Family Day": "2026-02-16",
      "Good Friday": "2026-04-03",
      "Victoria Day": "2026-05-18",
      "Canada Day": "2026-07-01",
      "BC Day": "2026-08-03",
      "Labour Day": "2026-09-07",
      "National Day for Truth and Reconciliation": "2026-09-30",
      Thanksgiving: "2026-10-12",
      "Remembrance Day": "2026-11-11",
      "Christmas Day": "2026-12-25",
      // Saturday, so observed the next Monday
      "Boxing Day (observed)": "2026-12-28",
    });
  });

  it("moves weekend holidays to the next free weekday (2022–2023)", () => {
    const y2022 = datesFor(2022);
    // Boxing Day is Monday the 26th itself, so Christmas (a Sunday) is
    // observed on the next free weekday, Tuesday the 27th.
    expect(y2022["Boxing Day"]).toBe("2022-12-26");
    expect(y2022["Christmas Day (observed)"]).toBe("2022-12-27");
    const y2023 = datesFor(2023);
    expect(y2023["New Year's Day (observed)"]).toBe("2023-01-02");
    expect(y2023["Canada Day (observed)"]).toBe("2023-07-03");
    expect(y2023["National Day for Truth and Reconciliation (observed)"]).toBe("2023-10-02");
    expect(y2023["Remembrance Day (observed)"]).toBe("2023-11-13");
  });

  it("handles Christmas on a Saturday (2027)", () => {
    const y2027 = datesFor(2027);
    expect(y2027["Christmas Day (observed)"]).toBe("2027-12-27");
    expect(y2027["Boxing Day (observed)"]).toBe("2027-12-28");
  });

  it("puts Victoria Day on the Monday before May 25, even when the 24th is a Monday", () => {
    expect(datesFor(2021)["Victoria Day"]).toBe("2021-05-24");
    expect(datesFor(2025)["Victoria Day"]).toBe("2025-05-19");
  });

  it("never returns a weekend date", () => {
    for (let year = 2020; year <= 2035; year++) {
      for (const h of canadianBankHolidays(year)) {
        const day = new Date(h.date + "T00:00:00Z").getUTCDay();
        expect(day === 0 || day === 6, `${h.name} ${h.date}`).toBe(false);
      }
    }
  });

  it("builds a sorted, de-duplicated multi-year list", () => {
    const list = defaultBankHolidays(2026, 2027);
    expect(list).toHaveLength(24);
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("business days", () => {
  it("excludes weekends and holidays", () => {
    expect(isBusinessDay("2026-10-16", holidays2026)).toBe(true);
    expect(isBusinessDay("2026-10-17", holidays2026)).toBe(false); // Saturday
    expect(isBusinessDay("2026-10-12", holidays2026)).toBe(false); // Thanksgiving
  });

  it("rolls forward past a weekend and a holiday Monday", () => {
    expect(nextBusinessDay("2026-10-10", holidays2026)).toBe("2026-10-13");
    expect(nextBusinessDay("2026-10-31", holidays2026)).toBe("2026-11-02");
    expect(nextBusinessDay("2026-09-30", holidays2026)).toBe("2026-10-01");
    expect(nextBusinessDay("2026-10-16", holidays2026)).toBe("2026-10-16"); // already one
  });

  it("rolls back past a weekend and Good Friday", () => {
    expect(previousBusinessDay("2026-10-31", holidays2026)).toBe("2026-10-30");
    expect(previousBusinessDay("2026-04-05", holidays2026)).toBe("2026-04-02");
    expect(previousBusinessDay("2026-11-15", holidays2026)).toBe("2026-11-13");
  });

  it("rolls the Christmas week across both observed days", () => {
    expect(nextBusinessDay("2026-12-25", holidays2026)).toBe("2026-12-29");
    expect(previousBusinessDay("2026-12-28", holidays2026)).toBe("2026-12-24");
    expect(nextBusinessDay("2027-01-01", holidays2026)).toBe("2027-01-04");
  });

  it("applies each roll rule", () => {
    expect(rollToBusinessDay("2026-10-31", "next", holidays2026)).toBe("2026-11-02");
    expect(rollToBusinessDay("2026-10-31", "previous", holidays2026)).toBe("2026-10-30");
    expect(rollToBusinessDay("2026-10-31", "none", holidays2026)).toBe("2026-10-31");
  });

  it("treats an empty holiday list as weekends only", () => {
    expect(nextBusinessDay("2026-10-12", new Set())).toBe("2026-10-12");
  });
});
