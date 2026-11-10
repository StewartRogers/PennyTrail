import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { addEntry, createAccount, createItem, deleteMonth, patchEntry, patchMonth, readStore, startMonth } from "../helpers/cashflowApi";
import { sortPeriods, summarizeMonth } from "@/lib/cashflow";

setupScratchDataDir();

async function accountWithRent() {
  const { body: account } = await createAccount();
  await createItem({ accountId: account.id, name: "152 Rent (first)", kind: "bill", defaultAmount: 1500, recurrence: { type: "monthly", day: "last" } });
  await createItem({ accountId: account.id, name: "152 Rent (second)", kind: "bill", defaultAmount: 2661, recurrence: { type: "monthly", day: 1 } });
  return account;
}

describe("POST /api/cashflow/months", () => {
  it("starts October 2026 with default checkpoints and rolled rent", async () => {
    const account = await accountWithRent();
    const { status, body } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    expect(status).toBe(201);
    expect(sortPeriods(body.month.periods).map((p: { endDate: string }) => p.endDate)).toEqual(["2026-10-02", "2026-10-09", "2026-10-31"]);
    expect(body.entries.map((e: { name: string; dueDate: string; postingDate: string }) => [e.name, e.dueDate, e.postingDate])).toEqual([
      ["152 Rent (first)", "2026-09-30", "2026-10-01"],
      ["152 Rent (second)", "2026-10-01", "2026-10-01"],
    ]);
  });

  it("needs an opening balance for the first month, then carries it", async () => {
    const account = await accountWithRent();
    expect((await startMonth({ accountId: account.id, month: "2026-10" })).status).toBe(400);
    await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const { body } = await startMonth({ accountId: account.id, month: "2026-11" });
    // 10,000 − 31 × 50 − 1,500 − 2,661 = 4,289
    expect(body.month.openingBalance).toBe(4289);
    expect(body.month.openingSource).toBe("carried");
    // October 31's rent posts November 2, next to November 1's.
    expect(body.entries.filter((e: { postingDate: string }) => e.postingDate === "2026-11-02")).toHaveLength(2);
  });

  it("refuses to start a month twice", async () => {
    const account = await accountWithRent();
    await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    expect((await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 })).status).toBe(409);
    expect((await readStore()).cashFlowMonths).toHaveLength(1);
  });

  it("validates the month and the account", async () => {
    const account = await accountWithRent();
    expect((await startMonth({ accountId: account.id, month: "2026-13", openingBalance: 1 })).status).toBe(400);
    expect((await startMonth({ accountId: "nope", month: "2026-10", openingBalance: 1 })).status).toBe(400);
    expect((await startMonth({ accountId: account.id, month: "2026-10", openingBalance: "1" })).status).toBe(400);
  });
});

describe("PATCH /api/cashflow/months/[id]", () => {
  it("records a checkpoint and carries the change into the next month", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });
    const last = sortPeriods(oct.month.periods)[2];
    const { status } = await patchMonth(oct.month.id, { periods: [{ id: last.id, actualBalance: 5000.55 }] });
    expect(status).toBe(200);
    const state = await readStore();
    expect(state.cashFlowMonths.find((m) => m.id === nov.month.id)!.openingBalance).toBe(5000.55);
  });

  it("clears a checkpoint with null and the next month follows the projection again", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });
    const last = sortPeriods(oct.month.periods)[2];
    await patchMonth(oct.month.id, { periods: [{ id: last.id, actualBalance: 1 }] });
    await patchMonth(oct.month.id, { periods: [{ id: last.id, actualBalance: null }] });
    const state = await readStore();
    expect(state.cashFlowMonths.find((m) => m.id === nov.month.id)!.openingBalance).toBe(4289);
  });

  it("allows a negative balance but not a negative spend", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10 });
    const p = oct.month.periods[0];
    expect((await patchMonth(oct.month.id, { periods: [{ id: p.id, actualBalance: -42.5 }] })).status).toBe(200);
    expect((await patchMonth(oct.month.id, { periods: [{ id: p.id, spendOverride: -1 }] })).status).toBe(400);
  });

  it("sets a spend override and takes it out of the projection", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const p1 = sortPeriods(oct.month.periods)[0];
    await patchMonth(oct.month.id, { periods: [{ id: p1.id, spendOverride: 0 }] });
    const state = await readStore();
    const month = state.cashFlowMonths[0];
    const s = summarizeMonth(month, state.cashFlowEntries);
    expect(s.periods[0].spend).toBe(0);
    expect(s.projectedClose).toBe(10000 - 1450 - 1500 - 2661);
  });

  it("moves, adds, and removes checkpoints, keeping dates inside the month and distinct", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    const [p1, p2] = sortPeriods(oct.month.periods);
    expect((await patchMonth(oct.month.id, { periods: [{ id: p1.id, endDate: "2026-11-01" }] })).status).toBe(400);
    expect((await patchMonth(oct.month.id, { periods: [{ id: p1.id, endDate: p2.endDate }] })).status).toBe(400);
    expect((await patchMonth(oct.month.id, { addPeriod: { endDate: "2026-10-16" } })).body.month.periods).toHaveLength(4);
    expect((await patchMonth(oct.month.id, { removePeriodId: p1.id })).body.month.periods).toHaveLength(3);
    expect((await patchMonth(oct.month.id, { periods: [{ id: "nope", actualBalance: 1 }] })).status).toBe(400);
  });

  it("won't remove the last checkpoint", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    const [p1, p2, p3] = sortPeriods(oct.month.periods);
    await patchMonth(oct.month.id, { removePeriodId: p1.id });
    await patchMonth(oct.month.id, { removePeriodId: p2.id });
    expect((await patchMonth(oct.month.id, { removePeriodId: p3.id })).status).toBe(400);
  });

  it("sets every entry back to Planned with resetStatuses, as setting each by hand would", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const [first, second] = oct.entries;
    await patchEntry(first.id, { status: "posted", postedDate: "2026-10-02", actualAmount: 1490, confirmationCode: "123" });
    await patchEntry(second.id, { status: "skipped" });
    const { status, body } = await patchMonth(oct.month.id, { resetStatuses: true });
    expect(status).toBe(200);
    expect(body.reset).toBe(2);
    const entries = (await readStore()).cashFlowEntries;
    const a = entries.find((e) => e.id === first.id)!;
    expect(a).toMatchObject({ status: "planned", postingDate: first.postingDate, actualAmount: 1490, confirmationCode: "123", monthId: oct.month.id });
    expect(a.postedDate).toBeUndefined();
    expect(entries.find((e) => e.id === second.id)!.status).toBe("planned");
    expect((await patchMonth(oct.month.id, { resetStatuses: true })).body.reset).toBe(0);
  });

  it("adds a newly created item's entries with regenerate, without duplicating", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    await createItem({ accountId: account.id, name: "Fortis", kind: "bill", defaultAmount: 40, recurrence: { type: "monthly", day: 26 } });
    expect((await patchMonth(oct.month.id, { regenerate: true })).body.generated).toBe(1);
    expect((await patchMonth(oct.month.id, { regenerate: true })).body.generated).toBe(0);
    expect((await readStore()).cashFlowEntries).toHaveLength(3);
  });

  it("switches an opening back to carried", async () => {
    const account = await accountWithRent();
    await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11", openingBalance: 1 });
    expect(nov.month.openingSource).toBe("manual");
    const { body } = await patchMonth(nov.month.id, { openingSource: "carried" });
    expect(body.month.openingBalance).toBe(4289);
  });

  it("can't carry an opening when there's no previous month", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    expect((await patchMonth(oct.month.id, { openingSource: "carried" })).status).toBe(400);
  });

  it("a manual opening stops the carry", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });
    await patchMonth(nov.month.id, { openingBalance: 7777 });
    await addEntry({ monthId: oct.month.id, name: "Bonus", kind: "deposit", postingDate: "2026-10-20", expectedAmount: 1000 });
    expect((await readStore()).cashFlowMonths.find((m) => m.id === nov.month.id)!.openingBalance).toBe(7777);
  });
});

describe("DELETE /api/cashflow/months/[id]", () => {
  it("requires { confirm: true }", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1 });
    expect((await deleteMonth(oct.month.id)).status).toBe(400);
    expect((await deleteMonth(oct.month.id, { confirm: "yes" })).status).toBe(400);
    expect((await readStore()).cashFlowMonths).toHaveLength(1);
    const { status, body } = await deleteMonth(oct.month.id, { confirm: true });
    expect(status).toBe(200);
    expect(body.deletedEntries).toBe(2);
    const state = await readStore();
    expect(state.cashFlowMonths).toHaveLength(0);
    expect(state.cashFlowEntries).toHaveLength(0);
  });
});

describe("month math through the API", () => {
  it("posting an actual amount different from the estimate moves the projection by the difference", async () => {
    const account = await accountWithRent();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 10000 });
    const before = summarizeMonth(oct.month, oct.entries).projectedClose;
    const rent = oct.entries[0];
    await patchEntry(rent.id, { status: "posted", actualAmount: 1500.01 });
    const state = await readStore();
    const after = summarizeMonth(state.cashFlowMonths[0], state.cashFlowEntries).projectedClose;
    expect(Math.round((before - after) * 100)).toBe(1);
  });
});
