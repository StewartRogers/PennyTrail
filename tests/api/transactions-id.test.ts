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

  it("reassigning a transaction with no rawDescription of its own reuses an existing named sibling instead of a blank-named vendor", async () => {
    // Regression test: some statement rows have nothing in the mapped
    // Description column (see ImportWizard's vendor-column fallback), so
    // cleanVendorName(txn.rawDescription) is "". The old code matched (or
    // created) a child by that empty name specifically, which either forked
    // a nameless vendor or, once one existed, kept reusing that same
    // nameless vendor no matter which parent the user reassigned to.
    const parent = makeParentVendor();
    const blankChild = makeChildVendor({ id: "child_blank", parentId: parent.id, rawName: "" });
    const namedChild = makeChildVendor({ id: "child_named", parentId: parent.id, rawName: "Cashback" });
    const txn = makeTransaction({ rawDescription: "", childVendorId: blankChild.id });
    await writeState(
      makeAppState({
        parentVendors: [parent],
        categories: [makeCategory()],
        childVendors: [blankChild, namedChild],
        transactions: [txn],
      })
    );

    const res = await patchTxn(txn.id, { parentId: parent.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.childVendorId).toBe(namedChild.id);

    const state = await readState();
    expect(state.childVendors).toHaveLength(2); // no new blank vendor forked
  });

  it("reassigning a transaction with no rawDescription creates one child (not a blank duplicate) when the target parent has none yet", async () => {
    const parent = makeParentVendor();
    const txn = makeTransaction({ rawDescription: "" });
    await writeState(makeAppState({ parentVendors: [parent], categories: [makeCategory()], transactions: [txn] }));

    const res = await patchTxn(txn.id, { parentId: parent.id });
    expect(res.status).toBe(200);

    const state = await readState();
    expect(state.childVendors).toHaveLength(1);
    expect(state.childVendors[0].parentId).toBe(parent.id);
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

  it("creates a new parent+vendor pair for a transaction with no rawDescription, even though another blank-named child already exists elsewhere", async () => {
    // Regression test: cleanVendorName(txn.rawDescription) is "" whenever the
    // source statement left the description blank, and findChildByRawName
    // matches on that empty string just like any other name — so this used
    // to flag *any* existing blank-named child anywhere in the store (even
    // the one already on this transaction) as a "duplicate" and permanently
    // block giving the transaction a real vendor.
    const existingParent = makeParentVendor({ id: "parent_existing", name: "Existing Parent" });
    const blankChild = makeChildVendor({ id: "child_blank", parentId: "parent_existing", rawName: "" });
    const category = makeCategory();
    const txn = makeTransaction({ rawDescription: "", childVendorId: blankChild.id });
    await writeState(
      makeAppState({ parentVendors: [existingParent], categories: [category], childVendors: [blankChild], transactions: [txn] })
    );

    const res = await patchTxn(txn.id, { newParentName: "New Vendor Name", category: category.id });
    expect(res.status).toBe(200);

    const state = await readState();
    expect(state.parentVendors).toHaveLength(2);
    expect(state.parentVendors.find((p) => p.name === "New Vendor Name")).toBeDefined();
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

  it("updates the date", async () => {
    const txn = makeTransaction({ date: "2026-03-05" });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { date: "2026-04-17" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe("2026-04-17");
  });

  it("rejects a malformed date", async () => {
    const txn = makeTransaction();
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { date: "not-a-date" });
    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.transactions[0].date).toBe(txn.date);
  });

  it("rejects a date that doesn't exist on the calendar", async () => {
    const txn = makeTransaction();
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { date: "2026-02-30" });
    expect(res.status).toBe(400);
  });

  it("updates the amount", async () => {
    const txn = makeTransaction({ amount: 100 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { amount: 42.5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(42.5);
  });

  it("rejects a zero or negative amount", async () => {
    const txn = makeTransaction({ amount: 100 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { amount: 0 });
    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.transactions[0].amount).toBe(100);
  });

  it("brings the reimbursed amount down when editing the amount below it, instead of leaving an invalid state", async () => {
    const txn = makeTransaction({ amount: 100, reimbursedAmount: 80 });
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { amount: 50 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(50);
    expect(body.reimbursedAmount).toBe(50);
  });

  it("sets and clears excludeFromDashboard", async () => {
    const txn = makeTransaction();
    await writeState(makeAppState({ transactions: [txn] }));

    const on = await patchTxn(txn.id, { excludeFromDashboard: true });
    expect((await on.json()).excludeFromDashboard).toBe(true);

    const off = await patchTxn(txn.id, { excludeFromDashboard: false });
    expect((await off.json()).excludeFromDashboard).toBe(false);

    const state = await readState();
    expect(state.transactions[0].excludeFromDashboard).toBe(false);
  });

  it("ignores a non-boolean excludeFromDashboard rather than coercing it", async () => {
    const txn = makeTransaction();
    await writeState(makeAppState({ transactions: [txn] }));

    const res = await patchTxn(txn.id, { excludeFromDashboard: "yes" });

    expect(res.status).toBe(200);
    const state = await readState();
    expect(state.transactions[0].excludeFromDashboard).toBeUndefined();
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
