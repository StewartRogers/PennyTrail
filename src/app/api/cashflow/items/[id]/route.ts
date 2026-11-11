import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import { readKind, readMoney, readOptionalText, readRecurrence, readRoll, readSettlement } from "@/lib/cashflowRequest";
import { expectedAmountFor, isOutstanding } from "@/lib/cashflow";
import { refreshOpeningsFrom } from "@/lib/cashflowState";

// Edits apply to future months. With `applyToOutstanding: true`, entries of
// this item that are still planned or scheduled also take the new name,
// kind, amount, and settlement — posted and skipped ones are history and
// never change.
export async function PATCH(request: Request, ctx: RouteContext<"/api/cashflow/items/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  const name = body.name === undefined ? undefined : readString(body.name);
  if (name !== undefined && (!name || name.length > MAX_NAME_LENGTH)) return NextResponse.json({ error: "Name is required and must be short" }, { status: 400 });
  const kind = body.kind === undefined ? undefined : readKind(body.kind);
  if (kind === null) return NextResponse.json({ error: "kind must be bill or deposit" }, { status: 400 });
  const defaultAmount = body.defaultAmount === undefined ? undefined : readMoney(body.defaultAmount);
  if (defaultAmount === null) return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  const recurrence = body.recurrence === undefined ? undefined : readRecurrence(body.recurrence);
  if (recurrence === null) return NextResponse.json({ error: "A valid schedule is required" }, { status: 400 });
  const roll = body.roll === undefined ? undefined : readRoll(body.roll);
  if (roll === null) return NextResponse.json({ error: "roll must be next, previous, or none" }, { status: 400 });
  const settlement = body.settlement === undefined ? undefined : readSettlement(body.settlement);
  if (settlement === null) return NextResponse.json({ error: "settlement must be manual, auto, or external" }, { status: 400 });
  if (body.amountMode !== undefined && body.amountMode !== "fixed" && body.amountMode !== "variable") {
    return NextResponse.json({ error: "amountMode must be fixed or variable" }, { status: 400 });
  }
  const owner = readOptionalText(body.owner, 40);
  const matchText = readOptionalText(body.matchText, MAX_NAME_LENGTH);
  const notes = readOptionalText(body.notes, 1000);
  if (!owner.ok || !matchText.ok || !notes.ok) return NextResponse.json({ error: "Owner, match text, or notes is invalid or too long" }, { status: 400 });

  const { result } = await updateState((state) => {
    const item = state.cashFlowItems.find((i) => i.id === id);
    if (!item) return { error: "not_found" as const };
    if (name !== undefined) item.name = name;
    if (kind) item.kind = kind;
    if (defaultAmount !== undefined) item.defaultAmount = defaultAmount;
    if (recurrence) item.recurrence = recurrence;
    if (roll) item.roll = roll;
    if (settlement) item.settlement = settlement;
    if (body.amountMode === "fixed" || body.amountMode === "variable") item.amountMode = body.amountMode;
    if (typeof body.dateUncertain === "boolean") {
      if (body.dateUncertain) item.dateUncertain = true;
      else delete item.dateUncertain;
    }
    if (typeof body.active === "boolean") item.active = body.active;
    for (const [field, read] of [["owner", owner], ["matchText", matchText], ["notes", notes]] as const) {
      if (body[field] === undefined) continue;
      if (read.ok && read.value) item[field] = read.value;
      else delete item[field];
    }

    let updated = 0;
    if (body.applyToOutstanding === true) {
      const touched = new Set<string>();
      for (const e of state.cashFlowEntries) {
        if (e.itemId !== item.id || !isOutstanding(e)) continue;
        e.name = item.name;
        e.kind = item.kind;
        e.settlement = item.settlement;
        e.expectedAmount = expectedAmountFor(item, state.cashFlowEntries);
        if (item.dateUncertain) e.dateUncertain = true;
        else delete e.dateUncertain;
        touched.add(e.monthId);
        updated++;
      }
      for (const m of state.cashFlowMonths) if (touched.has(m.id)) refreshOpeningsFrom(state, m);
    }
    return { item, updatedEntries: updated };
  });
  if ("error" in result) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  return NextResponse.json(result);
}

// An item that has entries is deactivated instead of deleted, so its history
// keeps its link; one with none is removed outright.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/cashflow/items/[id]">) {
  const { id } = await ctx.params;
  const { result } = await updateState((state) => {
    const item = state.cashFlowItems.find((i) => i.id === id);
    if (!item) return { error: "not_found" as const };
    if (state.cashFlowEntries.some((e) => e.itemId === id)) {
      item.active = false;
      return { deleted: false, deactivated: true };
    }
    state.cashFlowItems = state.cashFlowItems.filter((i) => i.id !== id);
    return { deleted: true, deactivated: false };
  });
  if ("error" in result) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  return NextResponse.json(result);
}
