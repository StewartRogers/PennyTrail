import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";
import type { AppState } from "@/lib/types";

setupScratchDataDir();

let PATCH: typeof import("@/app/api/parent-vendors/[id]/route").PATCH;
let DELETE: typeof import("@/app/api/parent-vendors/[id]/route").DELETE;
let MERGE: typeof import("@/app/api/parent-vendors/merge/route").POST;
let readState: typeof import("@/lib/store").readState;
let updateState: typeof import("@/lib/store").updateState;
let categoryIdForTransaction: typeof import("@/lib/vendors").categoryIdForTransaction;

beforeEach(async () => {
  ({ PATCH, DELETE } = await import("@/app/api/parent-vendors/[id]/route"));
  ({ POST: MERGE } = await import("@/app/api/parent-vendors/merge/route"));
  ({ readState, updateState } = await import("@/lib/store"));
  ({ categoryIdForTransaction } = await import("@/lib/vendors"));
});

// Two parents, each with vendors and transactions, so every cascade test can
// assert that the *untouched* parent's data survives intact.
async function seed() {
  await updateState((state) => {
    state.categories = [
      makeCategory({ id: "cat_groceries", name: "Groceries" }),
      makeCategory({ id: "cat_dining", name: "Dining" }),
      makeCategory({ id: "cat_travel", name: "Travel" }),
    ];
    state.parentVendors = [
      makeParentVendor({ id: "p_costco", name: "Costco", category: "cat_groceries" }),
      makeParentVendor({ id: "p_shell", name: "Shell", category: "cat_dining" }),
    ];
    state.childVendors = [
      makeChildVendor({ id: "c_costco_1", parentId: "p_costco", rawName: "Costco Wholesale" }),
      makeChildVendor({ id: "c_costco_2", parentId: "p_costco", rawName: "Costco Gas" }),
      makeChildVendor({ id: "c_shell_1", parentId: "p_shell", rawName: "Shell Toronto" }),
    ];
    state.transactions = [
      makeTransaction({ id: "t_costco_1", childVendorId: "c_costco_1", needsReview: false }),
      makeTransaction({ id: "t_costco_2", childVendorId: "c_costco_2", needsReview: false }),
      makeTransaction({ id: "t_shell_1", childVendorId: "c_shell_1", needsReview: false }),
      makeTransaction({ id: "t_orphan", childVendorId: null, needsReview: true }),
    ];
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function derivedCategory(state: AppState, txnId: string): string | null {
  const childById = new Map(state.childVendors.map((c) => [c.id, c]));
  const parentById = new Map(state.parentVendors.map((p) => [p.id, p]));
  const txn = state.transactions.find((t) => t.id === txnId)!;
  return categoryIdForTransaction(txn, childById, parentById);
}

describe("PATCH /api/parent-vendors/[id]", () => {
  it("renames a parent", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "Costco Wholesale Corp" }), ctx("p_costco"));

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Costco Wholesale Corp");
    const state = await readState();
    expect(state.parentVendors.find((p) => p.id === "p_costco")!.name).toBe("Costco Wholesale Corp");
  });

  it("trims whitespace from the new name", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "   Padded Name   " }), ctx("p_costco"));

    expect((await res.json()).name).toBe("Padded Name");
  });

  // Category is derived live through childVendorId -> parentId -> category,
  // so changing it here must move every transaction under the parent at once.
  it("recategorizes every transaction under the parent in one step", async () => {
    await seed();
    const before = await readState();
    expect(derivedCategory(before, "t_costco_1")).toBe("cat_groceries");

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { category: "cat_travel" }), ctx("p_costco"));

    expect(res.status).toBe(200);
    const after = await readState();
    expect(derivedCategory(after, "t_costco_1")).toBe("cat_travel");
    expect(derivedCategory(after, "t_costco_2")).toBe("cat_travel");
    // The other parent keeps its own category — the change is scoped.
    expect(derivedCategory(after, "t_shell_1")).toBe("cat_dining");
  });

  it("can set name and category together", async () => {
    await seed();

    const res = await PATCH(
      jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "Costco Canada", category: "cat_dining" }),
      ctx("p_costco")
    );

    expect(res.status).toBe(200);
    const parent = await res.json();
    expect(parent.name).toBe("Costco Canada");
    expect(parent.category).toBe("cat_dining");
  });

  it("rejects a request with neither name nor category", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", {}), ctx("p_costco"));

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown parent", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/nope", "PATCH", { name: "X" }), ctx("nope"));

    expect(res.status).toBe(404);
  });

  it("rejects a duplicate name, case-insensitively, without changing anything", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "  sHeLl  " }), ctx("p_costco"));

    expect(res.status).toBe(409);
    const state = await readState();
    expect(state.parentVendors.find((p) => p.id === "p_costco")!.name).toBe("Costco");
  });

  it("allows renaming a parent to its own existing name", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "Costco" }), ctx("p_costco"));

    expect(res.status).toBe(200);
  });

  it("rejects an unknown category and leaves the parent untouched", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { category: "cat_nope" }), ctx("p_costco"));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.parentVendors.find((p) => p.id === "p_costco")!.category).toBe("cat_groceries");
  });

  // Two independent layers stop a partial write here, and this pins the
  // result of both: unlike the transactions PATCH, this mutator runs every
  // validation before it touches `parent`, AND updateState discards the state
  // when a mutator returns { error } (see store-abort.test.ts). Verified by
  // mutation: hoisting the rename above its guards still passes, because the
  // store backstop catches it; break both and this fails.
  it("does not persist the rename when the category in the same request is invalid", async () => {
    await seed();

    const res = await PATCH(
      jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "Should Not Stick", category: "cat_nope" }),
      ctx("p_costco")
    );

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.parentVendors.find((p) => p.id === "p_costco")!.name).toBe("Costco");
  });

  it("rejects an over-long name", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", { name: "x".repeat(201) }), ctx("p_costco"));

    expect(res.status).toBe(400);
  });

  it("rejects a null body with a 400 rather than a 500", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/parent-vendors/p_costco", "PATCH", null), ctx("p_costco"));

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/parent-vendors/[id]", () => {
  it("removes the parent, cascades to its vendors, and sends their transactions back to review", async () => {
    await seed();

    const res = await DELETE(new Request("http://test/api/parent-vendors/p_costco", { method: "DELETE" }), ctx("p_costco"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removedChildren: 2, affectedCount: 2 });

    const state = await readState();
    expect(state.parentVendors.map((p) => p.id)).toEqual(["p_shell"]);
    expect(state.childVendors.map((c) => c.id)).toEqual(["c_shell_1"]);

    for (const id of ["t_costco_1", "t_costco_2"]) {
      const txn = state.transactions.find((t) => t.id === id)!;
      expect(txn.childVendorId).toBeNull();
      expect(txn.needsReview).toBe(true);
    }
  });

  it("leaves the other parent's vendors and transactions untouched", async () => {
    await seed();

    await DELETE(new Request("http://test/api/parent-vendors/p_costco", { method: "DELETE" }), ctx("p_costco"));

    const state = await readState();
    const shellTxn = state.transactions.find((t) => t.id === "t_shell_1")!;
    expect(shellTxn.childVendorId).toBe("c_shell_1");
    expect(shellTxn.needsReview).toBe(false);
    expect(state.transactions).toHaveLength(4);
  });

  it("returns 404 for an unknown parent and changes nothing", async () => {
    await seed();

    const res = await DELETE(new Request("http://test/api/parent-vendors/nope", { method: "DELETE" }), ctx("nope"));

    expect(res.status).toBe(404);
    const state = await readState();
    expect(state.parentVendors).toHaveLength(2);
    expect(state.childVendors).toHaveLength(3);
    expect(state.transactions.filter((t) => t.needsReview)).toHaveLength(1);
  });
});

describe("POST /api/parent-vendors/merge", () => {
  it("moves every vendor to the target parent and removes the source", async () => {
    await seed();

    const res = await MERGE(jsonRequest("http://test/api/parent-vendors/merge", "POST", { fromId: "p_costco", intoId: "p_shell" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(2);
    expect(body.parent.id).toBe("p_shell");

    const state = await readState();
    expect(state.parentVendors.map((p) => p.id)).toEqual(["p_shell"]);
    expect(state.childVendors.every((c) => c.parentId === "p_shell")).toBe(true);
  });

  // Merging is an id reassignment only — no transaction is rewritten, but the
  // derived category follows the new parent.
  it("leaves transactions pointing at the same vendors, with the target's category", async () => {
    await seed();

    await MERGE(jsonRequest("http://test/api/parent-vendors/merge", "POST", { fromId: "p_costco", intoId: "p_shell" }));

    const state = await readState();
    const txn = state.transactions.find((t) => t.id === "t_costco_1")!;
    expect(txn.childVendorId).toBe("c_costco_1");
    expect(txn.needsReview).toBe(false);
    expect(derivedCategory(state, "t_costco_1")).toBe("cat_dining");
  });

  it.each([
    ["a missing fromId", { intoId: "p_shell" }],
    ["a missing intoId", { fromId: "p_costco" }],
    ["identical ids", { fromId: "p_costco", intoId: "p_costco" }],
    ["a null body", null],
  ])("rejects %s", async (_label, body) => {
    await seed();

    const res = await MERGE(jsonRequest("http://test/api/parent-vendors/merge", "POST", body));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.parentVendors).toHaveLength(2);
  });

  it.each([
    ["an unknown source", { fromId: "nope", intoId: "p_shell" }],
    ["an unknown target", { fromId: "p_costco", intoId: "nope" }],
  ])("returns 404 for %s and moves nothing", async (_label, body) => {
    await seed();

    const res = await MERGE(jsonRequest("http://test/api/parent-vendors/merge", "POST", body));

    expect(res.status).toBe(404);
    const state = await readState();
    expect(state.parentVendors).toHaveLength(2);
    expect(state.childVendors.filter((c) => c.parentId === "p_costco")).toHaveLength(2);
  });
});
