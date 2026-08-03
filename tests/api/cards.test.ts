import { beforeEach, describe, expect, it } from "vitest";
import { setupScratchDataDir, jsonRequest } from "../helpers/testStore";

setupScratchDataDir();

let POST: typeof import("@/app/api/cards/route").POST;
let PATCH: typeof import("@/app/api/cards/[id]/route").PATCH;

beforeEach(async () => {
  ({ POST } = await import("@/app/api/cards/route"));
  ({ PATCH } = await import("@/app/api/cards/[id]/route"));
});

async function createCard(overrides: Record<string, unknown> = {}) {
  const res = await POST(
    jsonRequest("http://test/api/cards", "POST", {
      name: "Simplii Visa",
      bank: "Simplii",
      last4: "1234",
      network: "Visa",
      ...overrides,
    })
  );
  return res.json();
}

describe("POST /api/cards", () => {
  it("creates a card", async () => {
    const card = await createCard();
    expect(card.name).toBe("Simplii Visa");
    expect(card.last4).toBe("1234");
    expect(card.network).toBe("Visa");
  });

  it("rejects a card with no name", async () => {
    const res = await POST(jsonRequest("http://test/api/cards", "POST", { bank: "Simplii" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/cards/[id]", () => {
  it("updates name, bank, and network", async () => {
    const card = await createCard();
    const res = await PATCH(
      jsonRequest(`http://test/api/cards/${card.id}`, "PATCH", { name: "Renamed", bank: "New Bank", network: "Mastercard" }),
      { params: Promise.resolve({ id: card.id }) }
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe("Renamed");
    expect(updated.bank).toBe("New Bank");
    expect(updated.network).toBe("Mastercard");
  });

  it("updates last4 (previously silently ignored by this route)", async () => {
    const card = await createCard({ last4: "0000" });
    const res = await PATCH(jsonRequest(`http://test/api/cards/${card.id}`, "PATCH", { last4: "9999" }), {
      params: Promise.resolve({ id: card.id }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.last4).toBe("9999");
  });

  it("returns 404 for an unknown card id", async () => {
    const res = await PATCH(jsonRequest("http://test/api/cards/missing", "PATCH", { name: "X" }), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
