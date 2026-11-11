import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { isValidIsoDate, readJsonObject, readString } from "@/lib/request";
import { resolveVendor } from "@/lib/classify";
import { bankVendorName, classifyBankLine } from "@/lib/bankClassify";
import { readMoney } from "@/lib/cashflowRequest";
import type { BankTransaction, ChildVendor } from "@/lib/types";

const MAX_IMPORT_ROWS = 20000;
const MAX_DESCRIPTION = 500;

interface BankImportRow {
  date: string;
  rawDescription: string;
  amount: number;
  direction: "in" | "out";
  forceImport?: boolean;
}

// Same account, date, details, direction, and amount — the shape of "this
// statement line was already imported". A skip-and-report, not a hard
// constraint, since two real same-day same-amount lines can happen.
function duplicateKey(accountId: string, date: string, rawDescription: string, direction: string, amount: number): string {
  return `${accountId}\0${date}\0${rawDescription}\0${direction}\0${Math.round(amount * 100)}`;
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const accountId = readString(body.accountId);
  const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `Too many rows in one import (max ${MAX_IMPORT_ROWS})` }, { status: 400 });

  const { result } = await updateState((state) => {
    if (!state.bankAccounts.some((a) => a.id === accountId)) return { error: "Unknown account" };
    const seen = new Set(state.bankTransactions.map((t) => duplicateKey(t.accountId, t.date, t.rawDescription, t.direction, t.amount)));
    const created: BankTransaction[] = [];
    const duplicates: BankImportRow[] = [];
    let skipped = 0;

    for (const raw of rows) {
      const row = raw as Partial<BankImportRow> | null;
      // The export pads some details with spaces; trimmed text is what
      // de-duplication and vendor matching compare.
      const rawDescription = typeof row?.rawDescription === "string" ? row.rawDescription.trim().replace(/\s+/g, " ") : null;
      const amount = readMoney(row?.amount);
      if (
        !row ||
        typeof row.date !== "string" ||
        !isValidIsoDate(row.date) ||
        rawDescription === null ||
        rawDescription.length > MAX_DESCRIPTION ||
        amount === null ||
        amount === 0 ||
        (row.direction !== "in" && row.direction !== "out") ||
        (row.forceImport !== undefined && typeof row.forceImport !== "boolean")
      ) {
        skipped++;
        continue;
      }
      const key = duplicateKey(accountId, row.date, rawDescription, row.direction, amount);
      if (seen.has(key) && !row.forceImport) {
        duplicates.push({ date: row.date, rawDescription, amount, direction: row.direction });
        continue;
      }
      seen.add(key);

      const { type, recognised } = classifyBankLine(rawDescription, row.direction);
      let childVendorId: string | null = null;
      let needsReview = !recognised;
      // Debit purchases share the card side's vendors and categories.
      if (type === "purchase") {
        const name = bankVendorName(rawDescription, row.direction);
        const match = resolveVendor(name, state.childVendors, state.parentVendors);
        if (match.kind === "exact") {
          childVendorId = match.childVendorId;
        } else if (match.kind === "fuzzy") {
          const child: ChildVendor = { id: uid("child"), parentId: match.parentId, rawName: name };
          state.childVendors.push(child);
          childVendorId = child.id;
          needsReview = true;
        } else {
          needsReview = true;
        }
      }
      const txn: BankTransaction = { id: uid("btx"), accountId, date: row.date, rawDescription, amount, direction: row.direction, type, childVendorId, needsReview };
      state.bankTransactions.push(txn);
      created.push(txn);
    }
    state.bankTransactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      transactions: created,
      counts: { total: created.length, review: created.filter((t) => t.needsReview).length, skipped, duplicates: duplicates.length },
      duplicates,
    };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
