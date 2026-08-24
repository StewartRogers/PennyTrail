// Bank of Canada Valet API helpers for converting a foreign-currency
// statement into CAD at import time. The Valet series for a currency pair
// is named FX<CODE>CAD and is already quoted as CAD per 1 unit of that
// currency, so converting is a plain multiply — no inversion or cross-rate
// arithmetic. See https://www.bankofcanada.ca/valet/docs.

export interface FxObservation {
  date: string; // ISO yyyy-mm-dd
  rate: number; // CAD per 1 unit of the foreign currency
}

export function fxSeriesName(currency: string): string {
  return `FX${currency.toUpperCase()}CAD`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear().toString().padStart(4, "0") + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

export function enumerateDatesISO(startISO: string, endISO: string): string[] {
  const dates: string[] = [];
  for (let d = startISO; d <= endISO; d = addDaysISO(d, 1)) dates.push(d);
  return dates;
}

// The Bank of Canada only publishes a rate on business days — weekends and
// holidays have no observation of their own, so a transaction dated on one
// carries forward the most recent prior business day's rate, the same
// convention a card statement itself uses. A date before the earliest
// available observation resolves to null (nothing to carry forward from).
export function resolveDailyRates(observations: FxObservation[], neededDates: string[]): Map<string, number | null> {
  const sorted = [...observations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const result = new Map<string, number | null>();
  for (const date of neededDates) {
    let rate: number | null = null;
    for (const obs of sorted) {
      if (obs.date > date) break;
      rate = obs.rate;
    }
    result.set(date, rate);
  }
  return result;
}
