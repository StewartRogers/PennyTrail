import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeCategory, makeParentVendor } from "../helpers/fixtures";

setupScratchDataDir();

let POST: typeof import("@/app/api/categories/route").POST;
let PATCH: typeof import("@/app/api/categories/[id]/route").PATCH;
let DELETE: typeof import("@/app/api/categories/[id]/route").DELETE;
let readState: typeof import("@/lib/store").readState;
let updateState: typeof import("@/lib/store").updateState;

beforeEach(async () => {
  ({ POST } = await import("@/app/api/categories/route"));
  ({ PATCH, DELETE } = await import("@/app/api/categories/[id]/route"));
  ({ readState, updateState } = await import("@/lib/store"));
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seed() {
  await updateState((state) => {
    state.categories = [
      makeCategory({ id: "cat_groceries", name: "Groceries", color: "oklch(0.5 0.1 145)" }),
      makeCategory({ id: "cat_dining", name: "Dining", color: "oklch(0.5 0.1 50)" }),
    ];
  });
}

describe("POST /api/categories", () => {
  it("creates a category", async () => {
    const res = await POST(jsonRequest("http://test/api/categories", "POST", { name: "Utilities", color: "oklch(0.5 0.1 250)" }));

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Utilities");
    expect(created.color).toBe("oklch(0.5 0.1 250)");
    expect(created.id).toMatch(/^cat_/);

    const state = await readState();
    expect(state.categories.some((c) => c.id === created.id)).toBe(true);
  });

  it("trims surrounding whitespace", async () => {
    const res = await POST(jsonRequest("http://test/api/categories", "POST", { name: "  Utilities  ", color: "  #fff  " }));

    const created = await res.json();
    expect(created.name).toBe("Utilities");
    expect(created.color).toBe("#fff");
  });

  it("appends to the existing categories rather than replacing them", async () => {
    await seed();

    await POST(jsonRequest("http://test/api/categories", "POST", { name: "Utilities", color: "#fff" }));

    const state = await readState();
    expect(state.categories.map((c) => c.name)).toEqual(["Groceries", "Dining", "Utilities"]);
  });

  it.each([
    ["a missing name", { color: "#fff" }],
    ["a missing color", { name: "Utilities" }],
    ["a whitespace-only name", { name: "   ", color: "#fff" }],
    ["a whitespace-only color", { name: "Utilities", color: "   " }],
    ["an empty body", {}],
    ["a null body", null],
  ])("rejects %s", async (_label, body) => {
    await seed();

    const res = await POST(jsonRequest("http://test/api/categories", "POST", body));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.categories).toHaveLength(2);
  });

  // readString only accepts real strings, so a non-string can't be coerced
  // into a category literally named "[object Object]".
  it.each([
    ["an object name", { name: {}, color: "#fff" }],
    ["an array name", { name: ["a", "b"], color: "#fff" }],
    ["a numeric name", { name: 42, color: "#fff" }],
  ])("rejects %s instead of stringifying it", async (_label, body) => {
    const res = await POST(jsonRequest("http://test/api/categories", "POST", body));

    expect(res.status).toBe(400);
  });

  it.each([
    ["an over-long name", { name: "x".repeat(201), color: "#fff" }],
    ["an over-long color", { name: "Utilities", color: "x".repeat(201) }],
  ])("rejects %s", async (_label, body) => {
    const res = await POST(jsonRequest("http://test/api/categories", "POST", body));

    expect(res.status).toBe(400);
  });

  it("accepts a name exactly at the length limit", async () => {
    const res = await POST(jsonRequest("http://test/api/categories", "POST", { name: "x".repeat(200), color: "#fff" }));

    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/categories/[id]", () => {
  it("renames a category", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/categories/cat_groceries", "PATCH", { name: "Food & Groceries" }), ctx("cat_groceries"));

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Food & Groceries");
    const state = await readState();
    expect(state.categories.find((c) => c.id === "cat_groceries")!.name).toBe("Food & Groceries");
  });

  // Dashboard totals read this flag, so it has to round-trip both ways —
  // setting it to false must clear it, not just be ignored as falsy.
  it("toggles excludeFromDashboard on and back off", async () => {
    await seed();

    const on = await PATCH(jsonRequest("http://test/api/categories/cat_dining", "PATCH", { excludeFromDashboard: true }), ctx("cat_dining"));
    expect((await on.json()).excludeFromDashboard).toBe(true);

    const off = await PATCH(jsonRequest("http://test/api/categories/cat_dining", "PATCH", { excludeFromDashboard: false }), ctx("cat_dining"));
    expect((await off.json()).excludeFromDashboard).toBe(false);

    const state = await readState();
    expect(state.categories.find((c) => c.id === "cat_dining")!.excludeFromDashboard).toBe(false);
  });

  it("updates name and excludeFromDashboard together", async () => {
    await seed();

    const res = await PATCH(
      jsonRequest("http://test/api/categories/cat_dining", "PATCH", { name: "Restaurants", excludeFromDashboard: true }),
      ctx("cat_dining")
    );

    const updated = await res.json();
    expect(updated.name).toBe("Restaurants");
    expect(updated.excludeFromDashboard).toBe(true);
  });

  it("leaves the colour and id alone", async () => {
    await seed();

    await PATCH(jsonRequest("http://test/api/categories/cat_groceries", "PATCH", { name: "Renamed", color: "#000", id: "hacked" }), ctx("cat_groceries"));

    const state = await readState();
    const cat = state.categories.find((c) => c.id === "cat_groceries")!;
    expect(cat.color).toBe("oklch(0.5 0.1 145)");
    expect(cat.id).toBe("cat_groceries");
  });

  it("ignores a non-boolean excludeFromDashboard rather than coercing it", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/categories/cat_dining", "PATCH", { excludeFromDashboard: "yes" }), ctx("cat_dining"));

    expect(res.status).toBe(200);
    const state = await readState();
    expect(state.categories.find((c) => c.id === "cat_dining")!.excludeFromDashboard).toBeUndefined();
  });

  it("returns 404 for an unknown category and changes nothing", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/categories/nope", "PATCH", { name: "X" }), ctx("nope"));

    expect(res.status).toBe(404);
    const state = await readState();
    expect(state.categories.map((c) => c.name)).toEqual(["Groceries", "Dining"]);
  });

  it("rejects an over-long name without changing the category", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/categories/cat_groceries", "PATCH", { name: "x".repeat(201) }), ctx("cat_groceries"));

    expect(res.status).toBe(400);
    const state = await readState();
    expect(state.categories.find((c) => c.id === "cat_groceries")!.name).toBe("Groceries");
  });

  it("treats a null body as a no-op rather than a 500", async () => {
    await seed();

    const res = await PATCH(jsonRequest("http://test/api/categories/cat_groceries", "PATCH", null), ctx("cat_groceries"));

    expect(res.status).toBe(200);
    const state = await readState();
    expect(state.categories.find((c) => c.id === "cat_groceries")!.name).toBe("Groceries");
  });
});

describe("DELETE /api/categories/[id]", () => {
  it("deletes a category no vendor points at", async () => {
    await seed();

    const res = await DELETE(jsonRequest("http://test/api/categories/cat_groceries", "DELETE"), ctx("cat_groceries"));

    expect(res.status).toBe(200);
    const state = await readState();
    expect(state.categories.map((c) => c.id)).toEqual(["cat_dining"]);
  });

  it("rejects deleting a category a vendor still uses, and changes nothing", async () => {
    await seed();
    await updateState((state) => {
      state.parentVendors = [makeParentVendor({ id: "parent_1", name: "Costco", category: "cat_groceries" })];
    });

    const res = await DELETE(jsonRequest("http://test/api/categories/cat_groceries", "DELETE"), ctx("cat_groceries"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("1 vendor");
    const state = await readState();
    expect(state.categories.map((c) => c.id)).toContain("cat_groceries");
  });

  it("counts every vendor using the category in the rejection message", async () => {
    await seed();
    await updateState((state) => {
      state.parentVendors = [
        makeParentVendor({ id: "parent_1", name: "Costco", category: "cat_groceries" }),
        makeParentVendor({ id: "parent_2", name: "Save-On-Foods", category: "cat_groceries" }),
      ];
    });

    const res = await DELETE(jsonRequest("http://test/api/categories/cat_groceries", "DELETE"), ctx("cat_groceries"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("2 vendors");
  });

  it("returns 404 for an unknown category", async () => {
    await seed();

    const res = await DELETE(jsonRequest("http://test/api/categories/nope", "DELETE"), ctx("nope"));

    expect(res.status).toBe(404);
  });
});
