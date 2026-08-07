import { describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeTransaction } from "../helpers/fixtures";

setupScratchDataDir();

async function seedTransactions() {
  const { updateState } = await import("@/lib/store");
  await updateState((state) => {
    state.transactions = [
      makeTransaction({ id: "txn_1" }),
      makeTransaction({ id: "txn_2" }),
      makeTransaction({ id: "txn_3" }),
    ];
  });
}

async function remainingIds(): Promise<string[]> {
  const { readState } = await import("@/lib/store");
  return (await readState()).transactions.map((t) => t.id);
}

describe("DELETE /api/transactions", () => {
  it("deletes only the listed ids", async () => {
    await seedTransactions();
    const { DELETE } = await import("@/app/api/transactions/route");

    const res = await DELETE(jsonRequest("http://localhost/api/transactions", "DELETE", { ids: ["txn_2"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 1 });
    expect(await remainingIds()).toEqual(["txn_1", "txn_3"]);
  });

  it("wipes everything only when all:true is passed explicitly", async () => {
    await seedTransactions();
    const { DELETE } = await import("@/app/api/transactions/route");

    const res = await DELETE(jsonRequest("http://localhost/api/transactions", "DELETE", { all: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 3 });
    expect(await remainingIds()).toEqual([]);
  });

  // The regression this route existed to have: a body that didn't parse, or
  // that used the wrong key, used to fall through to "delete everything" and
  // report 200. Unrecoverable data loss reported as success.
  it.each([
    ["a missing body", undefined],
    ["an unparseable body", "not json at all"],
    ["a mis-keyed body", { transactionIds: ["txn_1"] }],
    ["a bare array body", ["txn_1"]],
    ["an empty object", {}],
  ])("rejects %s instead of wiping the history", async (_label, body) => {
    await seedTransactions();
    const { DELETE } = await import("@/app/api/transactions/route");

    const request =
      body === "not json at all"
        ? new Request("http://localhost/api/transactions", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: "not json at all",
          })
        : jsonRequest("http://localhost/api/transactions", "DELETE", body);

    const res = await DELETE(request);

    expect(res.status).toBe(400);
    expect(await remainingIds()).toEqual(["txn_1", "txn_2", "txn_3"]);
  });

  it("rejects a non-string ids array without deleting anything", async () => {
    await seedTransactions();
    const { DELETE } = await import("@/app/api/transactions/route");

    const res = await DELETE(jsonRequest("http://localhost/api/transactions", "DELETE", { ids: [null, 7] }));

    expect(res.status).toBe(400);
    expect(await remainingIds()).toEqual(["txn_1", "txn_2", "txn_3"]);
  });

  it("rejects ids and all together rather than guessing", async () => {
    await seedTransactions();
    const { DELETE } = await import("@/app/api/transactions/route");

    const res = await DELETE(jsonRequest("http://localhost/api/transactions", "DELETE", { ids: ["txn_1"], all: true }));

    expect(res.status).toBe(400);
    expect(await remainingIds()).toEqual(["txn_1", "txn_2", "txn_3"]);
  });
});
