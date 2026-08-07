import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";
import type { AppState } from "@/lib/types";

setupScratchDataDir();

let PATCH: typeof import("@/app/api/child-vendors/[id]/route").PATCH;
let DELETE: typeof import("@/app/api/child-vendors/[id]/route").DELETE;
let readState: typeof import("@/lib/store").readState;
let updateState: typeof import("@/lib/store").updateState;
let categoryIdForTransaction: typeof import("@/lib/vendors").categoryIdForTransaction;

beforeEach(async () => {
  ({ PATCH, DELETE } = await import("@/app/api/child-vendors/[id]/route"));
  ({ readState, updateState } = await import("@/lib/store"));
  ({ categoryIdForTransaction } = await import("@/lib/vendors"));
});

// "Costco" has two vendors (so deleting one leaves the parent alive);
// "Shell" has exactly one (so deleting it must garbage-collect the parent).
async function seed() {
  await updateState((state) => {
    state.categories = [
      makeCategory({ id: "cat_groceries", name: "Groceries" }),
      makeCategory({ id: "cat_travel", name: "Travel" }),
    ];
    state.parentVendors = [
      makeParentVendor({ id: "p_costco", name: "Costco", category: "cat_groceries" }),
      makeParentVendor({ id: "p_shell", name: "Shell", category: "cat_travel" }),
    ];
    state.childVendors = [
      makeChildVendor({ id: "c_costco_1", parentId: "p_costco", rawName: "Costco Wholesale" }),
      makeChildVendor({ id: "c_costco_2", parentId: "p_costco", rawName: "Costco Gas" }),
      makeChildVendor({ id: "c_shell_1", parentId: "p_shell", rawName: "Shell Toronto" }),
    ];
    state.transactions = [
      makeTransaction({ id: "t_costco_1a", childVendorId: "c_costco_1", needsReview: false }),
      makeTransaction({ id: "t_costco_1b", childVendorId: "c_costco_1", needsReview: false }),
      makeTransaction({ id: "t_costco_2", childVendorId: "c_costco_2", needsReview: false }),
      makeTransaction({ id: "t_shell_1", childVendorId: "c_shell_1", needsReview: false }),
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

describe("PATCH /api/child-vendors/[id]", () => {
  it("moves a vendor to a different parent", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", { parentId: "p_shell" }), ctx("c_costco_1"));

    expect(res.status).toBe(200);
    expect((await res.json()).parentId).toBe("p_shell");
    const state = await readState();
    expect(state.childVendors.find((c) => c.id === "c_costco_1")!.parentId).toBe("p_shell");
  });

  // Category is derived through the child's parentId, so moving the vendor
  // recategorizes its transactions with no separate propagation step.
  it("recategorizes every transaction under the moved vendor", async () => {
    await seed();
    const before = await readState();
    expect(derivedCategory(before, "t_costco_1a")).toBe("cat_groceries");

    await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", { parentId: "p_shell" }), ctx("c_costco_1"));

    const after = await readState();
    expect(derivedCategory(after, "t_costco_1a")).toBe("cat_travel");
    expect(derivedCategory(after, "t_costco_1b")).toBe("cat_travel");
    // A sibling vendor under the original parent is unaffected.
    expect(derivedCategory(after, "t_costco_2")).toBe("cat_groceries");
  });

  it("does not flag the moved vendor's transactions for review", async () => {
    await seed();

    await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", { parentId: "p_shell" }), ctx("c_costco_1"));

    const state = await readState();
    expect(state.transactions.every((t) => t.needsReview === false)).toBe(true);
  });

  it("rejects a missing parentId", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", {}), ctx("c_costco_1"));

    expect(res.status).toBe(400);
  });

  it("rejects a non-string parentId rather than coercing it", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", { parentId: { id: "p_shell" } }), ctx("c_costco_1"));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.childVendors.find((c) => c.id === "c_costco_1")!.parentId).toBe("p_costco");
  });

  it("returns 404 for an unknown vendor", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/nope", "PATCH", { parentId: "p_shell" }), ctx("nope"));

    expect(res.status).toBe(404);
  });

  it("returns 400 for an unknown target parent and moves nothing", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", { parentId: "p_nope" }), ctx("c_costco_1"));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.childVendors.find((c) => c.id === "c_costco_1")!.parentId).toBe("p_costco");
  });

  it("rejects a null body with a 400 rather than a 500", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/child-vendors/c_costco_1", "PATCH", null), ctx("c_costco_1"));

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/child-vendors/[id]", () => {
  it("removes the vendor and sends its transactions back to review", async () => {
    await seed();

    const res = await DELETE(new Request("http://test/api/child-vendors/c_costco_1", { method: "DELETE" }), ctx("c_costco_1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affectedCount: 2, parentRemoved: false });

    const state = await readState();
    expect(state.childVendors.map((c) => c.id)).toEqual(["c_costco_2", "c_shell_1"]);
    for (const id of ["t_costco_1a", "t_costco_1b"]) {
      const txn = state.transactions.find((t) => t.id === id)!;
      expect(txn.childVendorId).toBeNull();
      expect(txn.needsReview).toBe(true);
    }
  });

  it("keeps the parent alive while it still has another vendor", async () => {
    await seed();

    await DELETE(new Request("http://test/api/child-vendors/c_costco_1", { method: "DELETE" }), ctx("c_costco_1"));

    const state = await readState();
    expect(state.parentVendors.map((p) => p.id)).toEqual(["p_costco", "p_shell"]);
    const sibling = state.transactions.find((t) => t.id === "t_costco_2")!;
    expect(sibling.childVendorId).toBe("c_costco_2");
    expect(sibling.needsReview).toBe(false);
  });

  // A parent never exists without at least one vendor, so removing the last
  // one must take the parent with it.
  it("garbage-collects the parent when its last vendor is removed", async () => {
    await seed();

    const res = await DELETE(new Request("http://test/api/child-vendors/c_shell_1", { method: "DELETE" }), ctx("c_shell_1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affectedCount: 1, parentRemoved: true });

    const state = await readState();
    expect(state.parentVendors.map((p) => p.id)).toEqual(["p_costco"]);
    expect(state.childVendors.some((c) => c.id === "c_shell_1")).toBe(false);
    const txn = state.transactions.find((t) => t.id === "t_shell_1")!;
    expect(txn.childVendorId).toBeNull();
    expect(txn.needsReview).toBe(true);
  });

  it("removes an unused vendor without touching any transaction", async () => {
    await seed();
    await updateState((state) => {
      state.childVendors.push(makeChildVendor({ id: "c_costco_3", parentId: "p_costco", rawName: "Costco Optical" }));
    });

    const res = await DELETE(new Request("http://test/api/child-vendors/c_costco_3", { method: "DELETE" }), ctx("c_costco_3"));

    expect(await res.json()).toEqual({ affectedCount: 0, parentRemoved: false });
    const state = await readState();
    expect(state.transactions.every((t) => t.needsReview === false)).toBe(true);
  });

  it("returns 404 for an unknown vendor and changes nothing", async () => {
    await seed();

    const res = await DELETE(new Request("http://test/api/child-vendors/nope", { method: "DELETE" }), ctx("nope"));

    expect(res.status).toBe(404);
    const state = await readState();
    expect(state.childVendors).toHaveLength(3);
    expect(state.parentVendors).toHaveLength(2);
    expect(state.transactions.every((t) => t.needsReview === false)).toBe(true);
  });
});
