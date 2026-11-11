import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { createAccount, createItem, deleteAccount, patchAccount, readStore } from "../helpers/cashflowApi";

setupScratchDataDir();

describe("POST /api/bank-accounts", () => {
  it("creates an account with a $50 daily rate and prefilled bank holidays", async () => {
    const { status, body } = await createAccount();
    expect(status).toBe(201);
    expect(body).toMatchObject({ name: "Chequing", institution: "Bank", last4: "0000", dailySpendRate: 50 });
    expect(body.bankHolidays).toContain("2026-09-30");
    expect(body.bankHolidays).toContain("2024-01-01");
    expect((await readStore()).bankAccounts).toHaveLength(1);
  });

  it("rejects a missing name, a negative rate, and a non-numeric threshold", async () => {
    expect((await createAccount({ name: "" })).status).toBe(400);
    expect((await createAccount({ dailySpendRate: -1 })).status).toBe(400);
    expect((await createAccount({ dailySpendRate: "50" })).status).toBe(400);
    expect((await createAccount({ lowBalanceThreshold: "low" })).status).toBe(400);
    expect((await readStore()).bankAccounts).toHaveLength(0);
  });

  it("rounds the daily rate to the cent", async () => {
    expect((await createAccount({ dailySpendRate: 49.999 })).body.dailySpendRate).toBe(50);
  });
});

describe("PATCH /api/bank-accounts/[id]", () => {
  it("updates details, the rate, the threshold, and the holiday list", async () => {
    const { body: account } = await createAccount();
    const { status, body } = await patchAccount(account.id, {
      name: "Joint chequing",
      dailySpendRate: 60,
      lowBalanceThreshold: 1000,
      bankHolidays: ["2026-12-25", "2026-01-01", "2026-12-25"],
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "Joint chequing", dailySpendRate: 60, lowBalanceThreshold: 1000 });
    expect(body.bankHolidays).toEqual(["2026-01-01", "2026-12-25"]); // sorted, de-duplicated
  });

  it("clears the threshold with null", async () => {
    const { body: account } = await createAccount({ lowBalanceThreshold: 500 });
    const { body } = await patchAccount(account.id, { lowBalanceThreshold: null });
    expect(body.lowBalanceThreshold).toBeUndefined();
  });

  it("saves a valid import mapping and rejects an incomplete one", async () => {
    const { body: account } = await createAccount();
    const mapping = { dateCol: 0, descCol: 1, outCol: 2, inCol: 3, dateFormat: "MM/DD/YYYY" };
    expect((await patchAccount(account.id, { importMapping: mapping })).body.importMapping).toEqual(mapping);
    expect((await patchAccount(account.id, { importMapping: { ...mapping, outCol: -1, inCol: -1 } })).status).toBe(400);
    expect((await patchAccount(account.id, { importMapping: { ...mapping, dateFormat: "D.M.Y" } })).status).toBe(400);
  });

  it("rejects bad holidays and blank names without saving anything", async () => {
    const { body: account } = await createAccount();
    expect((await patchAccount(account.id, { bankHolidays: ["2026-02-30"] })).status).toBe(400);
    expect((await patchAccount(account.id, { name: "  " })).status).toBe(400);
    expect((await readStore()).bankAccounts[0].name).toBe("Chequing");
  });

  it("returns 404 for an unknown account", async () => {
    expect((await patchAccount("missing", { name: "X" })).status).toBe(404);
  });
});

describe("DELETE /api/bank-accounts/[id]", () => {
  it("deletes an unused account", async () => {
    const { body: account } = await createAccount();
    expect((await deleteAccount(account.id)).status).toBe(200);
    expect((await readStore()).bankAccounts).toHaveLength(0);
  });

  it("refuses to delete an account that has recurring items", async () => {
    const { body: account } = await createAccount();
    await createItem({ accountId: account.id, name: "Rent", kind: "bill", defaultAmount: 1500, recurrence: { type: "monthly", day: 1 } });
    expect((await deleteAccount(account.id)).status).toBe(409);
    expect((await readStore()).bankAccounts).toHaveLength(1);
  });
});
