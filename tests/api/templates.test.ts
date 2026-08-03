import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";

setupScratchDataDir();

let POST: typeof import("@/app/api/templates/route").POST;

beforeEach(async () => {
  ({ POST } = await import("@/app/api/templates/route"));
});

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
});
