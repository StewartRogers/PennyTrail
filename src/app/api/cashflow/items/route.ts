import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import { readKind, readMoney, readOptionalText, readRecurrence, readRoll, readSettlement } from "@/lib/cashflowRequest";
import type { CashFlowItem } from "@/lib/types";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const accountId = readString(body.accountId);
  const name = readString(body.name);
  const kind = readKind(body.kind);
  const defaultAmount = readMoney(body.defaultAmount);
  const recurrence = readRecurrence(body.recurrence);
  const amountMode = body.amountMode === "variable" ? "variable" : "fixed";
  // Bills move forward to the next business day, pay moves back.
  const roll = body.roll === undefined ? (kind === "deposit" ? "previous" : "next") : readRoll(body.roll);
  const settlement = body.settlement === undefined ? "manual" : readSettlement(body.settlement);
  const owner = readOptionalText(body.owner, 40);
  const matchText = readOptionalText(body.matchText, MAX_NAME_LENGTH);
  const notes = readOptionalText(body.notes, 1000);

  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > MAX_NAME_LENGTH) return NextResponse.json({ error: "Name is too long" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "kind must be bill or deposit" }, { status: 400 });
  if (defaultAmount === null) return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  if (!recurrence) return NextResponse.json({ error: "A valid schedule is required" }, { status: 400 });
  if (!roll) return NextResponse.json({ error: "roll must be next, previous, or none" }, { status: 400 });
  if (!settlement) return NextResponse.json({ error: "settlement must be manual, auto, or external" }, { status: 400 });
  if (!owner.ok || !matchText.ok || !notes.ok) return NextResponse.json({ error: "Owner, match text, or notes is invalid or too long" }, { status: 400 });

  const { result } = await updateState((state) => {
    if (!state.bankAccounts.some((a) => a.id === accountId)) return { error: "Unknown account" };
    const item: CashFlowItem = {
      id: uid("cfi"),
      accountId,
      name,
      kind,
      amountMode,
      defaultAmount,
      recurrence,
      roll,
      settlement,
      ...(body.dateUncertain === true ? { dateUncertain: true } : {}),
      ...(owner.value ? { owner: owner.value } : {}),
      ...(matchText.value ? { matchText: matchText.value } : {}),
      ...(notes.value ? { notes: notes.value } : {}),
      active: body.active !== false,
    };
    state.cashFlowItems.push(item);
    return { item };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.item, { status: 201 });
}
