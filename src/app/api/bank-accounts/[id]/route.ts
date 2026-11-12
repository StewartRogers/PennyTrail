import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { MAX_NAME_LENGTH, isValidIsoDate, readJsonObject, readString } from "@/lib/request";
import { readMoney } from "@/lib/cashflowRequest";
import type { BankImportMapping } from "@/lib/types";
import { isDateFormat } from "@/lib/csv";

const MAX_HOLIDAYS = 2000;

function readColumn(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= -1 && value < 1000 ? value : null;
}

function readMapping(value: unknown): BankImportMapping | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  const dateCol = readColumn(m.dateCol);
  const descCol = readColumn(m.descCol);
  const outCol = readColumn(m.outCol);
  const inCol = readColumn(m.inCol);
  if (dateCol === null || dateCol < 0 || descCol === null || descCol < 0 || outCol === null || inCol === null) return null;
  if (outCol < 0 && inCol < 0) return null;
  if (!isDateFormat(m.dateFormat)) return null;
  return { dateCol, descCol, outCol, inCol, dateFormat: m.dateFormat };
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/bank-accounts/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  for (const field of ["name", "institution", "last4"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") return NextResponse.json({ error: `${field} must be text` }, { status: 400 });
    if (typeof body[field] === "string" && body[field].trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "Account details are too long" }, { status: 400 });
    }
  }
  if (body.name !== undefined && !readString(body.name)) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  const rate = body.dailySpendRate === undefined ? undefined : readMoney(body.dailySpendRate);
  if (rate === null) return NextResponse.json({ error: "Daily spend rate must be a non-negative amount" }, { status: 400 });
  const threshold = body.lowBalanceThreshold === undefined || body.lowBalanceThreshold === null ? body.lowBalanceThreshold : readMoney(body.lowBalanceThreshold, { allowNegative: true });
  if (threshold === null && body.lowBalanceThreshold !== null) return NextResponse.json({ error: "Low-balance threshold must be an amount" }, { status: 400 });
  let holidays: string[] | undefined;
  if (body.bankHolidays !== undefined) {
    if (!Array.isArray(body.bankHolidays) || body.bankHolidays.length > MAX_HOLIDAYS || !body.bankHolidays.every((d: unknown) => typeof d === "string" && isValidIsoDate(d))) {
      return NextResponse.json({ error: "Bank holidays must be a list of yyyy-mm-dd dates" }, { status: 400 });
    }
    holidays = [...new Set(body.bankHolidays as string[])].sort();
  }
  const mapping = body.importMapping === undefined ? undefined : readMapping(body.importMapping);
  if (mapping === null) return NextResponse.json({ error: "Import mapping is incomplete" }, { status: 400 });

  const { result } = await updateState((state) => {
    const account = state.bankAccounts.find((a) => a.id === id);
    if (!account) return { error: "not_found" as const };
    if (typeof body.name === "string") account.name = body.name.trim();
    if (typeof body.institution === "string") account.institution = body.institution.trim();
    if (typeof body.last4 === "string") account.last4 = body.last4.trim();
    if (rate !== undefined) account.dailySpendRate = rate;
    if (body.lowBalanceThreshold === null) delete account.lowBalanceThreshold;
    else if (threshold !== undefined) account.lowBalanceThreshold = threshold;
    if (holidays) account.bankHolidays = holidays;
    if (mapping) account.importMapping = mapping;
    return { account };
  });
  if ("error" in result) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(result.account);
}

// An account with months, items, or bank lines can't be deleted — that would
// orphan its history. Remove those first (or keep the account).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/bank-accounts/[id]">) {
  const { id } = await ctx.params;
  const { result } = await updateState((state) => {
    if (!state.bankAccounts.some((a) => a.id === id)) return { error: "not_found" as const };
    const inUse =
      state.cashFlowMonths.some((m) => m.accountId === id) ||
      state.cashFlowItems.some((i) => i.accountId === id) ||
      state.bankTransactions.some((t) => t.accountId === id);
    if (inUse) return { error: "in_use" as const };
    state.bankAccounts = state.bankAccounts.filter((a) => a.id !== id);
    return { ok: true as const };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ error: "This account still has months, recurring items, or bank transactions" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
