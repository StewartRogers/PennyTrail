import { describe, expect, it } from "vitest";
import {
  applyKeyMap,
  buildHistoryImport,
  summarizeNames,
  cellDate,
  cellMoney,
  excelSerialToIso,
  monthFromSheetName,
  normalizeItemName,
  parseBudgetSheet,
  scheduledDateFromNote,
  seedItems,
  type ParsedEntry,
  type ParsedMonth,
} from "@/lib/historyImport";
import { defaultBankHolidays, nextBusinessDay, previousBusinessDay } from "@/lib/businessDays";
import { addMonths, monthEnd, monthKeyOf } from "@/lib/dates";
import { occurrencesBetween } from "@/lib/recurrence";
import { summarizeMonth } from "@/lib/cashflow";
import type { CashFlowItem } from "@/lib/types";
import { octoberSheet, septemberSheet } from "../helpers/budgetSheet";

const TODAY = "2026-10-18";
const holidays = new Set(defaultBankHolidays(2024, 2027));

function parseOk(name: string, rows = octoberSheet(), today = TODAY): ParsedMonth {
  const result = parseBudgetSheet(name, rows, today);
  if (!result.ok) throw new Error(result.error);
  return result.month;
}

describe("cell readers", () => {
  it("reads money as the connector formats it", () => {
    expect(cellMoney("$1,500.00")).toBe(1500);
    expect(cellMoney("-$1,953.74")).toBe(-1953.74);
    expect(cellMoney("-2,201.55")).toBe(-2201.55);
    expect(cellMoney("$0.00")).toBe(0);
    expect(cellMoney(12.5)).toBe(12.5);
    expect(cellMoney("")).toBeNull();
    expect(cellMoney(null)).toBeNull();
    expect(cellMoney("AD")).toBeNull();
  });

  it("reads dates as text and as spreadsheet serial numbers", () => {
    expect(cellDate("01-Jan-24")).toBe("2024-01-01");
    expect(cellDate("31-Oct-26")).toBe("2026-10-31");
    expect(cellDate("1/31/2024")).toBe("2024-01-31");
    expect(cellDate("2024-01-31")).toBe("2024-01-31");
    expect(cellDate("Jan 31, 2024")).toBe("2024-01-31");
    expect(cellDate(45292)).toBe("2024-01-01");
    expect(excelSerialToIso(46326)).toBe("2026-10-31");
    expect(cellDate("31-Feb-24")).toBeNull();
    expect(cellDate("5")).toBeNull();
    expect(cellDate(12)).toBeNull();
  });

  it("finds the scheduling date in a note", () => {
    expect(scheduledDateFromNote("** Submitted: December 27, 2023 at 1:31 p.m. ET.")).toBe("2023-12-27");
    expect(scheduledDateFromNote("** Sep 20 2026 8:20PM (forgot to capture ref number)")).toBe("2026-09-20");
    expect(scheduledDateFromNote("** TBD")).toBeNull();
  });

  it("reads the month from a sheet name", () => {
    expect(monthFromSheetName("Jan 24")).toBe("2024-01");
    expect(monthFromSheetName("June 25")).toBe("2025-06");
    expect(monthFromSheetName("July 25")).toBe("2025-07");
    expect(monthFromSheetName("Sept 2025")).toBe("2025-09");
    expect(monthFromSheetName("Summary")).toBeNull();
  });
});

describe("normalizeItemName", () => {
  it("gives the same key to the different spellings of one item", () => {
    const key = (s: string) => normalizeItemName(s).key;
    expect(key("CIBC Visa")).toBe(key("CIBC (Visa)"));
    expect(key("Rogers Mastercard")).toBe(key("Rogers (Mastercard)"));
    expect(key("Mastercard PCF (KA)")).toBe(key("PCF (Mastercard) - KA"));
    expect(key("Simplii Visa SR")).toBe(key("Simplii (Visa)"));
    expect(key("Tangerine MasterCard SR")).toBe(key("Tangerine Mastercard"));
  });

  it("keeps different items apart", () => {
    const key = (s: string) => normalizeItemName(s).key;
    expect(key("152 Rent (first)")).not.toBe(key("152 Rent (second)"));
    expect(key("RBC AVION (Visa)")).not.toBe(key("RBC WESTJET (Mastercard)"));
    expect(key("RBC Mastercard (SR)")).not.toBe(key("RBC WESTJET (Mastercard)"));
    expect(key("Simplii Visa SR - RESP Transfer")).not.toBe(key("Simplii (Visa)"));
  });

  it("pulls out the owner's initials", () => {
    expect(normalizeItemName("PCF (Mastercard) - KA").owner).toBe("KA");
    expect(normalizeItemName("Mastercard PCF (KA)").owner).toBe("KA");
    expect(normalizeItemName("TD Visa (SR)").owner).toBe("SR");
    expect(normalizeItemName("Simplii Visa SR").owner).toBe("SR");
    expect(normalizeItemName("CIBC (Visa)").owner).toBeUndefined();
  });

  it("strips the sheet's leading asterisks and spaces", () => {
    expect(normalizeItemName("  *** RESP Deposit").name).toBe("RESP Deposit");
  });
});

describe("parseBudgetSheet", () => {
  it("reads the month, opening balance, and daily rate", () => {
    const m = parseOk("Oct 26");
    expect(m.month).toBe("2026-10");
    expect(m.openingBalance).toBe(10000);
    expect(m.dailySpendRate).toBe(50);
  });

  it("reads the checkpoints, recording only those on or before today", () => {
    const m = parseOk("Oct 26");
    expect(m.periods.map((p) => [p.endDate, p.label, p.spend, p.actualBalance])).toEqual([
      ["2026-10-02", "End of week", 100, 9150],
      ["2026-10-09", "End of week", 350, 8000],
      ["2026-10-31", "End of month", 1100, undefined],
    ]);
  });

  it("reads every item row, skipping placeholders and the summary row", () => {
    const m = parseOk("Oct 26");
    expect(m.entries).toHaveLength(18);
    expect(m.entries.map((e) => e.row)).toEqual([3, 4, 5, 6, 7, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  });

  it("maps CREDIT to bills and DEBIT to deposits", () => {
    const m = parseOk("Oct 26");
    const byRow = (row: number) => m.entries.find((e) => e.row === row)!;
    expect([byRow(3).kind, byRow(3).amount]).toEqual(["bill", 1500]);
    expect([byRow(4).kind, byRow(4).amount]).toEqual(["deposit", 3000]);
    expect([byRow(10).kind, byRow(10).amount]).toEqual(["deposit", 0]); // blank, named like a deposit
    expect([byRow(23).kind, byRow(23).amount]).toEqual(["bill", 0]); // "$0.00" in CREDIT
  });

  it("maps the notes column to status, settlement, and confirmation number", () => {
    const m = parseOk("Oct 26");
    const pick = (e: ParsedEntry) => [e.name, e.status, e.settlement, e.confirmationCode];
    expect(m.entries.map(pick)).toEqual([
      ["152 Rent (first)", "posted", "manual", undefined], // 9999999999 is a placeholder
      ["Stewart Pay", "posted", "auto", undefined],
      ["152 Rent (second)", "posted", "manual", "106126052602"],
      ["CIBC (Visa)", "posted", "manual", undefined],
      ["RBC AVION (Visa)", "skipped", "external", undefined],
      ["Child Tax Benefit", "skipped", "external", undefined],
      ["Simplii (Visa)", "posted", "manual", undefined],
      ["152 Home Insurance", "posted", "auto", undefined],
      ["Stewart Pay", "posted", "auto", undefined],
      ["Kerri Pay", "posted", "auto", undefined],
      ["AMEX", "scheduled", "manual", "136258"],
      ["PCF (Mastercard) - KA", "skipped", "external", undefined],
      ["Child Tax Benefit", "planned", "external", undefined],
      ["BC Hydro", "scheduled", "manual", "136266"],
      ["Stewart Pay", "planned", "auto", undefined],
      ["Wealthsimple (Visa)", "skipped", "external", undefined],
      ["Kerri Pay", "planned", "auto", undefined],
      ["152 Rent (first)", "scheduled", "manual", "6156431232"],
    ]);
  });

  it("keeps notes and reads the scheduling date from them", () => {
    const m = parseOk("Oct 26");
    const rent = m.entries.find((e) => e.row === 25)!;
    expect(rent.scheduledDate).toBe("2026-10-12");
    expect(rent.notes).toBe("** October 12, 2026 at 12:05 p.m. ET.");
    expect(m.entries.find((e) => e.row === 3)!.scheduledDate).toBe("2026-09-20");
    expect(m.entries.find((e) => e.row === 7)!.notes).toBe("cancelled");
  });

  it("records the owner and the name key", () => {
    const pcf = parseOk("Oct 26").entries.find((e) => e.row === 19)!;
    expect(pcf.owner).toBe("KA");
    expect(pcf.key).toBe(normalizeItemName("Mastercard PCF (KA)").key);
  });

  it("agrees with the sheet's running balance on every row", () => {
    const m = parseOk("Oct 26");
    expect(m.balanceMismatches).toEqual([]);
    expect(m.warnings).toEqual([]);
  });

  it("flags a row whose running balance doesn't match", () => {
    const rows = octoberSheet();
    rows[10][4] = "$8,045.71"; // one cent off
    const m = parseOk("Oct 26", rows);
    expect(m.balanceMismatches).toEqual([{ row: 11, sheet: 8045.71, computed: 8045.7 }]);
  });

  it("flags a checkpoint variance that doesn't match the rows", () => {
    const rows = octoberSheet();
    rows[7][5] = "-27.50";
    expect(parseOk("Oct 26", rows).warnings.some((w) => /Row 8: the sheet's variance -27.50/.test(w))).toBe(true);
  });

  it("flags a row listed under the wrong checkpoint", () => {
    const rows = octoberSheet();
    rows[9][1] = "12-Oct-26"; // Child Tax Benefit, listed in period 2
    expect(parseOk("Oct 26", rows).warnings.some((w) => /Row 10: "Child Tax Benefit" is dated 2026-10-12 but listed under the checkpoint of 2026-10-09/.test(w))).toBe(true);
  });

  it("treats every checkpoint as unrecorded for a future month", () => {
    const m = parseOk("Oct 26", octoberSheet(), "2026-09-15");
    expect(m.periods.every((p) => p.actualBalance === undefined)).toBe(true);
    expect(m.entries.every((e) => e.status !== "posted")).toBe(true);
  });

  it("falls back to the sheet name when row 1 has no YEAR/MONTH", () => {
    const rows = octoberSheet();
    rows[0] = rows[0].slice(0, 7);
    expect(parseOk("Oct 26", rows).month).toBe("2026-10");
  });

  it("reads serial-number dates and numeric amounts from an .xlsx", () => {
    const rows = octoberSheet().map((r) => [...r]);
    rows[0][4] = 10000;
    rows[1][1] = 46296; // 2026-10-01
    rows[1][2] = 100;
    const m = parseOk("Oct 26", rows);
    expect(m.openingBalance).toBe(10000);
    expect(m.periods[0].spend).toBe(100);
  });

  it("rejects a sheet without the expected headings", () => {
    const result = parseBudgetSheet("Summary", [["Total", "", ""]], TODAY);
    expect(result.ok).toBe(false);
  });

  it("rejects a sheet without checkpoints", () => {
    const result = parseBudgetSheet("Oct 26", octoberSheet().filter((r) => !/^END OF/.test(String(r[0]))), TODAY);
    expect(result).toEqual({ ok: false, sheetName: "Oct 26", error: "No END OF WEEK / END OF MONTH rows found" });
  });

  it("rejects a sheet whose month can't be determined", () => {
    const rows = octoberSheet();
    rows[0] = rows[0].slice(0, 7);
    expect(parseBudgetSheet("Budget", rows, TODAY).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recurring items from a synthetic year of history
// ---------------------------------------------------------------------------

function syntheticHistory(): ParsedMonth[] {
  const entries: ParsedEntry[] = [];
  let row = 0;
  const add = (name: string, kind: "bill" | "deposit", date: string, amount: number, settlement: ParsedEntry["settlement"], notes?: string) => {
    const { key, owner } = normalizeItemName(name);
    entries.push({
      row: ++row,
      name,
      key,
      ...(owner ? { owner } : {}),
      kind,
      date,
      amount,
      status: amount === 0 ? "skipped" : date <= TODAY ? "posted" : "planned",
      ...(settlement ? { settlement } : {}),
      ...(notes ? { notes } : {}),
    });
  };
  const from = "2025-11";
  const to = "2026-11";
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    add("152 Rent (first)", "bill", nextBusinessDay(monthEnd(m), holidays), 1500, "manual");
    add("152 Rent (second)", "bill", nextBusinessDay(`${m}-01`, holidays), 2000, "manual");
    for (const d of occurrencesBetween({ type: "semiMonthly", days: [15, "last"] }, `${m}-01`, monthEnd(m))) {
      add("Kerri Pay", "deposit", previousBusinessDay(d, holidays), 2400, "auto");
    }
    add("Fortis", "bill", nextBusinessDay(`${m}-26`, holidays), 40 + Number(m.slice(5)), "manual");
    add("152 Home Insurance", "bill", nextBusinessDay(`${m}-09`, holidays), 28.92, "auto");
    const hydroMonth = (Number(m.slice(5)) % 2 === 0);
    add("BC Hydro", "bill", nextBusinessDay(`${m}-23`, holidays), hydroMonth ? 150 + Number(m.slice(5)) : 0, hydroMonth ? "manual" : "external");
    // The older spelling, then the newer one.
    add(m < "2026-06" ? "Mastercard PCF (KA)" : "PCF (Mastercard) - KA", "bill", `${m}-20`, 500, "external");
    // Cancelled in the newest months.
    add("RBC AVION (Visa)", "bill", nextBusinessDay(`${m}-02`, holidays), m >= "2026-10" ? 0 : 75, m >= "2026-10" ? "external" : "manual", m >= "2026-10" ? "cancelled" : undefined);
  }
  const ctbDays = [20, 20, 19, 20, 22, 20, 21, 20, 20, 23, 20, 20, 20];
  let i = 0;
  for (let m = from; m <= to; m = addMonths(m, 1)) add("Child Tax Benefit", "deposit", `${m}-${ctbDays[i++]}`, 500, "external");
  for (const d of occurrencesBetween({ type: "everyNWeeks", n: 2, anchorDate: "2026-10-15" }, "2025-11-01", "2026-11-30")) {
    add("Stewart Pay", "deposit", d, 3000, "auto");
  }
  add("  *** RESP Deposit", "deposit", "2026-01-02", 5000, "external");

  const months: ParsedMonth[] = [];
  for (let m = from; m <= addMonths(to, 1); m = addMonths(m, 1)) {
    const own = entries.filter((e) => monthKeyOf(e.date) === m).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (own.length === 0) continue;
    months.push({ sheetName: m, month: m, openingBalance: 0, dailySpendRate: 50, periods: [{ row: 0, endDate: monthEnd(m), label: "End of month", spend: 0 }], entries: own, warnings: [], balanceMismatches: [] });
  }
  return months;
}

describe("seedItems", () => {
  const seeded = seedItems(syntheticHistory(), holidays);
  const byName = (name: string) => {
    const found = seeded.find((s) => s.key === normalizeItemName(name).key);
    if (!found) throw new Error(`No seeded item for ${name}`);
    return found;
  };

  it("reads month-end rent as monthly on the last day, even when it posted on the 1st", () => {
    expect(byName("152 Rent (first)").recurrence).toEqual({ type: "monthly", day: "last" });
  });

  it("reads the 1st-of-month rent as monthly on the 1st", () => {
    expect(byName("152 Rent (second)").recurrence).toEqual({ type: "monthly", day: 1 });
  });

  it("reads SR's pay as every 2 weeks, anchored on the latest payday that posted", () => {
    expect(byName("Stewart Pay").recurrence).toEqual({ type: "everyNWeeks", n: 2, anchorDate: "2026-10-15" });
  });

  it("reads KA's pay as the 15th and the last day", () => {
    expect(byName("Kerri Pay").recurrence).toEqual({ type: "semiMonthly", days: [15, "last"] });
  });

  it("reads BC Hydro as every 2 months", () => {
    expect(byName("BC Hydro").recurrence).toEqual({ type: "everyNMonths", n: 2, day: 23, anchorMonth: "2026-10" });
    expect(byName("BC Hydro").amountMode).toBe("variable");
  });

  it("reads Fortis as monthly and variable, insurance as fixed", () => {
    expect(byName("Fortis").recurrence).toEqual({ type: "monthly", day: 26 });
    expect(byName("Fortis").amountMode).toBe("variable");
    expect(byName("152 Home Insurance").amountMode).toBe("fixed");
    expect(byName("152 Home Insurance").defaultAmount).toBe(28.92);
  });

  it("marks the Child Tax Benefit's date as uncertain", () => {
    const ctb = byName("Child Tax Benefit");
    expect(ctb.recurrence).toEqual({ type: "monthly", day: 20 });
    expect(ctb.settlement).toBe("external");
    expect(ctb.dateUncertain).toBe(true);
    expect(ctb.kind).toBe("deposit");
  });

  it("takes settlement from the most common code", () => {
    expect(byName("Stewart Pay").settlement).toBe("auto");
    expect(byName("152 Rent (second)").settlement).toBe("manual");
    expect(byName("PCF (Mastercard) - KA").settlement).toBe("external");
  });

  it("uses the newest spelling and keeps the owner", () => {
    const pcf = byName("Mastercard PCF (KA)");
    expect(pcf.name).toBe("PCF (Mastercard) - KA");
    expect(pcf.owner).toBe("KA");
  });

  it("marks an item cancelled in the newest month inactive", () => {
    expect(byName("RBC AVION (Visa)").active).toBe(false);
    expect(byName("Fortis").active).toBe(true);
  });

  it("leaves one-offs out", () => {
    expect(seeded.some((s) => s.key === normalizeItemName("RESP Deposit").key)).toBe(false);
  });
});

describe("name mapping", () => {
  const history = syntheticHistory();

  it("summarizes each name with its latest spelling and month count", () => {
    const names = summarizeNames(history);
    const pcf = names.find((n) => n.key === normalizeItemName("PCF (Mastercard) - KA").key)!;
    expect(pcf.name).toBe("PCF (Mastercard) - KA");
    expect(pcf.months).toBe(13);
    expect(names.find((n) => n.key === normalizeItemName("RESP Deposit").key)!.months).toBe(1);
  });

  it("merges one name into another so they're seeded as one item", () => {
    const resp = normalizeItemName("RESP Deposit").key;
    const ctb = normalizeItemName("Child Tax Benefit").key;
    const merged = applyKeyMap(history, { [resp]: ctb });
    expect(merged.flatMap((m) => m.entries).filter((e) => e.key === resp)).toHaveLength(0);
    // The original months are untouched.
    expect(history.flatMap((m) => m.entries).filter((e) => e.key === resp)).toHaveLength(1);
  });

  it("lets a name seen too rarely to be an item join one", () => {
    // Four months of a renamed card: two under each name — neither alone is an item.
    const months: ParsedMonth[] = ["2026-07", "2026-08", "2026-09", "2026-10"].map((m, i) => {
      const name = i < 2 ? "RBC Mastercard (SR)" : "RBC WESTJET (Mastercard)";
      const { key, owner } = normalizeItemName(name);
      return {
        sheetName: m, month: m, openingBalance: 0, dailySpendRate: 50, warnings: [], balanceMismatches: [],
        periods: [{ row: 0, endDate: monthEnd(m), label: "End of month", spend: 0 }],
        entries: [{ row: 1, name, key, ...(owner ? { owner } : {}), kind: "bill" as const, date: `${m}-23`, amount: 100 + i, status: "posted" as const, settlement: "manual" as const }],
      };
    });
    expect(seedItems(months, holidays)).toEqual([]);
    const oldKey = normalizeItemName("RBC Mastercard (SR)").key;
    const newKey = normalizeItemName("RBC WESTJET (Mastercard)").key;
    const seeded = seedItems(applyKeyMap(months, { [oldKey]: newKey }), holidays);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ name: "RBC WESTJET (Mastercard)", monthsSeen: 4, owner: "SR", amountMode: "variable", defaultAmount: 103 });
  });

  it("ignores mappings that point at themselves or at a name that's mapped too", () => {
    const resp = normalizeItemName("RESP Deposit").key;
    const ctb = normalizeItemName("Child Tax Benefit").key;
    const fortis = normalizeItemName("Fortis").key;
    expect(applyKeyMap(history, { [resp]: resp })).toBe(history);
    const looped = applyKeyMap(history, { [resp]: ctb, [ctb]: fortis });
    // resp → ctb is dropped because ctb is itself mapped; ctb → fortis applies.
    const keys = new Set(looped.flatMap((m) => m.entries).map((e) => e.key));
    expect(keys.has(resp)).toBe(true);
    expect(keys.has(ctb)).toBe(false);
  });

  it("isn't fooled by names like 'constructor'", () => {
    expect(applyKeyMap(history, { constructor: "x" })).not.toBe(history);
    expect(applyKeyMap(history, { a: "constructor" })).not.toBe(history);
  });
});

describe("buildHistoryImport", () => {
  let seq = 0;
  const newId = (prefix: string) => `${prefix}_${++seq}`;
  const parsed = [parseOk("Sep 26", septemberSheet()), parseOk("Oct 26")];

  function build(overrides: Partial<Parameters<typeof buildHistoryImport>[0]> = {}) {
    return buildHistoryImport({
      accountId: "acct",
      months: parsed,
      seeded: [],
      oneOffKeys: new Set(),
      existingItems: [],
      existingMonths: [],
      today: TODAY,
      newId,
      ...overrides,
    });
  }

  it("rebuilds each month to the same balances as the sheet", () => {
    const plan = build();
    const [sep, oct] = plan.months;
    const sepSummary = summarizeMonth(sep, plan.entries.filter((e) => e.monthId === sep.id));
    expect(sepSummary.periods.map((p) => p.actual)).toEqual([8800, 8450, 10000]);
    expect(sepSummary.periods[2].variance).toBe(500);
    const octSummary = summarizeMonth(oct, plan.entries.filter((e) => e.monthId === oct.id));
    expect(octSummary.periods.map((p) => [p.projected, p.actual])).toEqual([
      [9177.53, 9150],
      [8016.78, 8000],
      [14942.52, undefined],
    ]);
    expect(octSummary.periods[0].variance).toBe(-27.53);
    expect(octSummary.periods[1].variance).toBe(-16.78);
  });

  it("carries the opening when it equals the previous month's close", () => {
    const [sep, oct] = build().months;
    expect(sep.openingSource).toBe("manual");
    expect(oct.openingSource).toBe("carried");
  });

  it("closes fully recorded past months and leaves the current one open", () => {
    const [sep, oct] = build().months;
    expect(sep.closed).toBe(true);
    expect(oct.closed).toBe(false);
    expect(oct.importedFrom).toBe("Oct 26");
  });

  it("stores spend as the daily rate, with no overrides when the sheet followed it", () => {
    const [, oct] = build().months;
    expect(oct.dailySpendRate).toBe(50);
    expect(oct.periods.every((p) => p.spendOverride === undefined)).toBe(true);
  });

  it("keeps an override where the sheet's Weekly Spend differs from the rate", () => {
    const rows = octoberSheet();
    rows[8][2] = "$400.00";
    rows[8][4] = "$8,750.00";
    const plan = build({ months: [parseOk("Oct 26", rows)] });
    expect(plan.months[0].periods.map((p) => p.spendOverride)).toEqual([undefined, 400, undefined]);
  });

  it("creates entries with posted amounts and dates", () => {
    const plan = build();
    const oct = plan.months[1];
    const rent2 = plan.entries.find((e) => e.monthId === oct.id && e.name === "152 Rent (second)")!;
    expect(rent2).toMatchObject({ status: "posted", postedDate: "2026-10-01", actualAmount: 2000, confirmationCode: "106126052602", itemId: null });
    const amex = plan.entries.find((e) => e.name === "AMEX")!;
    expect(amex).toMatchObject({ status: "scheduled", expectedAmount: 1571.06, postingDate: "2026-10-19" });
    expect(amex.actualAmount).toBeUndefined();
    expect(amex.postedDate).toBeUndefined();
  });

  it("links entries to seeded items and creates those items", () => {
    const seeded = seedItems(parsed, holidays);
    // Two months isn't enough history for an item; seed one by hand.
    const sr = { key: normalizeItemName("Stewart Pay").key, name: "Stewart Pay", kind: "deposit" as const, amountMode: "fixed" as const, defaultAmount: 3000, recurrence: { type: "everyNWeeks" as const, n: 2, anchorDate: "2026-10-15" }, settlement: "auto" as const, dateUncertain: false, active: true, monthsSeen: 3 };
    expect(seeded).toEqual([]);
    const plan = build({ seeded: [sr] });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ name: "Stewart Pay", roll: "previous", settlement: "auto", accountId: "acct" });
    const srEntries = plan.entries.filter((e) => e.name === "Stewart Pay");
    expect(srEntries).toHaveLength(4);
    expect(srEntries.every((e) => e.itemId === plan.items[0].id)).toBe(true);
    expect(srEntries[0].occurrenceKey).toBe(`${plan.items[0].id}:2026-09-17`);
  });

  it("reuses an existing item with the same name instead of duplicating it", () => {
    const existing: CashFlowItem = { id: "item_sr", accountId: "acct", name: "Stewart Pay", kind: "deposit", amountMode: "fixed", defaultAmount: 1, recurrence: { type: "monthly", day: 1 }, roll: "previous", settlement: "auto", active: true };
    const sr = { key: normalizeItemName("Stewart Pay").key, name: "Stewart Pay", kind: "deposit" as const, amountMode: "fixed" as const, defaultAmount: 3000, recurrence: { type: "monthly" as const, day: 1 }, settlement: "auto" as const, dateUncertain: false, active: true, monthsSeen: 3 };
    const plan = build({ seeded: [sr], existingItems: [existing] });
    expect(plan.items).toEqual([]);
    expect(plan.entries.filter((e) => e.name === "Stewart Pay").every((e) => e.itemId === "item_sr")).toBe(true);
  });

  it("imports a name marked one-off without an item", () => {
    const sr = { key: normalizeItemName("Stewart Pay").key, name: "Stewart Pay", kind: "deposit" as const, amountMode: "fixed" as const, defaultAmount: 3000, recurrence: { type: "monthly" as const, day: 1 }, settlement: "auto" as const, dateUncertain: false, active: true, monthsSeen: 3 };
    const plan = build({ seeded: [sr], oneOffKeys: new Set([sr.key]) });
    expect(plan.items).toEqual([]);
    expect(plan.entries.filter((e) => e.name === "Stewart Pay").every((e) => e.itemId === null)).toBe(true);
  });

  it("never overwrites a month already in the store", () => {
    const plan = build({ existingMonths: [{ id: "x", accountId: "acct", month: "2026-09", openingBalance: 1, openingSource: "manual", dailySpendRate: 50, periods: [], closed: false }] });
    expect(plan.skippedMonths).toEqual(["2026-09"]);
    expect(plan.months.map((m) => m.month)).toEqual(["2026-10"]);
    // With September skipped, October has no imported month to carry from.
    expect(plan.months[0].openingSource).toBe("manual");
  });
});
