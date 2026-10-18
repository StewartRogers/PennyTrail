import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { createAccount, createItem, deleteItem, patchEntry, patchItem, readStore, startMonth } from "../helpers/cashflowApi";

setupScratchDataDir();

async function setup() {
  const { body: account } = await createAccount();
  return account;
}

describe("POST /api/cashflow/items", () => {
  it("creates a bill that rolls forward and a deposit that rolls back by default", async () => {
    const account = await setup();
    const rent = await createItem({ accountId: account.id, name: "152 Rent (first)", kind: "bill", defaultAmount: 1500, recurrence: { type: "monthly", day: "last" } });
    expect(rent.status).toBe(201);
    expect(rent.body).toMatchObject({ roll: "next", settlement: "manual", amountMode: "fixed", active: true });
    const pay = await createItem({ accountId: account.id, name: "Kerri Pay", kind: "deposit", defaultAmount: 2400, settlement: "auto", owner: "KA", recurrence: { type: "semiMonthly", days: [15, "last"] } });
    expect(pay.body).toMatchObject({ roll: "previous", settlement: "auto", owner: "KA" });
  });

  it.each([
    [{ recurrence: { type: "monthly", day: 0 } }],
    [{ recurrence: { type: "monthly", day: 32 } }],
    [{ recurrence: { type: "semiMonthly", days: [15, 15] } }],
    [{ recurrence: { type: "everyNWeeks", n: 2, anchorDate: "2026-02-30" } }],
    [{ recurrence: { type: "everyNMonths", n: 0, day: 1, anchorMonth: "2026-10" } }],
    [{ recurrence: { type: "weekly" } }],
    [{ kind: "transfer" }],
    [{ defaultAmount: -5 }],
    [{ defaultAmount: "5" }],
    [{ roll: "sideways" }],
    [{ settlement: "maybe" }],
    [{ name: "" }],
  ])("rejects %j", async (override) => {
    const account = await setup();
    const res = await createItem({ accountId: account.id, name: "Bill", kind: "bill", defaultAmount: 10, recurrence: { type: "monthly", day: 1 }, ...override });
    expect(res.status).toBe(400);
    expect((await readStore()).cashFlowItems).toHaveLength(0);
  });

  it("rejects an unknown account", async () => {
    const res = await createItem({ accountId: "nope", name: "Bill", kind: "bill", defaultAmount: 10, recurrence: { type: "monthly", day: 1 } });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/cashflow/items/[id]", () => {
  it("changes future months only, unless asked to update outstanding entries", async () => {
    const account = await setup();
    const { body: item } = await createItem({ accountId: account.id, name: "Insurance", kind: "bill", defaultAmount: 27.65, recurrence: { type: "monthly", day: 9 } });
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1000 });
    const [entry] = oct.entries;
    // Post October's, then start November.
    await patchEntry(entry.id, { status: "posted", actualAmount: 27.65 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });

    const plain = await patchItem(item.id, { defaultAmount: 28.92, name: "152 Home Insurance" });
    expect(plain.status).toBe(200);
    expect(plain.body.updatedEntries).toBe(0);
    let state = await readStore();
    expect(state.cashFlowEntries.find((e) => e.monthId === nov.month.id)!.expectedAmount).toBe(27.65);

    const applied = await patchItem(item.id, { defaultAmount: 28.92, applyToOutstanding: true });
    expect(applied.body.updatedEntries).toBe(1);
    state = await readStore();
    const novEntry = state.cashFlowEntries.find((e) => e.monthId === nov.month.id)!;
    expect(novEntry).toMatchObject({ expectedAmount: 28.92, name: "152 Home Insurance" });
    // October's posted entry is history and keeps its amount and name.
    expect(state.cashFlowEntries.find((e) => e.id === entry.id)).toMatchObject({ expectedAmount: 27.65, name: "Insurance" });
    // November's opening carried from October and its projection followed.
    const novMonth = state.cashFlowMonths.find((m) => m.id === nov.month.id)!;
    expect(novMonth.openingSource).toBe("carried");
  });

  it("clears optional text with an empty string and toggles flags", async () => {
    const account = await setup();
    const { body: item } = await createItem({ accountId: account.id, name: "CTB", kind: "deposit", defaultAmount: 500, owner: "KA", matchText: "CCB", recurrence: { type: "monthly", day: 20 } });
    const { body } = await patchItem(item.id, { owner: "", matchText: "CANADA CHILD", dateUncertain: true, active: false });
    expect(body.item.owner).toBeUndefined();
    expect(body.item.matchText).toBe("CANADA CHILD");
    expect(body.item.dateUncertain).toBe(true);
    expect(body.item.active).toBe(false);
  });

  it("rejects an invalid schedule without saving the rest of the change", async () => {
    const account = await setup();
    const { body: item } = await createItem({ accountId: account.id, name: "Fortis", kind: "bill", defaultAmount: 40, recurrence: { type: "monthly", day: 26 } });
    expect((await patchItem(item.id, { name: "Renamed", recurrence: { type: "monthly", day: 40 } })).status).toBe(400);
    expect((await readStore()).cashFlowItems[0].name).toBe("Fortis");
  });
});

describe("DELETE /api/cashflow/items/[id]", () => {
  it("deletes an item with no entries", async () => {
    const account = await setup();
    const { body: item } = await createItem({ accountId: account.id, name: "Gym", kind: "bill", defaultAmount: 40, recurrence: { type: "monthly", day: 3 } });
    expect((await deleteItem(item.id)).body).toEqual({ deleted: true, deactivated: false });
    expect((await readStore()).cashFlowItems).toHaveLength(0);
  });

  it("deactivates an item that has history instead of deleting it", async () => {
    const account = await setup();
    const { body: item } = await createItem({ accountId: account.id, name: "Gym", kind: "bill", defaultAmount: 40, recurrence: { type: "monthly", day: 3 } });
    await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 100 });
    expect((await deleteItem(item.id)).body).toEqual({ deleted: false, deactivated: true });
    const state = await readStore();
    expect(state.cashFlowItems[0].active).toBe(false);
    expect(state.cashFlowEntries).toHaveLength(1);
  });
});
