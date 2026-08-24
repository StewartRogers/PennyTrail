import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";
import { makeAppState, makeCard, makeCategory, makeChildVendor, makeParentVendor } from "../helpers/fixtures";

setupScratchDataDir();

let POST: typeof import("@/app/api/transactions/import/route").POST;
let writeState: typeof import("@/lib/store").writeState;
let readState: typeof import("@/lib/store").readState;

beforeEach(async () => {
  ({ POST } = await import("@/app/api/transactions/import/route"));
  ({ writeState, readState } = await import("@/lib/store"));
});

function importRows(cardId: string, rows: unknown[]) {
  return POST(jsonRequest("http://test/api/transactions/import", "POST", { cardId, rows }));
}

describe("POST /api/transactions/import", () => {
  it("rejects a request with no cardId", async () => {
    await writeState(makeAppState());
    const res = await importRows("", [{ date: "2026-03-05", rawDescription: "X", amount: 5, isCharge: true }]);
    expect(res.status).toBe(400);
  });

  it("rejects an empty rows array", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const res = await importRows(card.id, []);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown card id", async () => {
    await writeState(makeAppState());
    const res = await importRows("nonexistent", [{ date: "2026-03-05", rawDescription: "X", amount: 5, isCharge: true }]);
    expect(res.status).toBe(400);
  });

  it("imports a well-formed row and classifies it as needing review with no vendor match", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: "Totally New Vendor", amount: 42.5, isCharge: true }]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.counts.total).toBe(1);
    expect(body.counts.review).toBe(1);
    expect(body.transactions[0].needsReview).toBe(true);
    expect(body.transactions[0].amount).toBe(42.5);
  });

  it("skips a row with a malformed amount instead of persisting it as corrupt data", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [
      { date: "2026-03-05", rawDescription: "Bad Amount Row", amount: NaN, isCharge: true },
      { date: "2026-03-06", rawDescription: "Good Row", amount: 10, isCharge: true },
    ]);
    const body = await res.json();
    expect(body.counts.skipped).toBe(1);
    expect(body.counts.total).toBe(1);
  });

  it("skips a row with a non-string date instead of persisting it as corrupt data", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [{ date: null, rawDescription: "Bad Date Row", amount: 10, isCharge: true }]);
    const body = await res.json();
    expect(body.counts.skipped).toBe(1);
    expect(body.counts.total).toBe(0);
  });

  it("skips a row with a non-string rawDescription instead of persisting it as corrupt data", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: 12345, amount: 10, isCharge: true }]);
    const body = await res.json();
    expect(body.counts.skipped).toBe(1);
  });

  it("auto-links (no review) an exact match against an existing vendor", async () => {
    const card = makeCard();
    const parent = makeParentVendor();
    const child = makeChildVendor({ rawName: "Costco Wholesale" });
    await writeState(makeAppState({ cards: [card], parentVendors: [parent], childVendors: [child] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: "COSTCO WHOLESALE #456", amount: 55, isCharge: true }]);
    const body = await res.json();
    expect(body.counts.auto).toBe(1);
    expect(body.transactions[0].needsReview).toBe(false);
    expect(body.transactions[0].childVendorId).toBe(child.id);
  });

  it("still requires review for a fuzzy match, even though it pre-links a suggested parent", async () => {
    // Regression test for the exact bug fixed this session: a fuzzy
    // (token-containment) match must not be silently auto-approved, since
    // a short parent name can contain-match an unrelated longer name.
    const card = makeCard();
    const parent = makeParentVendor({ id: "parent_shell", name: "Shell" });
    await writeState(makeAppState({ cards: [card], parentVendors: [parent] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: "Shell Vacations Club", amount: 200, isCharge: true }]);
    const body = await res.json();
    expect(body.counts.auto).toBe(0);
    expect(body.counts.review).toBe(1);
    expect(body.transactions[0].needsReview).toBe(true);
    // It should still pre-link the guessed parent so the review screen can
    // default to it instead of "create new".
    expect(body.transactions[0].childVendorId).not.toBeNull();

    const state = await readState();
    const child = state.childVendors.find((c) => c.id === body.transactions[0].childVendorId);
    expect(child?.parentId).toBe("parent_shell");
  });

  it("trusts a mapped category column to auto-create a vendor with no review", async () => {
    const card = makeCard();
    const category = makeCategory({ id: "cat_gas", name: "Gas" });
    await writeState(makeAppState({ cards: [card], categories: [category] }));

    const res = await importRows(card.id, [
      { date: "2026-03-05", rawDescription: "Some Gas Station", amount: 60, isCharge: true, categoryText: "Gas" },
    ]);
    const body = await res.json();
    expect(body.counts.auto).toBe(1);
    expect(body.transactions[0].needsReview).toBe(false);

    const state = await readState();
    expect(state.parentVendors).toHaveLength(1);
    expect(state.parentVendors[0].category).toBe("cat_gas");
  });

  it("stores amount as an absolute value regardless of sign", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: "Negative Amount Row", amount: -42, isCharge: true }]);
    const body = await res.json();
    expect(body.transactions[0].amount).toBe(42);
  });

  it("skips a row that duplicates an already-imported transaction (e.g. the same file imported twice)", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const row = { date: "2026-03-05", rawDescription: "Costco Wholesale #456", amount: 55, isCharge: true };

    const first = await importRows(card.id, [row]);
    expect((await first.json()).counts.total).toBe(1);

    const second = await importRows(card.id, [row]);
    const body = await second.json();
    expect(body.counts.total).toBe(0);
    expect(body.counts.duplicates).toBe(1);
    expect(body.duplicates).toEqual([
      { date: row.date, rawDescription: row.rawDescription, amount: row.amount, isCharge: row.isCharge },
    ]);

    const state = await readState();
    expect(state.transactions).toHaveLength(1);
  });

  it("stores a conversion note on the created transaction, trimmed", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [
      { date: "2026-03-05", rawDescription: "Foreign Vendor", amount: 73.84, isCharge: true, conversionNote: "  Converted from 1000.00 MXN at 0.07384 (Bank of Canada rate, 2026-03-05).  " },
    ]);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transactions[0].conversionNote).toBe("Converted from 1000.00 MXN at 0.07384 (Bank of Canada rate, 2026-03-05).");
  });

  it("leaves conversionNote unset when the row doesn't have one", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));

    const res = await importRows(card.id, [{ date: "2026-03-05", rawDescription: "Regular CAD purchase", amount: 10, isCharge: true }]);

    expect((await res.json()).transactions[0].conversionNote).toBeUndefined();
  });

  it("carries the conversion note through on a duplicate-row echo", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const row = {
      date: "2026-03-05",
      rawDescription: "Foreign Vendor",
      amount: 73.84,
      isCharge: true,
      conversionNote: "Converted from 1000.00 MXN at 0.07384 (Bank of Canada rate, 2026-03-05).",
    };
    await importRows(card.id, [row]);

    const res = await importRows(card.id, [row]);

    const duplicate = (await res.json()).duplicates[0];
    expect(duplicate.conversionNote).toBe(row.conversionNote);
  });

  it("skips a row that duplicates another row earlier in the same batch", async () => {
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const row = { date: "2026-03-05", rawDescription: "Costco Wholesale #456", amount: 55, isCharge: true };

    const res = await importRows(card.id, [row, row]);
    const body = await res.json();
    expect(body.counts.total).toBe(1);
    expect(body.counts.duplicates).toBe(1);
  });

  it("does not treat a same-day same-amount row on a different card as a duplicate", async () => {
    const cardA = makeCard({ id: "card_a" });
    const cardB = makeCard({ id: "card_b" });
    await writeState(makeAppState({ cards: [cardA, cardB] }));
    const row = { date: "2026-03-05", rawDescription: "Costco Wholesale #456", amount: 55, isCharge: true };

    await importRows(cardA.id, [row]);
    const res = await importRows(cardB.id, [row]);
    const body = await res.json();
    expect(body.counts.total).toBe(1);
    expect(body.counts.duplicates).toBe(0);
  });

  it("adds a forceImport row despite it colliding with an existing transaction", async () => {
    // The user's own scenario: two genuinely separate payments of the same
    // amount to the same vendor on the same day. The first import reports
    // the second as a duplicate; resubmitting it with forceImport: true
    // must add it as a real transaction instead of dropping it again.
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const row = { date: "2026-03-05", rawDescription: "Costco Wholesale #456", amount: 55, isCharge: true };

    await importRows(card.id, [row]);
    const res = await importRows(card.id, [{ ...row, forceImport: true }]);
    const body = await res.json();
    expect(body.counts.total).toBe(1);
    expect(body.counts.duplicates).toBe(0);
    expect(body.transactions[0].amount).toBe(55);

    const state = await readState();
    expect(state.transactions).toHaveLength(2);
  });

  it("still reports a forceImport row as a duplicate against another forced row ahead of it in the same batch", async () => {
    // forceImport only bypasses the check for that row itself — a third,
    // unforced copy in the same batch still collides with the first two.
    const card = makeCard();
    await writeState(makeAppState({ cards: [card] }));
    const row = { date: "2026-03-05", rawDescription: "Costco Wholesale #456", amount: 55, isCharge: true };

    const res = await importRows(card.id, [row, { ...row, forceImport: true }, row]);
    const body = await res.json();
    expect(body.counts.total).toBe(2);
    expect(body.counts.duplicates).toBe(1);

    const state = await readState();
    expect(state.transactions).toHaveLength(2);
  });
});
