import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { readJsonObject, readString } from "@/lib/request";
import { readMoney, readMonthKey } from "@/lib/cashflowRequest";
import { startMonth } from "@/lib/cashflow";

// Starts a month: default checkpoints, entries generated from the active
// recurring items, and the opening carried from the previous month — or the
// openingBalance given, which an account's first month requires.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const accountId = readString(body.accountId);
  const monthKey = readMonthKey(body.month);
  const openingBalance = body.openingBalance === undefined || body.openingBalance === null ? undefined : readMoney(body.openingBalance, { allowNegative: true });
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  if (!monthKey) return NextResponse.json({ error: "month must be yyyy-mm" }, { status: 400 });
  if (openingBalance === null) return NextResponse.json({ error: "Opening balance must be an amount" }, { status: 400 });

  const { result } = await updateState((state) => {
    const account = state.bankAccounts.find((a) => a.id === accountId);
    if (!account) return { error: "no_account" as const };
    const started = startMonth({
      account,
      monthKey,
      months: state.cashFlowMonths,
      entries: state.cashFlowEntries,
      items: state.cashFlowItems,
      openingBalance,
      newId: uid,
    });
    if ("error" in started) return { error: started.error };
    state.cashFlowMonths.push(started.month);
    state.cashFlowEntries.push(...started.entries);
    return started;
  });

  if ("error" in result) {
    if (result.error === "no_account") return NextResponse.json({ error: "Unknown account" }, { status: 400 });
    if (result.error === "exists") return NextResponse.json({ error: "That month has already been started" }, { status: 409 });
    return NextResponse.json({ error: "Enter an opening balance — there's no previous month to carry it from" }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
