export function fmtCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtCurrencyShort(n: number | null | undefined): string {
  const abs = Math.abs(n || 0);
  const sign = (n || 0) < 0 ? "-" : "";
  // Without an M tier the "compact" form got *longer* than the real number
  // past a million: 1250000 rendered as "$1250.0k".
  if (abs >= 1_000_000_000) return sign + "$" + (abs / 1_000_000_000).toFixed(1) + "B";
  if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(1) + "M";
  if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(1) + "k";
  return fmtCurrency(n);
}

// Whole-dollar amount, no "k" abbreviation — used where the actual sum
// matters more than compactness (e.g. chart bar labels).
export function fmtCurrencyWhole(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  // Anything that isn't a real yyyy-mm-dd used to render as the literal
  // string "Invalid Date" in the middle of the transactions table. Show
  // nothing rather than that.
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Local-calendar yyyy-mm-dd. `new Date(y, m, d).toISOString()` converts to UTC
// first, so east of UTC local midnight lands on the *previous* day and a
// range cutoff silently shifted by one day (verified: TZ=Europe/Berlin turned
// a 2026-01-01 cutoff into 2025-12-31).
export function toISODate(dt: Date): string {
  return (
    dt.getFullYear().toString().padStart(4, "0") +
    "-" +
    String(dt.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getDate()).padStart(2, "0")
  );
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function quarterKey(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return y + "-Q" + (Math.floor((m - 1) / 3) + 1);
}

export function yearKey(iso: string): string {
  return iso.slice(0, 4);
}
