import { NextResponse } from "next/server";
import { addDaysISO, enumerateDatesISO, fxSeriesName, resolveDailyRates, type FxObservation } from "@/lib/fx";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Enough lookback to cross any real-world run of weekends + holidays, so the
// first transaction in a statement still has a prior rate to carry forward
// even if it falls right after a long weekend.
const LOOKBACK_DAYS = 10;

// Proxies the Bank of Canada's Valet API (server-side, so the browser never
// talks to it directly) and resolves a rate for every date in [start, end],
// carrying forward across weekends/holidays — see resolveDailyRates.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") || "").trim().toUpperCase();
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";

  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: "A 3-letter currency code is required" }, { status: 400 });
  }
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) {
    return NextResponse.json({ error: "start and end must be valid yyyy-mm-dd dates, with start on or before end" }, { status: 400 });
  }

  const series = fxSeriesName(currency);
  const fetchStart = addDaysISO(start, -LOOKBACK_DAYS);

  let res: Response;
  try {
    res = await fetch(`https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${fetchStart}&end_date=${end}`);
  } catch {
    return NextResponse.json({ error: "Could not reach the Bank of Canada exchange rate service" }, { status: 502 });
  }

  if (res.status === 404) {
    return NextResponse.json({ error: `No Bank of Canada exchange rate series for ${currency} (expected ${series})` }, { status: 400 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "Bank of Canada exchange rate service returned an error" }, { status: 502 });
  }

  const body = await res.json().catch(() => null);
  const rawObservations = Array.isArray(body?.observations) ? body.observations : [];
  const observations: FxObservation[] = rawObservations
    .map((o: Record<string, unknown>) => {
      const date = typeof o?.d === "string" ? o.d : "";
      const cell = o?.[series] as Record<string, unknown> | undefined;
      return { date, rate: Number(cell?.v) };
    })
    .filter((o: FxObservation) => ISO_DATE.test(o.date) && Number.isFinite(o.rate));

  const neededDates = enumerateDatesISO(start, end);
  const resolved = resolveDailyRates(observations, neededDates);
  const missing = neededDates.filter((d) => resolved.get(d) == null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `No ${currency} exchange rate available on or before ${missing[0]} — the series may not go back far enough` },
      { status: 422 }
    );
  }

  const rates: Record<string, number> = {};
  for (const [date, rate] of resolved) rates[date] = rate as number;
  return NextResponse.json({ rates });
}
