import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import { readIsoDate, readKind, readMoney, readOptionalText, readSettlement } from "@/lib/cashflowRequest";
import { monthKeyOf } from "@/lib/dates";
import { refreshOpeningsFrom } from "@/lib/cashflowState";
import type { CashFlowEntry } from "@/lib/types";

// Adds a one-off entry (not from a recurring item) to a month.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const monthId = readString(body.monthId);
  const name = readString(body.name);
  const kind = readKind(body.kind);
  const postingDate = readIsoDate(body.postingDate);
  const expectedAmount = readMoney(body.expectedAmount);
  const settlement = body.settlement === undefined ? "manual" : readSettlement(body.settlement);
  const notes = readOptionalText(body.notes, 1000);

  if (!monthId) return NextResponse.json({ error: "monthId is required" }, { status: 400 });
  if (!name || name.length > MAX_NAME_LENGTH) return NextResponse.json({ error: "Name is required and must be short" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "kind must be bill or deposit" }, { status: 400 });
  if (!postingDate) return NextResponse.json({ error: "A date is required" }, { status: 400 });
  if (expectedAmount === null) return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  if (!settlement) return NextResponse.json({ error: "settlement must be manual, auto, or external" }, { status: 400 });
  if (!notes.ok) return NextResponse.json({ error: "Notes are too long" }, { status: 400 });

  const { result } = await updateState((state) => {
    const month = state.cashFlowMonths.find((m) => m.id === monthId);
    if (!month) return { error: "Unknown month" };
    if (monthKeyOf(postingDate) !== month.month) return { error: "The date must be inside the month" };
    const entry: CashFlowEntry = {
      id: uid("cfe"),
      monthId,
      itemId: null,
      name,
      kind,
      dueDate: postingDate,
      postingDate,
      expectedAmount,
      status: "planned",
      settlement,
      ...(notes.value ? { notes: notes.value } : {}),
    };
    state.cashFlowEntries.push(entry);
    refreshOpeningsFrom(state, month);
    return { entry };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.entry, { status: 201 });
}
