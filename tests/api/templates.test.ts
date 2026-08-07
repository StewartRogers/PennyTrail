import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";

setupScratchDataDir();

let POST: typeof import("@/app/api/templates/route").POST;
let DELETE: typeof import("@/app/api/templates/[id]/route").DELETE;
let readState: typeof import("@/lib/store").readState;

beforeEach(async () => {
  ({ POST } = await import("@/app/api/templates/route"));
  ({ DELETE } = await import("@/app/api/templates/[id]/route"));
  ({ readState } = await import("@/lib/store"));
});

const VALID_TEMPLATE = {
  name: "My Bank",
  bank: "My Bank",
  dateCol: 0,
  descCol: 1,
  dateFormat: "MM/DD/YYYY",
  amountMode: "single",
  amountCol: 2,
};

async function createTemplate(overrides: Record<string, unknown> = {}) {
  const res = await POST(jsonRequest("http://test/api/templates", "POST", { ...VALID_TEMPLATE, ...overrides }));
  return res.json();
}

describe("POST /api/templates", () => {
  it("creates a template with a valid single-amount-mode mapping", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "My Bank",
        bank: "My Bank",
        dateCol: 0,
        descCol: 1,
        dateFormat: "MM/DD/YYYY",
        amountMode: "single",
        amountCol: 2,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dateCol).toBe(0);
    expect(body.descCol).toBe(1);
    expect(body.amountCol).toBe(2);
    expect(body.debitCol).toBe(-1);
    expect(body.creditCol).toBe(-1);
  });

  it("creates a split-mode template with only a credit column mapped", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "Split Bank",
        bank: "Split Bank",
        dateCol: 0,
        descCol: 1,
        dateFormat: "YYYY-MM-DD",
        amountMode: "split",
        creditCol: 3,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.creditCol).toBe(3);
    expect(body.debitCol).toBe(-1);
  });

  it("rejects a request missing name or bank", async () => {
    const res = await POST(jsonRequest("http://test/api/templates", "POST", { dateCol: 0, descCol: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing/non-integer date or description column instead of silently storing NaN", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "X",
        bank: "Y",
        // dateCol omitted entirely
        descCol: 1,
        dateFormat: "MM/DD/YYYY",
        amountMode: "single",
        amountCol: 2,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date format", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "X",
        bank: "Y",
        dateCol: 0,
        descCol: 1,
        dateFormat: "not-a-real-format",
        amountMode: "single",
        amountCol: 2,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects single mode with no amount column", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "X",
        bank: "Y",
        dateCol: 0,
        descCol: 1,
        dateFormat: "MM/DD/YYYY",
        amountMode: "single",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects split mode with neither debit nor credit column mapped", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "X",
        bank: "Y",
        dateCol: 0,
        descCol: 1,
        dateFormat: "MM/DD/YYYY",
        amountMode: "split",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a negative column index", async () => {
    const res = await POST(
      jsonRequest("http://test/api/templates", "POST", {
        name: "X",
        bank: "Y",
        dateCol: -1,
        descCol: 1,
        dateFormat: "MM/DD/YYYY",
        amountMode: "single",
        amountCol: 2,
      })
    );
    expect(res.status).toBe(400);
  });

  it("defaults network, amountConvention, optional columns, and skipRows", async () => {
    const t = await createTemplate();

    expect(t.network).toBe("Visa");
    expect(t.amountConvention).toBe("positive_is_purchase");
    expect(t.vendorCol).toBe(-1);
    expect(t.categoryCol).toBe(-1);
    expect(t.typeCol).toBe(-1);
    expect(t.skipRows).toBe(0);
    expect(t.headerSnapshot).toEqual([]);
  });

  it("keeps the optional vendor/category/type columns and skipRows when supplied", async () => {
    const t = await createTemplate({
      network: "Mastercard",
      amountConvention: "negative_is_purchase",
      vendorCol: 4,
      categoryCol: 5,
      typeCol: 6,
      skipRows: 3,
    });

    expect(t.network).toBe("Mastercard");
    expect(t.amountConvention).toBe("negative_is_purchase");
    expect(t.vendorCol).toBe(4);
    expect(t.categoryCol).toBe(5);
    expect(t.typeCol).toBe(6);
    expect(t.skipRows).toBe(3);
  });

  // headerSnapshot is typed string[] and rendered directly by Templates.tsx.
  // Only Array.isArray was checked before, so a non-string element was
  // persisted and displayed as "[object Object]" with no template PATCH to
  // correct it — the only fix was hand-editing store.json.
  it("filters non-string elements out of headerSnapshot", async () => {
    const t = await createTemplate({ headerSnapshot: ["Date", { a: 1 }, null, ["x"], "Amount", 7] });

    expect(t.headerSnapshot).toEqual(["Date", "Amount"]);
  });

  it("stores a well-formed headerSnapshot unchanged", async () => {
    const t = await createTemplate({ headerSnapshot: ["Date", "Description", "Amount"] });

    expect(t.headerSnapshot).toEqual(["Date", "Description", "Amount"]);
  });

  it("ignores a non-array headerSnapshot", async () => {
    const t = await createTemplate({ headerSnapshot: "Date,Description,Amount" });

    expect(t.headerSnapshot).toEqual([]);
  });

  it.each([
    ["an over-long name", { name: "x".repeat(201) }],
    ["an over-long bank", { bank: "x".repeat(201) }],
  ])("rejects %s", async (_label, overrides) => {
    const res = await POST(jsonRequest("http://test/api/templates", "POST", { ...VALID_TEMPLATE, ...overrides }));

    expect(res.status).toBe(400);
  });

  it("rejects a null body with a 400 rather than a 500", async () => {
    const res = await POST(jsonRequest("http://test/api/templates", "POST", null));

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/templates/[id]", () => {
  it("deletes a template", async () => {
    const t = await createTemplate();

    const res = await DELETE(new Request(`http://test/api/templates/${t.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: t.id }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const state = await readState();
    expect(state.templates).toHaveLength(0);
  });

  it("deletes only the requested template", async () => {
    const keep = await createTemplate({ name: "Keep Me", bank: "Bank A" });
    const drop = await createTemplate({ name: "Drop Me", bank: "Bank B" });

    await DELETE(new Request(`http://test/api/templates/${drop.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: drop.id }),
    });

    const state = await readState();
    expect(state.templates.map((t) => t.id)).toEqual([keep.id]);
  });

  it("returns 404 for an unknown template and deletes nothing", async () => {
    await createTemplate();

    const res = await DELETE(new Request("http://test/api/templates/nope", { method: "DELETE" }), {
      params: Promise.resolve({ id: "nope" }),
    });

    expect(res.status).toBe(404);
    const state = await readState();
    expect(state.templates).toHaveLength(1);
  });

  it("returns 404 when there are no templates at all", async () => {
    const res = await DELETE(new Request("http://test/api/templates/nope", { method: "DELETE" }), {
      params: Promise.resolve({ id: "nope" }),
    });

    expect(res.status).toBe(404);
  });
});
