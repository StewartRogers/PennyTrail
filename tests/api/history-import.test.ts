import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { createAccount, importHistory, readStore, startMonth } from "../helpers/cashflowApi";
import { octoberSheet, septemberSheet } from "../helpers/budgetSheet";
import { summarizeMonth } from "@/lib/cashflow";

setupScratchDataDir();

const sheets = () => [
  { name: "Sep 26", rows: septemberSheet() },
  { name: "Oct 26", rows: octoberSheet() },
];

describe("POST /api/cashflow/history-import", () => {
  it("imports each sheet as a month with the sheet's balances", async () => {
    const { body: account } = await createAccount();
    const { status, body } = await importHistory({ accountId: account.id, sheets: sheets(), today: "2026-10-18" });
    expect(status).toBe(201);
    expect(body).toMatchObject({ importedMonths: 2, entries: 19, items: 0, skippedMonths: [], sheetErrors: [] });

    const state = await readStore();
    const oct = state.cashFlowMonths.find((m) => m.month === "2026-10")!;
    expect(oct).toMatchObject({ openingBalance: 10000, openingSource: "carried", closed: false, importedFrom: "Oct 26" });
    const s = summarizeMonth(oct, state.cashFlowEntries.filter((e) => e.monthId === oct.id));
    expect(s.periods.map((p) => p.actual)).toEqual([9150, 8000, undefined]);
    expect(s.projectedClose).toBe(14942.52);
    expect(state.cashFlowMonths.find((m) => m.month === "2026-09")!.closed).toBe(true);
  });

  it("reports sheets that aren't months and imports the rest", async () => {
    const { body: account } = await createAccount();
    const { status, body } = await importHistory({ accountId: account.id, sheets: [...sheets(), { name: "Notes", rows: [["Ideas"]] }], today: "2026-10-18" });
    expect(status).toBe(201);
    expect(body.importedMonths).toBe(2);
    expect(body.sheetErrors).toHaveLength(1);
    expect(body.sheetErrors[0].sheetName).toBe("Notes");
  });

  it("never overwrites a month that already exists", async () => {
    const { body: account } = await createAccount();
    await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    const { body } = await importHistory({ accountId: account.id, sheets: sheets(), today: "2026-10-18" });
    expect(body.skippedMonths).toEqual(["2026-10"]);
    const state = await readStore();
    expect(state.cashFlowMonths.find((m) => m.month === "2026-10")!.openingBalance).toBe(1);
    expect(state.cashFlowMonths).toHaveLength(2);
  });

  it("carries into an existing month that follows the imported ones", async () => {
    const { body: account } = await createAccount();
    // November exists and carries from October; importing October fills in its opening.
    await startMonth({ accountId: account.id, month: "2026-11", openingBalance: 0 });
    let state = await readStore();
    state.cashFlowMonths[0].openingSource = "carried";
    const { writeState } = await import("@/lib/store");
    await writeState(state);
    await importHistory({ accountId: account.id, sheets: sheets(), today: "2026-10-18" });
    state = await readStore();
    expect(state.cashFlowMonths.find((m) => m.month === "2026-11")!.openingBalance).toBe(14942.52);
  });

  it("rejects two sheets for the same month", async () => {
    const { body: account } = await createAccount();
    const { status } = await importHistory({ accountId: account.id, sheets: [{ name: "Oct 26", rows: octoberSheet() }, { name: "Oct 26 copy", rows: octoberSheet() }], today: "2026-10-18" });
    expect(status).toBe(400);
    expect((await readStore()).cashFlowMonths).toHaveLength(0);
  });

  it.each([
    [{ sheets: [] }],
    [{ sheets: "Oct 26" }],
    [{ sheets: [{ name: "Oct 26", rows: [[{ formula: "=A1" }]] }] }],
    [{ sheets: [{ name: "Oct 26", rows: [["x".repeat(1001)]] }] }],
    [{ today: "18/10/2026" }],
    [{ oneOffKeys: "rent" }],
    [{ keyMap: ["rent"] }],
    [{ keyMap: { rent: 5 } }],
  ])("rejects a malformed request %#", async (override) => {
    const { body: account } = await createAccount();
    const res = await importHistory({ accountId: account.id, sheets: sheets(), today: "2026-10-18", ...override });
    expect(res.status).toBe(400);
    expect((await readStore()).cashFlowMonths).toHaveLength(0);
  });

  it("applies 'same item as' mappings before creating items", async () => {
    const { body: account } = await createAccount();
    // Three months of pay under two spellings; merged, they're one item.
    const sheet = (month: number, payName: string) => [
      ["", "DATE", "CREDIT", "DEBIT", "$1,000.00", "NOTES", "DAY", "", "YEAR", "2026", "MONTH", String(month)],
      ["Weekly Spend", `01-${["Jul", "Aug", "Sep"][month - 7]}-26`, "$0.00", "", "$1,000.00", "AD", "1"],
      [payName, `15-${["Jul", "Aug", "Sep"][month - 7]}-26`, "", "$100.00", "$1,100.00", "AD", "15"],
      ["END OF MONTH", `28-${["Jul", "Aug", "Sep"][month - 7]}-26`, "", "", "$1,100.00", "0.00", "28"],
    ];
    const sheets = [
      { name: "Jul 26", rows: sheet(7, "Kerri Salary") },
      { name: "Aug 26", rows: sheet(8, "Kerri Pay") },
      { name: "Sep 26", rows: sheet(9, "Kerri Pay") },
    ];
    const { normalizeItemName } = await import("@/lib/historyImport");
    const keyMap = { [normalizeItemName("Kerri Salary").key]: normalizeItemName("Kerri Pay").key };
    const without = await importHistory({ accountId: account.id, sheets, today: "2026-10-18" });
    expect(without.body.items).toBe(0);
    const { body: other } = await createAccount({ name: "Other" });
    const withMap = await importHistory({ accountId: other.id, sheets, keyMap, today: "2026-10-18" });
    expect(withMap.body.items).toBe(1);
    const state = await readStore();
    const item = state.cashFlowItems.find((i) => i.accountId === other.id)!;
    expect(item.name).toBe("Kerri Pay");
    const monthIds = new Set(state.cashFlowMonths.filter((m) => m.accountId === other.id).map((m) => m.id));
    expect(state.cashFlowEntries.filter((e) => monthIds.has(e.monthId)).every((e) => e.itemId === item.id)).toBe(true);
  });

  it("rejects an unknown account", async () => {
    expect((await importHistory({ accountId: "nope", sheets: sheets(), today: "2026-10-18" })).status).toBe(400);
  });
});
