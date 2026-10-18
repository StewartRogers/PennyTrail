import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";
import { readIsoDate, readMoney } from "@/lib/cashflowRequest";
import { generateMonthEntries } from "@/lib/cashflow";
import { addMonths, monthKeyOf } from "@/lib/dates";
import { detachEntries, refreshOpeningOf, refreshOpeningsFrom } from "@/lib/cashflowState";
import type { CashFlowPeriod } from "@/lib/types";

const MAX_PERIODS = 10;

interface PeriodPatch {
  id: string;
  endDate?: string;
  label?: string;
  spendOverride?: number | null;
  actualBalance?: number | null;
}

function readPeriodPatches(value: unknown): PeriodPatch[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERIODS) return null;
  const patches: PeriodPatch[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || typeof raw.id !== "string") return null;
    const p: PeriodPatch = { id: raw.id };
    if (raw.endDate !== undefined) {
      const d = readIsoDate(raw.endDate);
      if (!d) return null;
      p.endDate = d;
    }
    if (raw.label !== undefined) {
      if (typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > MAX_NAME_LENGTH) return null;
      p.label = raw.label.trim();
    }
    for (const field of ["spendOverride", "actualBalance"] as const) {
      if (raw[field] === undefined) continue;
      if (raw[field] === null) {
        p[field] = null;
        continue;
      }
      // A balance can be negative (overdrawn); a spend estimate can't.
      const amount = readMoney(raw[field], { allowNegative: field === "actualBalance" });
      if (amount === null) return null;
      p[field] = amount;
    }
    patches.push(p);
  }
  return patches;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/cashflow/months/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  const openingBalance = body.openingBalance === undefined ? undefined : readMoney(body.openingBalance, { allowNegative: true });
  if (openingBalance === null) return NextResponse.json({ error: "Opening balance must be an amount" }, { status: 400 });
  if (body.openingSource !== undefined && body.openingSource !== "carried") {
    return NextResponse.json({ error: 'openingSource can only be set to "carried" (enter an openingBalance to set it by hand)' }, { status: 400 });
  }
  const rate = body.dailySpendRate === undefined ? undefined : readMoney(body.dailySpendRate);
  if (rate === null) return NextResponse.json({ error: "Daily spend rate must be a non-negative amount" }, { status: 400 });
  if (body.closed !== undefined && typeof body.closed !== "boolean") return NextResponse.json({ error: "closed must be true or false" }, { status: 400 });
  const patches = body.periods === undefined ? [] : readPeriodPatches(body.periods);
  if (patches === null) return NextResponse.json({ error: "Each period change needs an id and valid dates or amounts" }, { status: 400 });
  const addEndDate = body.addPeriod === undefined ? undefined : readIsoDate(body.addPeriod?.endDate);
  if (addEndDate === null) return NextResponse.json({ error: "A new checkpoint needs an endDate" }, { status: 400 });
  if (body.removePeriodId !== undefined && typeof body.removePeriodId !== "string") return NextResponse.json({ error: "removePeriodId must be an id" }, { status: 400 });

  const { result } = await updateState((state) => {
    const month = state.cashFlowMonths.find((m) => m.id === id);
    if (!month) return { error: "not_found" as const };

    if (openingBalance !== undefined) {
      month.openingBalance = openingBalance;
      month.openingSource = "manual";
    }
    if (body.openingSource === "carried") {
      if (!state.cashFlowMonths.some((m) => m.accountId === month.accountId && m.month === addMonths(month.month, -1))) {
        return { error: "no_previous" as const };
      }
      month.openingSource = "carried";
    }
    if (rate !== undefined) month.dailySpendRate = rate;
    if (typeof body.closed === "boolean") month.closed = body.closed;

    for (const patch of patches) {
      const period = month.periods.find((p) => p.id === patch.id);
      if (!period) return { error: "unknown_period" as const };
      if (patch.endDate) period.endDate = patch.endDate;
      if (patch.label) period.label = patch.label;
      if (patch.spendOverride === null) delete period.spendOverride;
      else if (patch.spendOverride !== undefined) period.spendOverride = patch.spendOverride;
      if (patch.actualBalance === null) delete period.actualBalance;
      else if (patch.actualBalance !== undefined) period.actualBalance = patch.actualBalance;
    }
    if (addEndDate) {
      if (month.periods.length >= MAX_PERIODS) return { error: "too_many" as const };
      const period: CashFlowPeriod = { id: uid("cfp"), endDate: addEndDate, label: "End of week" };
      month.periods.push(period);
    }
    if (typeof body.removePeriodId === "string") {
      if (!month.periods.some((p) => p.id === body.removePeriodId)) return { error: "unknown_period" as const };
      if (month.periods.length <= 1) return { error: "last_period" as const };
      month.periods = month.periods.filter((p) => p.id !== body.removePeriodId);
    }
    // Checkpoints have to be distinct days inside the month.
    const dates = month.periods.map((p) => p.endDate);
    if (dates.some((d) => monthKeyOf(d) !== month.month)) return { error: "outside_month" as const };
    if (new Set(dates).size !== dates.length) return { error: "duplicate_checkpoint" as const };

    let generated = 0;
    if (body.regenerate === true) {
      const account = state.bankAccounts.find((a) => a.id === month.accountId);
      const created = generateMonthEntries({
        items: state.cashFlowItems,
        month,
        holidays: account?.bankHolidays ?? [],
        existing: state.cashFlowEntries,
        newId: () => uid("cfe"),
      });
      state.cashFlowEntries.push(...created);
      generated = created.length;
    }

    if (body.openingSource === "carried") refreshOpeningOf(state, month);
    refreshOpeningsFrom(state, month);
    return { month, generated };
  });

  if ("error" in result) {
    const messages: Record<string, [string, number]> = {
      not_found: ["Month not found", 404],
      no_previous: ["There's no previous month to carry the opening balance from", 400],
      unknown_period: ["Unknown checkpoint", 400],
      too_many: [`A month can have at most ${MAX_PERIODS} checkpoints`, 400],
      last_period: ["A month needs at least one checkpoint", 400],
      outside_month: ["Checkpoint dates must be inside the month", 400],
      duplicate_checkpoint: ["Two checkpoints can't share a date", 400],
    };
    const [message, status] = messages[result.error as string];
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(result);
}

// Deleting a month removes its entries too, so it has to be asked for
// explicitly with `{ confirm: true }` — a missing or garbled body is a 400.
export async function DELETE(request: Request, ctx: RouteContext<"/api/cashflow/months/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);
  if (body.confirm !== true) {
    return NextResponse.json({ error: "Deleting a month removes its entries — send { confirm: true }" }, { status: 400 });
  }
  const { result } = await updateState((state) => {
    const month = state.cashFlowMonths.find((m) => m.id === id);
    if (!month) return { error: "not_found" as const };
    const removed = new Set(state.cashFlowEntries.filter((e) => e.monthId === id).map((e) => e.id));
    state.cashFlowEntries = state.cashFlowEntries.filter((e) => e.monthId !== id);
    state.cashFlowMonths = state.cashFlowMonths.filter((m) => m.id !== id);
    detachEntries(state, removed);
    return { deletedEntries: removed.size };
  });
  if ("error" in result) return NextResponse.json({ error: "Month not found" }, { status: 404 });
  return NextResponse.json(result);
}
