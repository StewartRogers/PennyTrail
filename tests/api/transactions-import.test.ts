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
});
