import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import { readIsoDate, readKind, readMoney, readOptionalText, readSettlement, readStatus } from "@/lib/cashflowRequest";
import { entryDate } from "@/lib/cashflow";
import { detachEntries, findMonthFor, refreshOpeningsFrom } from "@/lib/cashflowState";

// Optional nullable fields: undefined = leave alone, null = clear.
function nullable<T>(value: unknown, read: (v: unknown) => T | null): { ok: true; value: T | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  const read_ = read(value);
  return read_ === null ? { ok: false } : { ok: true, value: read_ };
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/cashflow/entries/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  const name = body.name === undefined ? undefined : readString(body.name);
  if (name !== undefined && (!name || name.length > MAX_NAME_LENGTH)) return NextResponse.json({ error: "Name is required and must be short" }, { status: 400 });
  const kind = body.kind === undefined ? undefined : readKind(body.kind);
  const status = body.status === undefined ? undefined : readStatus(body.status);
  const settlement = body.settlement === undefined ? undefined : readSettlement(body.settlement);
  const expectedAmount = body.expectedAmount === undefined ? undefined : readMoney(body.expectedAmount);
  const postingDate = body.postingDate === undefined ? undefined : readIsoDate(body.postingDate);
  const actualAmount = nullable(body.actualAmount, (v) => readMoney(v));
  const postedDate = nullable(body.postedDate, readIsoDate);
  const scheduledDate = nullable(body.scheduledDate, readIsoDate);
  const confirmationCode = readOptionalText(body.confirmationCode, 100);
  const notes = readOptionalText(body.notes, 1000);
  if (kind === null) return NextResponse.json({ error: "kind must be bill or deposit" }, { status: 400 });
  if (status === null) return NextResponse.json({ error: "status must be planned, scheduled, posted, or skipped" }, { status: 400 });
  if (settlement === null) return NextResponse.json({ error: "settlement must be manual, auto, or external" }, { status: 400 });
  if (expectedAmount === null || !actualAmount.ok) return NextResponse.json({ error: "Amounts must be non-negative numbers" }, { status: 400 });
  if (postingDate === null || !postedDate.ok || !scheduledDate.ok) return NextResponse.json({ error: "Dates must be valid (yyyy-mm-dd)" }, { status: 400 });
  if (!confirmationCode.ok || !notes.ok) return NextResponse.json({ error: "Confirmation number or notes is invalid or too long" }, { status: 400 });

  const { result } = await updateState((state) => {
    const entry = state.cashFlowEntries.find((e) => e.id === id);
    if (!entry) return { error: "not_found" as const };
    const before = state.cashFlowMonths.find((m) => m.id === entry.monthId);
    if (!before) return { error: "not_found" as const };

    if (name !== undefined) entry.name = name;
    if (kind) entry.kind = kind;
    if (settlement) entry.settlement = settlement;
    if (expectedAmount !== undefined) entry.expectedAmount = expectedAmount;
    if (postingDate) entry.postingDate = postingDate;
    if (actualAmount.value === null) delete entry.actualAmount;
    else if (actualAmount.value !== undefined) entry.actualAmount = actualAmount.value;
    if (scheduledDate.value === null) delete entry.scheduledDate;
    else if (scheduledDate.value !== undefined) entry.scheduledDate = scheduledDate.value;
    if (body.confirmationCode !== undefined) {
      if (confirmationCode.value) entry.confirmationCode = confirmationCode.value;
      else delete entry.confirmationCode;
    }
    if (body.notes !== undefined) {
      if (notes.value) entry.notes = notes.value;
      else delete entry.notes;
    }
    if (typeof body.dateUncertain === "boolean") {
      if (body.dateUncertain) entry.dateUncertain = true;
      else delete entry.dateUncertain;
    }
    if (postedDate.value === null) delete entry.postedDate;
    else if (postedDate.value !== undefined) entry.postedDate = postedDate.value;

    if (status) entry.status = status;
    if (entry.status === "posted") {
      // Done means posted: a posted entry always has the date it posted.
      entry.postedDate = entry.postedDate ?? entry.postingDate;
    } else {
      delete entry.postedDate;
      // No longer settled, so no longer settled by a bank line either.
      if (entry.bankTransactionId) {
        detachEntries(state, new Set([entry.id]));
        delete entry.bankTransactionId;
      }
    }

    // The date decides the month: a payment that slid into the next month
    // moves there, but only into a month that has been started.
    const target = findMonthFor(state, before.accountId, entryDate(entry));
    if (!target) return { error: "no_month" as const };
    entry.monthId = target.id;
    refreshOpeningsFrom(state, before);
    if (target.id !== before.id) refreshOpeningsFrom(state, target);
    return { entry };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ error: "That date is in a month that hasn't been started yet" }, { status: 400 });
  }
  return NextResponse.json(result.entry);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cashflow/entries/[id]">) {
  const { id } = await ctx.params;
  const { result } = await updateState((state) => {
    const entry = state.cashFlowEntries.find((e) => e.id === id);
    if (!entry) return { error: "not_found" as const };
    state.cashFlowEntries = state.cashFlowEntries.filter((e) => e.id !== id);
    detachEntries(state, new Set([id]));
    const month = state.cashFlowMonths.find((m) => m.id === entry.monthId);
    if (month) refreshOpeningsFrom(state, month);
    return { ok: true as const };
  });
  if ("error" in result) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
