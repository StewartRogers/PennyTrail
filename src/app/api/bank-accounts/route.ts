import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import { readMoney } from "@/lib/cashflowRequest";
import { initialBankHolidays } from "@/lib/businessDays";
import type { BankAccount } from "@/lib/types";

const ACCOUNT_COLORS = ["oklch(0.55 0.13 160)", "oklch(0.55 0.13 250)", "oklch(0.55 0.13 25)", "oklch(0.55 0.13 300)"];

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const name = readString(body.name);
  const institution = readString(body.institution);
  const last4 = readString(body.last4);
  if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  if (name.length > MAX_NAME_LENGTH || institution.length > MAX_NAME_LENGTH || last4.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Account details are too long" }, { status: 400 });
  }
  const rate = body.dailySpendRate === undefined ? 50 : readMoney(body.dailySpendRate);
  if (rate === null) return NextResponse.json({ error: "Daily spend rate must be a non-negative amount" }, { status: 400 });
  const threshold = body.lowBalanceThreshold === undefined || body.lowBalanceThreshold === null ? undefined : readMoney(body.lowBalanceThreshold, { allowNegative: true });
  if (threshold === null) return NextResponse.json({ error: "Low-balance threshold must be an amount" }, { status: 400 });

  const { result } = await updateState((state) => {
    const account: BankAccount = {
      id: uid("acct"),
      name,
      institution,
      last4,
      color: ACCOUNT_COLORS[state.bankAccounts.length % ACCOUNT_COLORS.length],
      dailySpendRate: rate,
      bankHolidays: initialBankHolidays(),
      ...(threshold !== undefined ? { lowBalanceThreshold: threshold } : {}),
    };
    state.bankAccounts.push(account);
    return account;
  });
  return NextResponse.json(result, { status: 201 });
}
