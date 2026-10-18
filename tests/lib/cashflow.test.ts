import { describe, expect, it } from "vitest";
import {
  defaultCheckpointDates,
  defaultPeriods,
  entryDate,
  expectedAmountFor,
  generateMonthEntries,
  isOverdue,
  needsScheduling,
  periodIndexForDate,
  periodSpans,
  periodSpend,
  propagateCarriedOpenings,
  sortPeriods,
  startMonth,
  summarizeMonth,
} from "@/lib/cashflow";
import { defaultBankHolidays } from "@/lib/businessDays";
import type { BankAccount, CashFlowEntry, CashFlowItem, CashFlowMonth } from "@/lib/types";

let seq = 0;
const newId = (prefix = "id") => `${prefix}_${++seq}`;

function month(overrides: Partial<CashFlowMonth> = {}): CashFlowMonth {
  const key = overrides.month ?? "2026-10";
  return {
    id: "m_oct",
    accountId: "acct",
    month: key,
    openingBalance: 10000,
    openingSource: "manual",
    dailySpendRate: 50,
    periods: defaultPeriods(key, () => newId("p")),
    closed: false,
    ...overrides,
  };
}

function entry(overrides: Partial<CashFlowEntry>): CashFlowEntry {
  return {
    id: newId("e"),
    monthId: "m_oct",
    itemId: null,
    name: "Entry",
    kind: "bill",
    dueDate: overrides.postingDate ?? "2026-10-01",
    postingDate: "2026-10-01",
    expectedAmount: 0,
    status: "planned",
    ...overrides,
  };
}

function item(overrides: Partial<CashFlowItem>): CashFlowItem {
  return {
    id: newId("item"),
    accountId: "acct",
    name: "Item",
    kind: "bill",
    amountMode: "fixed",
    defaultAmount: 100,
    recurrence: { type: "monthly", day: 1 },
    roll: "next",
    settlement: "manual",
    active: true,
    ...overrides,
  };
}

const account: BankAccount = {
  id: "acct",
  name: "Chequing",
  institution: "Bank",
  last4: "0000",
  color: "oklch(0.55 0.13 250)",
  dailySpendRate: 50,
  bankHolidays: defaultBankHolidays(2024, 2027),
};

describe("checkpoints and periods", () => {
  it.each([
    ["2024-01", ["2024-01-05", "2024-01-12", "2024-01-31"]],
    ["2025-06", ["2025-06-06", "2025-06-13", "2025-06-30"]],
    ["2026-10", ["2026-10-02", "2026-10-09", "2026-10-31"]],
    ["2026-11", ["2026-11-06", "2026-11-13", "2026-11-30"]],
    ["2026-05", ["2026-05-01", "2026-05-08", "2026-05-31"]], // starts on a Friday
    ["2024-02", ["2024-02-02", "2024-02-09", "2024-02-29"]],
  ])("%s defaults to the first Friday, second Friday, and month end", (key, dates) => {
    expect(defaultCheckpointDates(key)).toEqual(dates);
  });

  it("counts period days inclusively, matching the spreadsheet's Weekly Spend", () => {
    // $50 × 2, 7, 22 days = 100, 350, 1100 — the October 2026 sheet's estimates.
    const m = month();
    const spans = periodSpans(m.month, sortPeriods(m.periods));
    expect(spans.map((s) => s.days)).toEqual([2, 7, 22]);
    expect(spans.map((s, i) => periodSpend(sortPeriods(m.periods)[i], s, 50))).toEqual([100, 350, 1100]);
    // January 2024: 5, 7, 19 days = 250, 350, 950.
    const jan = month({ month: "2024-01", periods: defaultPeriods("2024-01", () => newId("p")) });
    expect(periodSpans(jan.month, sortPeriods(jan.periods)).map((s) => s.days)).toEqual([5, 7, 19]);
    // A month that starts on a Friday has a one-day first period.
    const may = month({ month: "2026-05", periods: defaultPeriods("2026-05", () => newId("p")) });
    expect(periodSpans(may.month, sortPeriods(may.periods)).map((s) => s.days)).toEqual([1, 7, 23]);
  });

  it("every month's periods add up to the days in the month", () => {
    for (let y = 2024; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        const spans = periodSpans(key, sortPeriods(defaultPeriods(key, () => newId("p"))));
        const total = spans.reduce((sum, s) => sum + s.days, 0);
        expect(total).toBe(new Date(Date.UTC(y, m, 0)).getUTCDate());
      }
    }
  });

  it("multiplies the daily rate in cents, so odd rates stay exact", () => {
    const m = month();
    const p = sortPeriods(m.periods)[2];
    const span = periodSpans(m.month, sortPeriods(m.periods))[2];
    expect(periodSpend(p, span, 33.33)).toBe(733.26); // 22 × 33.33
    expect(periodSpend(p, span, 0.1)).toBe(2.2);
  });

  it("uses an override instead of the rate when set, including zero", () => {
    const m = month();
    const span = periodSpans(m.month, sortPeriods(m.periods))[0];
    expect(periodSpend({ ...m.periods[0], spendOverride: 275 }, span, 50)).toBe(275);
    expect(periodSpend({ ...m.periods[0], spendOverride: 0 }, span, 50)).toBe(0);
  });

  it("assigns a checkpoint date to its own period and later dates to the next", () => {
    const m = month();
    const spans = periodSpans(m.month, sortPeriods(m.periods));
    expect(periodIndexForDate("2026-10-01", spans)).toBe(0);
    expect(periodIndexForDate("2026-10-02", spans)).toBe(0);
    expect(periodIndexForDate("2026-10-03", spans)).toBe(1);
    expect(periodIndexForDate("2026-10-09", spans)).toBe(1);
    expect(periodIndexForDate("2026-10-10", spans)).toBe(2);
    expect(periodIndexForDate("2026-11-02", spans)).toBe(2); // past the month: last period
    expect(periodIndexForDate("2026-09-30", spans)).toBe(0); // before it: first
  });
});

describe("entry helpers", () => {
  it("uses the posted date once there is one", () => {
    expect(entryDate({ postingDate: "2026-10-09" })).toBe("2026-10-09");
    expect(entryDate({ postingDate: "2026-10-09", postedDate: "2026-10-13" })).toBe("2026-10-13");
  });

  it("only flags manual planned bills as needing scheduling", () => {
    expect(needsScheduling({ kind: "bill", status: "planned", settlement: "manual" })).toBe(true);
    expect(needsScheduling({ kind: "bill", status: "planned" })).toBe(true); // manual by default
    expect(needsScheduling({ kind: "bill", status: "planned", settlement: "auto" })).toBe(false);
    expect(needsScheduling({ kind: "bill", status: "planned", settlement: "external" })).toBe(false);
    expect(needsScheduling({ kind: "bill", status: "scheduled", settlement: "manual" })).toBe(false);
    expect(needsScheduling({ kind: "deposit", status: "planned", settlement: "manual" })).toBe(false);
  });

  it("calls an outstanding entry overdue once its date has passed, scheduled or not", () => {
    expect(isOverdue({ status: "planned", postingDate: "2026-10-17" }, "2026-10-18")).toBe(true);
    expect(isOverdue({ status: "scheduled", postingDate: "2026-10-17" }, "2026-10-18")).toBe(true);
    expect(isOverdue({ status: "planned", postingDate: "2026-10-18" }, "2026-10-18")).toBe(false);
    expect(isOverdue({ status: "posted", postingDate: "2026-10-01" }, "2026-10-18")).toBe(false);
    expect(isOverdue({ status: "skipped", postingDate: "2026-10-01" }, "2026-10-18")).toBe(false);
  });
});

describe("summarizeMonth", () => {
  // Invented amounts, worked by hand:
  //   P1 Oct 1–2   opening 10,000.00 − spend 100 − 1,500 + 3,000.50 − 222.47 = 11,178.03
  //                actual 11,150.01 → variance −28.02, implied spend 128.02 (64.01/day)
  //   P2 Oct 3–9   opening 11,150.01 − 350 − 28.92 − 754.30 (BMO skipped) = 10,016.79
  //   P3 Oct 10–31 opening 10,016.79 − 1,100 + 3,000.50 + 502.35 − 188.77 = 12,230.87
  function october() {
    const m = month();
    const [p1] = sortPeriods(m.periods);
    p1.actualBalance = 11150.01;
    const entries = [
      entry({ name: "Rent part 1", expectedAmount: 1500, postingDate: "2026-10-01", status: "posted", postedDate: "2026-10-01" }),
      entry({ name: "SR pay", kind: "deposit", expectedAmount: 3000.5, postingDate: "2026-10-01", status: "posted" }),
      entry({ name: "CIBC", expectedAmount: 200, actualAmount: 222.47, postingDate: "2026-10-01", status: "posted" }),
      entry({ name: "Insurance", expectedAmount: 28.92, postingDate: "2026-10-09", status: "posted" }),
      entry({ name: "Simplii", expectedAmount: 754.3, postingDate: "2026-10-09", status: "scheduled" }),
      entry({ name: "BMO Porter", expectedAmount: 0, postingDate: "2026-10-09", status: "skipped" }),
      entry({ name: "SR pay", kind: "deposit", expectedAmount: 3000.5, postingDate: "2026-10-15" }),
      entry({ name: "Child Tax Benefit", kind: "deposit", expectedAmount: 502.35, postingDate: "2026-10-20", dateUncertain: true, settlement: "external" }),
      entry({ name: "BC Hydro", expectedAmount: 188.77, postingDate: "2026-10-23" }),
    ];
    return { m, entries };
  }

  it("computes each period's opening, spend, totals, and projection", () => {
    const { m, entries } = october();
    const s = summarizeMonth(m, entries);
    expect(s.periods.map((p) => [p.opening, p.spend, p.deposits, p.bills, p.projected])).toEqual([
      [10000, 100, 3000.5, 1722.47, 11178.03],
      [11150.01, 350, 0, 783.22, 10016.79],
      [10016.79, 1100, 3502.85, 188.77, 12230.87],
    ]);
  });

  it("works out the variance and implied spend at a recorded checkpoint", () => {
    const { m, entries } = october();
    const [p1, p2] = summarizeMonth(m, entries).periods;
    expect(p1.actual).toBe(11150.01);
    expect(p1.variance).toBe(-28.02);
    expect(p1.impliedSpend).toBe(128.02);
    expect(p1.impliedDailySpend).toBe(64.01);
    expect(p2.actual).toBeUndefined();
    expect(p2.variance).toBeUndefined();
  });

  it("totals the month and reconciles opening + flows + variance = close", () => {
    const { m, entries } = october();
    const s = summarizeMonth(m, entries);
    expect(s.deposits).toBe(6503.35);
    expect(s.bills).toBe(2694.46);
    expect(s.spend).toBe(1550);
    expect(s.projectedClose).toBe(12230.87);
    expect(s.closingBalance).toBe(12230.87);
    expect(s.closingIsActual).toBe(false);
    expect(s.impliedSpend).toBe(128.02);
    const reconciled = Math.round((s.opening - s.spend + s.deposits - s.bills + (s.periods[0].variance ?? 0)) * 100) / 100;
    expect(reconciled).toBe(s.closingBalance);
  });

  it("gives every row its running balance, after the Weekly Spend line", () => {
    const { m, entries } = october();
    const s = summarizeMonth(m, entries);
    expect(s.periods[0].rows.map((r) => r.balanceAfter)).toEqual([8400, 11400.5, 11178.03]);
    // A skipped row leaves the balance where it was.
    const p2 = s.periods[1].rows;
    expect(p2.map((r) => [r.entry.name, r.counted, r.balanceAfter])).toEqual([
      ["Insurance", true, 10771.09],
      ["Simplii", true, 10016.79],
      ["BMO Porter", false, 10016.79],
    ]);
  });

  it("uses the actual amount over the expected one", () => {
    const { m, entries } = october();
    const cibc = summarizeMonth(m, entries).periods[0].rows[2];
    expect(cibc.amount).toBe(222.47);
  });

  it("finds the lowest projected balance ahead, ignoring recorded periods", () => {
    const { m, entries } = october();
    // P1 is recorded. P3 opens at 10,016.79 and takes the 1,100 spend first.
    expect(summarizeMonth(m, entries).lowPoint).toEqual({ balance: 8916.79, date: "2026-10-10" });
  });

  it("assumes an uncertain deposit arrives last when finding the low point", () => {
    const m = month({ openingBalance: 1000 });
    for (const p of m.periods) p.spendOverride = 0;
    const entries = [
      entry({ name: "Benefit", kind: "deposit", expectedAmount: 500, postingDate: "2026-10-05", dateUncertain: true }),
      entry({ name: "Big bill", expectedAmount: 1200, postingDate: "2026-10-07" }),
    ];
    const s = summarizeMonth(m, entries);
    // On paper the deposit lands first (1000 + 500 − 1200 = 300 at worst),
    // but the warning must not count on it: 1000 − 1200 = −200.
    expect(s.lowPoint).toEqual({ balance: -200, date: "2026-10-07" });
    expect(s.projectedClose).toBe(300);
  });

  it("has no low point once every checkpoint is recorded", () => {
    const m = month();
    for (const p of m.periods) p.actualBalance = 5000;
    const s = summarizeMonth(m, []);
    expect(s.lowPoint).toBeNull();
    expect(s.closingIsActual).toBe(true);
    expect(s.closingBalance).toBe(5000);
  });

  it("carries a recorded checkpoint into the next period's opening", () => {
    const { m, entries } = october();
    sortPeriods(m.periods)[1].actualBalance = 10000;
    const s = summarizeMonth(m, entries);
    expect(s.periods[2].opening).toBe(10000);
    expect(s.periods[1].variance).toBe(-16.79);
    expect(s.periods[2].projected).toBe(12214.08);
  });

  it("counts an entry in the period of its posted date, not its expected one", () => {
    const m = month();
    const late = entry({ name: "Late", expectedAmount: 100, postingDate: "2026-10-09", postedDate: "2026-10-13", status: "posted" });
    const s = summarizeMonth(m, [late]);
    expect(s.periods[1].rows).toHaveLength(0);
    expect(s.periods[2].rows.map((r) => r.entry.name)).toEqual(["Late"]);
  });

  it("keeps an entry dated past the month in the last period", () => {
    const m = month();
    const rolled = entry({ name: "Rolled", expectedAmount: 10, postingDate: "2026-11-02" });
    expect(summarizeMonth(m, [rolled]).periods[2].rows).toHaveLength(1);
  });

  it("sorts periods given out of order", () => {
    const m = month();
    m.periods = [...m.periods].reverse();
    expect(summarizeMonth(m, []).periods.map((p) => p.end)).toEqual(["2026-10-02", "2026-10-09", "2026-10-31"]);
  });

  it("is exact to the cent over many small amounts", () => {
    const m = month({ openingBalance: 0.3 });
    for (const p of m.periods) p.spendOverride = 0;
    const entries = [
      entry({ kind: "deposit", expectedAmount: 0.1, postingDate: "2026-10-01" }),
      entry({ kind: "deposit", expectedAmount: 0.2, postingDate: "2026-10-01" }),
      ...Array.from({ length: 1000 }, () => entry({ kind: "deposit", expectedAmount: 0.01, postingDate: "2026-10-20" })),
      ...Array.from({ length: 333 }, () => entry({ expectedAmount: 0.03, postingDate: "2026-10-21" })),
    ];
    const s = summarizeMonth(m, entries);
    expect(s.periods[0].projected).toBe(0.6);
    expect(s.projectedClose).toBe(0.61); // 0.6 + 10.00 − 9.99
    expect(s.deposits).toBe(10.3);
    expect(s.bills).toBe(9.99);
  });

  it("totals outstanding bills, scheduled or planned, but not deposits or skipped ones", () => {
    const { m, entries } = october();
    expect(summarizeMonth(m, entries).outstandingBills).toEqual({ count: 2, total: 943.07 });
  });

  it("handles an empty month", () => {
    const s = summarizeMonth(month(), []);
    expect(s.projectedClose).toBe(8450); // 10,000 − 31 days × 50
    expect(s.deposits).toBe(0);
    expect(s.bills).toBe(0);
  });

  it("handles negative balances", () => {
    const m = month({ openingBalance: -250.55 });
    for (const p of m.periods) p.spendOverride = 0;
    const s = summarizeMonth(m, [entry({ expectedAmount: 100.45, postingDate: "2026-10-05" })]);
    expect(s.projectedClose).toBe(-351);
  });
});

describe("generateMonthEntries", () => {
  const rent1 = item({ id: "rent1", name: "152 Rent (first)", defaultAmount: 1500, recurrence: { type: "monthly", day: "last" } });
  const rent2 = item({ id: "rent2", name: "152 Rent (second)", defaultAmount: 2661, recurrence: { type: "monthly", day: 1 } });
  const sr = item({ id: "sr", name: "Stewart Pay", kind: "deposit", defaultAmount: 3000, roll: "previous", settlement: "auto", recurrence: { type: "everyNWeeks", n: 2, anchorDate: "2026-10-15" } });
  const ka = item({ id: "ka", name: "Kerri Pay", kind: "deposit", defaultAmount: 2400, roll: "previous", settlement: "auto", recurrence: { type: "semiMonthly", days: [15, "last"] } });
  const hydro = item({ id: "hydro", name: "BC Hydro", amountMode: "variable", defaultAmount: 150, recurrence: { type: "everyNMonths", n: 2, day: 23, anchorMonth: "2026-10" } });
  const ctb = item({ id: "ctb", name: "Child Tax Benefit", kind: "deposit", defaultAmount: 500, roll: "previous", settlement: "external", dateUncertain: true, recurrence: { type: "monthly", day: 20 } });
  const inactive = item({ id: "old", name: "Cancelled card", active: false });
  const otherAccount = item({ id: "other", name: "Other account", accountId: "acct_2" });
  const items = [rent1, rent2, sr, ka, hydro, ctb, inactive, otherAccount];

  function generate(key: string, existing: CashFlowEntry[] = []) {
    const m = month({ id: `m_${key}`, month: key });
    return generateMonthEntries({ items, month: m, holidays: account.bankHolidays, existing, newId: () => newId("e") });
  }

  it("generates October 2026 by posting date", () => {
    const oct = generate("2026-10");
    expect(oct.map((e) => [e.itemId, e.dueDate, e.postingDate])).toEqual([
      // Sep 30 is the Truth and Reconciliation holiday, so rent part 1 posts Oct 1.
      ["rent1", "2026-09-30", "2026-10-01"],
      ["rent2", "2026-10-01", "2026-10-01"],
      ["sr", "2026-10-01", "2026-10-01"],
      ["sr", "2026-10-15", "2026-10-15"],
      ["ka", "2026-10-15", "2026-10-15"],
      ["ctb", "2026-10-20", "2026-10-20"],
      ["hydro", "2026-10-23", "2026-10-23"],
      ["sr", "2026-10-29", "2026-10-29"],
      // The 31st is a Saturday; pay rolls back to Friday.
      ["ka", "2026-10-31", "2026-10-30"],
    ]);
    // October 31's rent part 1 posts Monday November 2, so it isn't October's.
    expect(oct.some((e) => e.dueDate === "2026-10-31" && e.itemId === "rent1")).toBe(false);
  });

  it("puts October 31's rent in November, next to November 1's, and both month-end rents", () => {
    const oct = generate("2026-10");
    const nov = generate("2026-11", oct);
    expect(nov.map((e) => [e.itemId, e.dueDate, e.postingDate])).toEqual([
      ["rent1", "2026-10-31", "2026-11-02"],
      ["rent2", "2026-11-01", "2026-11-02"],
      ["sr", "2026-11-12", "2026-11-12"],
      ["ka", "2026-11-15", "2026-11-13"], // Sunday the 15th → Friday
      ["ctb", "2026-11-20", "2026-11-20"],
      ["sr", "2026-11-26", "2026-11-26"],
      ["rent1", "2026-11-30", "2026-11-30"],
      ["ka", "2026-11-30", "2026-11-30"],
    ]);
  });

  it("rolls past New Year's Day into January's first business day", () => {
    const jan = generate("2027-01");
    expect(jan.find((e) => e.itemId === "rent2")?.postingDate).toBe("2027-01-04");
  });

  it("is idempotent: regenerating a month adds nothing", () => {
    const oct = generate("2026-10");
    expect(generate("2026-10", oct)).toEqual([]);
  });

  it("never generates a rolled payment twice, even if it was moved by hand", () => {
    const oct = generate("2026-10");
    const nov = generate("2026-11", oct);
    const moved = nov.find((e) => e.dueDate === "2026-10-31" && e.itemId === "rent1")!;
    moved.monthId = "m_2026-10"; // the user moved it back into October
    const again = generate("2026-11", [...oct, moved]);
    expect(again.filter((e) => e.itemId === "rent1" && e.dueDate === "2026-10-31")).toHaveLength(0);
  });

  it("skips inactive items and other accounts' items", () => {
    const oct = generate("2026-10");
    expect(oct.some((e) => e.itemId === "old" || e.itemId === "other")).toBe(false);
  });

  it("copies settlement and the uncertain-date flag onto the entry", () => {
    const oct = generate("2026-10");
    const ctbEntry = oct.find((e) => e.itemId === "ctb")!;
    expect(ctbEntry.settlement).toBe("external");
    expect(ctbEntry.dateUncertain).toBe(true);
    expect(ctbEntry.status).toBe("planned");
    expect(ctbEntry.occurrenceKey).toBe("ctb:2026-10-20");
    expect(oct.find((e) => e.itemId === "rent1")!.dateUncertain).toBeUndefined();
  });

  it("only generates BC Hydro every second month", () => {
    expect(generate("2026-11").some((e) => e.itemId === "hydro")).toBe(false);
    expect(generate("2026-12").some((e) => e.itemId === "hydro")).toBe(true);
  });
});

describe("expectedAmountFor", () => {
  const hydro = item({ id: "hydro", amountMode: "variable", defaultAmount: 150 });

  it("uses the default for a variable item with no history", () => {
    expect(expectedAmountFor(hydro, [])).toBe(150);
  });

  it("uses the most recent posted amount for a variable item", () => {
    const history = [
      entry({ itemId: "hydro", status: "posted", expectedAmount: 150, actualAmount: 124.32, postingDate: "2026-08-23" }),
      entry({ itemId: "hydro", status: "posted", expectedAmount: 150, actualAmount: 188.77, postingDate: "2026-10-23" }),
      entry({ itemId: "hydro", status: "planned", expectedAmount: 999, postingDate: "2026-12-23" }),
      entry({ itemId: "hydro", status: "skipped", expectedAmount: 0, postingDate: "2026-11-23" }),
    ];
    expect(expectedAmountFor(hydro, history)).toBe(188.77);
  });

  it("always uses the default for a fixed item", () => {
    const rent = item({ id: "rent", amountMode: "fixed", defaultAmount: 1500 });
    expect(expectedAmountFor(rent, [entry({ itemId: "rent", status: "posted", actualAmount: 1400 })])).toBe(1500);
  });
});

describe("startMonth", () => {
  const items = [item({ id: "rent2", defaultAmount: 2661, recurrence: { type: "monthly", day: 1 } })];

  it("needs an opening balance for an account's first month", () => {
    expect(startMonth({ account, monthKey: "2026-10", months: [], entries: [], items, newId })).toEqual({ error: "opening_required" });
  });

  it("creates the month with default checkpoints, the account's rate, and entries", () => {
    const result = startMonth({ account, monthKey: "2026-10", months: [], entries: [], items, openingBalance: 5000, newId });
    if ("error" in result) throw new Error(result.error);
    expect(result.month.openingBalance).toBe(5000);
    expect(result.month.openingSource).toBe("manual");
    expect(result.month.dailySpendRate).toBe(50);
    expect(sortPeriods(result.month.periods).map((p) => p.endDate)).toEqual(["2026-10-02", "2026-10-09", "2026-10-31"]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].monthId).toBe(result.month.id);
  });

  it("carries the previous month's closing balance", () => {
    const sep = month({ id: "m_sep", month: "2026-09", openingBalance: 2000, periods: defaultPeriods("2026-09", () => newId("p")) });
    const sepEntries = [entry({ monthId: "m_sep", kind: "deposit", expectedAmount: 1000, postingDate: "2026-09-10" })];
    // 2,000 − 30 days × 50 + 1,000 = 1,500
    const result = startMonth({ account, monthKey: "2026-10", months: [sep], entries: sepEntries, items, newId });
    if ("error" in result) throw new Error(result.error);
    expect(result.month.openingBalance).toBe(1500);
    expect(result.month.openingSource).toBe("carried");
  });

  it("refuses a month that already exists", () => {
    const oct = month();
    expect(startMonth({ account, monthKey: "2026-10", months: [oct], entries: [], items, openingBalance: 1, newId })).toEqual({ error: "exists" });
  });
});

describe("propagateCarriedOpenings", () => {
  it("updates consecutive carried months and stops at a manual one", () => {
    const zero = (key: string, overrides: Partial<CashFlowMonth>) => {
      const m = month({ month: key, periods: defaultPeriods(key, () => newId("p")), ...overrides });
      for (const p of m.periods) p.spendOverride = 0;
      return m;
    };
    const oct = zero("2026-10", { id: "oct", openingBalance: 1000 });
    const nov = zero("2026-11", { id: "nov", openingBalance: 0, openingSource: "carried" });
    const dec = zero("2026-12", { id: "dec", openingBalance: 0, openingSource: "carried" });
    const jan = zero("2027-01", { id: "jan", openingBalance: 42, openingSource: "manual" });
    const months = [oct, nov, dec, jan];
    const entries = [
      entry({ monthId: "oct", kind: "deposit", expectedAmount: 250.25, postingDate: "2026-10-05" }),
      entry({ monthId: "nov", expectedAmount: 50.5, postingDate: "2026-11-05" }),
    ];
    expect(propagateCarriedOpenings(months, entries, "acct", "2026-10")).toBe(2);
    expect(nov.openingBalance).toBe(1250.25);
    expect(dec.openingBalance).toBe(1199.75);
    expect(jan.openingBalance).toBe(42);
    // Nothing left to change.
    expect(propagateCarriedOpenings(months, entries, "acct", "2026-10")).toBe(0);
  });

  it("follows a recorded final checkpoint rather than the projection", () => {
    const oct = month({ id: "oct" });
    sortPeriods(oct.periods)[2].actualBalance = 777.77;
    const nov = month({ id: "nov", month: "2026-11", openingBalance: 0, openingSource: "carried", periods: defaultPeriods("2026-11", () => newId("p")) });
    propagateCarriedOpenings([oct, nov], [], "acct", "2026-10");
    expect(nov.openingBalance).toBe(777.77);
  });
});
