import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/fx-rates/route";

function mockBankOfCanadaResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function req(query: string) {
  return new Request(`http://test/api/fx-rates?${query}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/fx-rates", () => {
  it("resolves a rate for every date in range, carrying forward across a weekend", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockBankOfCanadaResponse(200, {
        observations: [
          { d: "2026-03-05", FXMXNCAD: { v: "0.0735" } },
          { d: "2026-03-06", FXMXNCAD: { v: "0.0740" } },
        ],
      })
    );

    // 2026-03-07/08 is a weekend with no observation of its own.
    const res = await GET(req("currency=MXN&start=2026-03-05&end=2026-03-08"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rates).toEqual({
      "2026-03-05": 0.0735,
      "2026-03-06": 0.074,
      "2026-03-07": 0.074,
      "2026-03-08": 0.074,
    });
  });

  it("requests the Bank of Canada with enough lookback to carry the start date forward", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(mockBankOfCanadaResponse(200, { observations: [{ d: "2026-02-27", FXMXNCAD: { v: "0.07" } }] }));

    await GET(req("currency=MXN&start=2026-03-05&end=2026-03-05"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/observations/FXMXNCAD/json");
    expect(url).toContain("start_date=2026-02-23"); // 10 days of lookback before 2026-03-05
    expect(url).toContain("end_date=2026-03-05");
  });

  it("lowercases and normalizes the currency into the series name", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(mockBankOfCanadaResponse(200, { observations: [{ d: "2026-03-05", FXUSDCAD: { v: "1.37" } }] }));

    await GET(req("currency=usd&start=2026-03-05&end=2026-03-05"));

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/observations/FXUSDCAD/json");
  });

  it("rejects a currency that isn't a 3-letter code", async () => {
    const res = await GET(req("currency=US&start=2026-03-05&end=2026-03-05"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing or malformed date range", async () => {
    expect((await GET(req("currency=MXN&start=&end=2026-03-05"))).status).toBe(400);
    expect((await GET(req("currency=MXN&start=2026-03-05&end=2026-03-01"))).status).toBe(400); // end before start
  });

  it("returns a 400 when the Bank of Canada has no series for that currency", async () => {
    vi.mocked(fetch).mockResolvedValue(mockBankOfCanadaResponse(404, { message: "Series FXZZZCAD not found." }));

    const res = await GET(req("currency=ZZZ&start=2026-03-05&end=2026-03-05"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ZZZ");
  });

  it("returns a 502 when the Bank of Canada is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const res = await GET(req("currency=MXN&start=2026-03-05&end=2026-03-05"));

    expect(res.status).toBe(502);
  });

  it("returns a 422 when no observation exists far enough back to resolve a needed date", async () => {
    // The series only starts after the requested date — nothing to carry
    // forward from, even with the lookback window.
    vi.mocked(fetch).mockResolvedValue(mockBankOfCanadaResponse(200, { observations: [] }));

    const res = await GET(req("currency=MXN&start=2026-03-05&end=2026-03-05"));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("2026-03-05");
  });
});
