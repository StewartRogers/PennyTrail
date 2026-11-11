import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { addEntry, createAccount, deleteEntry, patchEntry, readStore, startMonth } from "../helpers/cashflowApi";

setupScratchDataDir();

async function october() {
  const { body: account } = await createAccount();
  const { body } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 5000 });
  return { account, month: body.month };
}

describe("POST /api/cashflow/entries", () => {
  it("adds a one-off entry", async () => {
    const { month } = await october();
    const { status, body } = await addEntry({ monthId: month.id, name: "AMEX", kind: "bill", postingDate: "2026-10-19", expectedAmount: 1571.06 });
    expect(status).toBe(201);
    expect(body).toMatchObject({ itemId: null, status: "projected", settlement: "manual", dueDate: "2026-10-19", postingDate: "2026-10-19", expectedAmount: 1571.06 });
  });

  it("rejects a date outside the month, a bad amount, and an unknown month", async () => {
    const { month } = await october();
    expect((await addEntry({ monthId: month.id, name: "X", kind: "bill", postingDate: "2026-11-01", expectedAmount: 1 })).status).toBe(400);
    expect((await addEntry({ monthId: month.id, name: "X", kind: "bill", postingDate: "2026-10-01", expectedAmount: -1 })).status).toBe(400);
    expect((await addEntry({ monthId: month.id, name: "X", kind: "loan", postingDate: "2026-10-01", expectedAmount: 1 })).status).toBe(400);
    expect((await addEntry({ monthId: "nope", name: "X", kind: "bill", postingDate: "2026-10-01", expectedAmount: 1 })).status).toBe(400);
    expect((await readStore()).cashFlowEntries).toHaveLength(0);
  });

  it("rounds amounts to the cent", async () => {
    const { month } = await october();
    const { body } = await addEntry({ monthId: month.id, name: "X", kind: "bill", postingDate: "2026-10-01", expectedAmount: 0.1 + 0.2 });
    expect(body.expectedAmount).toBe(0.3);
  });
});

describe("PATCH /api/cashflow/entries/[id]", () => {
  async function entry() {
    const ctx = await october();
    const { body } = await addEntry({ monthId: ctx.month.id, name: "Rogers (Mastercard)", kind: "bill", postingDate: "2026-10-09", expectedAmount: 120 });
    return { ...ctx, entry: body };
  }

  it("schedules with a date and confirmation number", async () => {
    const { entry: e } = await entry();
    const { body } = await patchEntry(e.id, { scheduledDate: "2026-10-05", confirmationCode: " 104237 " });
    expect(body).toMatchObject({ status: "projected", scheduledDate: "2026-10-05", confirmationCode: "104237" });
  });

  it("no longer accepts the retired statuses", async () => {
    const { entry: e } = await entry();
    for (const status of ["planned", "scheduled", "posted"]) expect((await patchEntry(e.id, { status })).status).toBe(400);
  });

  it("posts on the expected date by default, or on the date given", async () => {
    const { entry: e } = await entry();
    expect((await patchEntry(e.id, { status: "actual" })).body.postedDate).toBe("2026-10-09");
    expect((await patchEntry(e.id, { postedDate: "2026-10-13" })).body.postedDate).toBe("2026-10-13");
  });

  it("stamps a confirmation number with when it was entered", async () => {
    const { entry: e } = await entry();
    const before = Date.now();
    const first = (await patchEntry(e.id, { confirmationCode: "104237" })).body;
    const stamped = Date.parse(first.confirmationRecordedAt);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    // The same number again, or another edit, keeps the time.
    expect((await patchEntry(e.id, { confirmationCode: "104237" })).body.confirmationRecordedAt).toBe(first.confirmationRecordedAt);
    expect((await patchEntry(e.id, { notes: "n" })).body.confirmationRecordedAt).toBe(first.confirmationRecordedAt);
    // A new number gets a new time; clearing it removes both.
    await new Promise((r) => setTimeout(r, 5));
    const second = (await patchEntry(e.id, { confirmationCode: "104999" })).body;
    expect(second.confirmationCode).toBe("104999");
    expect(second.confirmationRecordedAt > first.confirmationRecordedAt).toBe(true);
    const cleared = (await patchEntry(e.id, { confirmationCode: "" })).body;
    expect(cleared.confirmationCode).toBeUndefined();
    expect(cleared.confirmationRecordedAt).toBeUndefined();
  });

  it("moves the due date along with a date changed by hand", async () => {
    const { entry: e } = await entry();
    expect((await patchEntry(e.id, { postingDate: "2026-10-13" })).body).toMatchObject({ postingDate: "2026-10-13", dueDate: "2026-10-13" });
    expect((await patchEntry(e.id, { status: "actual", postedDate: "2026-10-14" })).body).toMatchObject({ postedDate: "2026-10-14", dueDate: "2026-10-14" });
    // Changing something else leaves it alone.
    expect((await patchEntry(e.id, { notes: "paid online" })).body.dueDate).toBe("2026-10-14");
  });

  it("clears the posted date when it's no longer posted", async () => {
    const { entry: e } = await entry();
    await patchEntry(e.id, { status: "actual", postedDate: "2026-10-10", actualAmount: 123.57 });
    const { body } = await patchEntry(e.id, { status: "projected" });
    expect(body.postedDate).toBeUndefined();
    expect(body.actualAmount).toBe(123.57); // the amount correction stays
  });

  it("clears optional fields with null or an empty string", async () => {
    const { entry: e } = await entry();
    await patchEntry(e.id, { scheduledDate: "2026-10-05", confirmationCode: "1", notes: "n", actualAmount: 5 });
    const { body } = await patchEntry(e.id, { scheduledDate: null, confirmationCode: "", notes: "", actualAmount: null });
    expect(body.scheduledDate).toBeUndefined();
    expect(body.confirmationCode).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.actualAmount).toBeUndefined();
  });

  it("moves an entry that posted in the next month into that month", async () => {
    const { account, entry: e } = await entry();
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });
    const { status, body } = await patchEntry(e.id, { status: "actual", postedDate: "2026-11-02" });
    expect(status).toBe(200);
    expect(body.monthId).toBe(nov.month.id);
  });

  it("refuses a date in a month that hasn't been started, and saves nothing", async () => {
    const { entry: e } = await entry();
    const res = await patchEntry(e.id, { status: "actual", postedDate: "2026-11-02", actualAmount: 999 });
    expect(res.status).toBe(400);
    const stored = (await readStore()).cashFlowEntries[0];
    expect(stored).toMatchObject({ status: "projected", expectedAmount: 120 });
    expect(stored.actualAmount).toBeUndefined();
  });

  it.each([
    [{ status: "paid" }],
    [{ kind: "loan" }],
    [{ expectedAmount: -1 }],
    [{ actualAmount: "12" }],
    [{ postingDate: "2026-10-32" }],
    [{ name: "" }],
  ])("rejects %j", async (patch) => {
    const { entry: e } = await entry();
    expect((await patchEntry(e.id, patch)).status).toBe(400);
  });

  it("returns 404 for an unknown entry", async () => {
    expect((await patchEntry("nope", { status: "actual" })).status).toBe(404);
  });
});

describe("DELETE /api/cashflow/entries/[id]", () => {
  it("removes the entry", async () => {
    const { month } = await october();
    const { body: e } = await addEntry({ monthId: month.id, name: "X", kind: "bill", postingDate: "2026-10-01", expectedAmount: 1 });
    expect((await deleteEntry(e.id)).status).toBe(200);
    expect((await readStore()).cashFlowEntries).toHaveLength(0);
    expect((await deleteEntry(e.id)).status).toBe(404);
  });
});
