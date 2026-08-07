import { describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";

setupScratchDataDir();

async function seed() {
  const { updateState } = await import("@/lib/store");
  await updateState((state) => {
    state.categories = [makeCategory({ id: "cat_1", name: "Groceries" })];
    state.parentVendors = [makeParentVendor({ id: "parent_1", name: "Costco", category: "cat_1" })];
    state.childVendors = [makeChildVendor({ id: "child_1", parentId: "parent_1", rawName: "Costco Wholesale" })];
    state.transactions = [makeTransaction({ id: "txn_1", type: "purchase", amount: 100, childVendorId: null })];
  });
}

async function storedTransaction() {
  const { readState } = await import("@/lib/store");
  return (await readState()).transactions.find((t) => t.id === "txn_1")!;
}

async function storedState() {
  const { readState } = await import("@/lib/store");
  return await readState();
}

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/transactions/[id]/route");
  return PATCH(jsonRequest("http://localhost/api/transactions/txn_1", "PATCH", body), {
    params: Promise.resolve({ id: "txn_1" }),
  } as never);
}

// updateState used to write the mutated state unconditionally. The PATCH
// mutator applies `type` before it validates the vendor fields, so a request
// the caller was told had FAILED still persisted its type change (and, on the
// parentId branch, a whole new child vendor).
describe("a rejected mutation persists nothing", () => {
  it("does not keep the type change when the new parent name is a duplicate", async () => {
    await seed();

    const res = await patch({ type: "fee", newParentName: "Costco", category: "cat_1" });

    expect(res.status).toBe(409);
    expect((await storedTransaction()).type).toBe("purchase");
  });

  it("does not keep the type change when the parent id is unknown", async () => {
    await seed();

    const res = await patch({ type: "fee", parentId: "parent_does_not_exist" });

    expect(res.status).toBe(400);
    expect((await storedTransaction()).type).toBe("purchase");
  });

  it("does not create a child vendor when the reimbursed amount is rejected", async () => {
    await seed();

    const res = await patch({ parentId: "parent_1", reimbursedAmount: -1 });

    expect(res.status).toBe(400);
    const state = await storedState();
    // The mutator pushes a new ChildVendor and repoints the transaction
    // before it ever reaches the reimbursedAmount check.
    expect(state.childVendors).toHaveLength(1);
    expect(state.transactions[0].childVendorId).toBeNull();
  });

  it("does not keep the type change when the category is unknown", async () => {
    await seed();

    const res = await patch({ type: "credit", newParentName: "Brand New Vendor", category: "cat_nope" });

    expect(res.status).toBe(400);
    const state = await storedState();
    expect(state.transactions[0].type).toBe("purchase");
    expect(state.parentVendors).toHaveLength(1);
  });

  it("still commits a fully valid mutation", async () => {
    await seed();

    const res = await patch({ type: "fee", parentId: "parent_1" });

    expect(res.status).toBe(200);
    const txn = await storedTransaction();
    expect(txn.type).toBe("fee");
    expect(txn.needsReview).toBe(false);
  });
});
