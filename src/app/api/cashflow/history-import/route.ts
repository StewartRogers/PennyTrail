import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { readJsonObject, readString } from "@/lib/request";
import { readIsoDate } from "@/lib/cashflowRequest";
import { buildHistoryImport, parseBudgetSheet, seedItems, type ParsedMonth, type SheetCell } from "@/lib/historyImport";
import { toISODate } from "@/lib/format";
import { refreshOpeningsFrom } from "@/lib/cashflowState";

// The workbook goes back to January 2024 — dozens of sheets of a few dozen
// rows each. These caps are far above that and only stop a malformed or
// hostile request from bloating the store, which every write re-serializes.
const MAX_SHEETS = 240;
const MAX_ROWS = 2000;
const MAX_COLS = 26;
const MAX_CELL_LENGTH = 1000;

function readSheets(value: unknown): { name: string; rows: SheetCell[][] }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SHEETS) return null;
  const sheets: { name: string; rows: SheetCell[][] }[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || typeof raw.name !== "string" || raw.name.length > 200 || !Array.isArray(raw.rows)) return null;
    if (raw.rows.length > MAX_ROWS) return null;
    const rows: SheetCell[][] = [];
    for (const row of raw.rows) {
      if (!Array.isArray(row) || row.length > MAX_COLS) return null;
      for (const cell of row) {
        const ok =
          cell === null ||
          typeof cell === "boolean" ||
          (typeof cell === "number" && Number.isFinite(cell)) ||
          (typeof cell === "string" && cell.length <= MAX_CELL_LENGTH);
        if (!ok) return null;
      }
      rows.push(row as SheetCell[]);
    }
    sheets.push({ name: raw.name, rows });
  }
  return sheets;
}

// Imports the monthly budget workbook's sheets (already read from the .xlsx
// in the browser) as Cash Flow history. The server parses the raw cells
// itself, with the same functions the preview ran, rather than trusting
// pre-built records. Months already in the store are skipped, never
// overwritten. `oneOffKeys` are item names the user chose to import without
// a recurring item.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const accountId = readString(body.accountId);
  const sheets = readSheets(body.sheets);
  // The user's own calendar day decides what's "past" (posted) and what's
  // still planned; the server's clock may sit in another timezone.
  const today = body.today === undefined ? toISODate(new Date()) : readIsoDate(body.today);
  const oneOffKeys = Array.isArray(body.oneOffKeys) && body.oneOffKeys.every((k: unknown) => typeof k === "string") ? new Set<string>(body.oneOffKeys) : body.oneOffKeys === undefined ? new Set<string>() : null;

  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  if (!sheets) return NextResponse.json({ error: "sheets must be a list of { name, rows } with plain cell values" }, { status: 400 });
  if (!today) return NextResponse.json({ error: "today must be yyyy-mm-dd" }, { status: 400 });
  if (!oneOffKeys) return NextResponse.json({ error: "oneOffKeys must be a list of names" }, { status: 400 });

  const parsed: ParsedMonth[] = [];
  const sheetErrors: { sheetName: string; error: string }[] = [];
  for (const sheet of sheets) {
    const result = parseBudgetSheet(sheet.name, sheet.rows, today);
    if (result.ok) parsed.push(result.month);
    else sheetErrors.push({ sheetName: result.sheetName, error: result.error });
  }
  const months = new Set<string>();
  for (const m of parsed) {
    if (months.has(m.month)) return NextResponse.json({ error: `Two sheets are both ${m.month}` }, { status: 400 });
    months.add(m.month);
  }
  if (parsed.length === 0) return NextResponse.json({ error: "No sheet could be read as a month", sheetErrors }, { status: 400 });

  const { result } = await updateState((state) => {
    const account = state.bankAccounts.find((a) => a.id === accountId);
    if (!account) return { error: "Unknown account" };
    const seeded = seedItems(parsed, new Set(account.bankHolidays));
    const plan = buildHistoryImport({
      accountId,
      months: parsed,
      seeded,
      oneOffKeys,
      existingItems: state.cashFlowItems,
      existingMonths: state.cashFlowMonths,
      today,
      newId: uid,
    });
    state.cashFlowItems.push(...plan.items);
    state.cashFlowMonths.push(...plan.months);
    state.cashFlowEntries.push(...plan.entries);
    // A month already in the store right after the import may carry its
    // opening from the last imported month.
    const last = plan.months[plan.months.length - 1];
    if (last) refreshOpeningsFrom(state, last);
    return {
      importedMonths: plan.months.length,
      entries: plan.entries.length,
      items: plan.items.length,
      skippedMonths: plan.skippedMonths,
    };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ...result, sheetErrors }, { status: 201 });
}
