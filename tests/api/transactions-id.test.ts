import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeAppState, makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";

setupScratchDataDir();

let PATCH: typeof import("@/app/api/transactions/[id]/route").PATCH;
let writeState: typeof import("@/lib/store").writeState;
let readState: typeof import("@/lib/store").readState;

beforeEach(async () => {
  ({ PATCH } = await import("@/app/api/transactions/[id]/route"));
  ({ writeState, readState } = await import("@/lib/store"));
});

function patchTxn(id: string, body: unknown) {
  return PATCH(jsonRequest(`http://test/api/transactions/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });
}

describe("PATCH /api/transactions/[id]", () => {
  it("returns 404 for an unknown transaction", async () => {
    await writeState(makeAppState());
    const res = await patchTxn("missing", { type: "payment" });
    expect(res.status).toBe(404);
  });

  it("updates the transaction type", async () => {
    const txn = makeTransaction({ type: "purchase" });
    await writeState(makeAppState({ transactions: [txn] }));
    const res = await patchTxn(txn.id, { type: "payment" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("payment");
  });

  it("reassigns to an existing parent, creating a new child vendor for this description", async () => {
    const parent = makeParentVendor();
    const txn = makeTransaction();
    await writeState(makeAppState({ parentVendors: [parent], categories: [makeCategory()], transactions: [txn] }));

    const res = await patchTxn(txn.id, { parentId: parent.id });
    expect(res.status).toBe(200);

    const state = await readState();
    expect(state.childVendors).toHaveLength(1);
    expect(state.childVendors[0].parentId).toBe(parent.id);
    expect(state.transactions[0].needsReview).toBe(false);
  });

  it("reassigning to a parent moves an existing same-named vendor rather than forking a duplicate", async () => {
    const oldParent = makeParentVendor({ id: "parent_old", name: "Old Parent" });
    const newParent = makeParentVendor({ id: "parent_new", name: "New Parent" });
    const child = makeChildVendor({ parentId: "parent_old" });
    const txn = makeTransaction({ childVendorId: child.id, rawDescription: child.rawName });
    await writeState(
      makeAppState({ parentVendors: [oldParent, newParent], categories: [makeCategory()], childVendors: [child], transactions: [txn] })
    );

    const res = await patchTxn(txn.id, { parentId: "parent_new" });
    expect(res.status).toBe(200);

    const state = await readState();
    expect(state.childVendors).toHaveLength(1); // no duplicate forked
    expect(state.childVendors[0].parentId).toBe("parent_new");
  });

  it("creates a brand-new parent+vendor pair", async () => {
    const category = makeCategory();
    const txn = makeTransaction();
    await writeState(makeAppState({ categories: [category], transactions: [txn] }));

    const res = await patchTxn(txn.id, { newParentName: "Brand New Vendor", category: category.id });
    expect(res.status).toBe(200);

    const state = await readState();
    expect(state.parentVendors).toHaveLength(1);
    expect(state.parentVendors[0].name).toBe("Brand New Vendor");
    expect(state.childVendors).toHaveLength(1);
    expect(state.transactions[0].needsReview).toBe(false);
  });

  it("rejects creating a new parent with a name that already exists", async () => {
    const existing = makeParentVendor({ name: "Costco" });
    const category = makeCategory();
    const txn = makeTransaction();
    await writeState(makeAppState({ parentVendors: [existing], categories: [category], transactions: [txn] }));

    const res = await patchTxn(txn.id, { newParentName: "Costco", category: category.id });
    expect(res.status).toBe(409);
  });

  it("rejects creating a new vendor whose description already exists under a different parent, naming that parent", async () => {
    const otherParent = makeParentVendor({ id: "parent_other", name: "Other Parent" });
    const existingChild = makeChildVendor({ parentId: "parent_other", rawName: "Duplicate Desc" });
    const category = makeCategory();
    const txn = makeTransaction({ rawDescription: "Duplicate Desc" });
    await writeState(
      makeAppState({ parentVendors: [otherParent], categories: [category], childVendors: [existingChild], transactions: [txn] })
    );

    const res = await patchTxn(txn.id, { newParentName: "Some New Parent Name", category: category.id });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Other Parent");
  });

  it("sets a partial reimbursed amount", async () => {
    const txn = makeTransaction({ amount: 100 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { reimbursedAmount: 40 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reimbursedAmount).toBe(40);
  });

  it("rejects a reimbursed amount larger than the transaction amount", async () => {
    const txn = makeTransaction({ amount: 100 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { reimbursedAmount: 150 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative reimbursed amount", async () => {
    const txn = makeTransaction({ amount: 100 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { reimbursedAmount: -5 });
    expect(res.status).toBe(400);
  });

  it("clears a reimbursed amount when passed null", async () => {
    const txn = makeTransaction({ amount: 100, reimbursedAmount: 50 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { reimbursedAmount: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reimbursedAmount).toBeUndefined();
  });
});
