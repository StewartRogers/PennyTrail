import { describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeCard } from "../helpers/fixtures";

setupScratchDataDir();

async function seedCard() {
  const { updateState } = await import("@/lib/store");
  await updateState((state) => {
    state.cards = [makeCard({ id: "card_1" })];
  });
}

async function importRows(rows: unknown[]) {
  const { POST } = await import("@/app/api/transactions/import/route");
  const res = await POST(jsonRequest("http://localhost/api/transactions/import", "POST", { cardId: "card_1", rows }));
  return { res, body: await res.json() };
}

const validRow = { date: "2026-03-05", rawDescription: "COSTCO", amount: 100, isCharge: true };

describe("import row validation", () => {
  it("imports a well-formed row", async () => {
    await seedCard();

    const { res, body } = await importRows([validRow]);

    expect(res.status).toBe(201);
    expect(body.counts).toMatchObject({ total: 1, skipped: 0 });
  });

  // isCharge was never validated: a missing or string value made `!isCharge`
  // true, so a purchase was silently typed as a payment and dropped out of
  // every dashboard total.
  it.each([
    ["a missing isCharge", { date: "2026-03-05", rawDescription: "COSTCO", amount: 100 }],
    ["a string isCharge", { ...validRow, isCharge: "false" }],
    ["a numeric isCharge", { ...validRow, isCharge: 0 }],
  ])("skips a row with %s rather than misclassifying it", async (_label, row) => {
    await seedCard();

    const { res, body } = await importRows([row]);

    expect(res.status).toBe(201);
    expect(body.counts).toMatchObject({ total: 0, skipped: 1 });
  });

  it.each([
    ["03/15/2024", "a non-ISO date"],
    ["2024-3-5", "an unpadded date"],
    ["2026-03-05T00:00:00", "a timestamp"],
    ["", "an empty date"],
  ])("skips %s (%s)", async (date) => {
    await seedCard();

    const { body } = await importRows([{ ...validRow, date }]);

    expect(body.counts).toMatchObject({ total: 0, skipped: 1 });
  });

  // row.categoryText?.trim() threw a raw TypeError out of the mutator on a
  // non-string, which 500'd the request and discarded every row already
  // processed in the batch.
  it("skips a row with a non-string categoryText instead of failing the whole batch", async () => {
    await seedCard();

    const { res, body } = await importRows([validRow, { ...validRow, categoryText: 123 }]);

    expect(res.status).toBe(201);
    expect(body.counts).toMatchObject({ total: 1, skipped: 1 });
  });

  it("rejects an oversized batch", async () => {
    await seedCard();
    const rows = Array.from({ length: 20001 }, () => validRow);

    const { res } = await importRows(rows);

    expect(res.status).toBe(400);
  });

  it("rejects a null body with a 400 rather than a 500", async () => {
    await seedCard();
    const { POST } = await import("@/app/api/transactions/import/route");

    const res = await POST(jsonRequest("http://localhost/api/transactions/import", "POST", null));

    expect(res.status).toBe(400);
  });
});
