export function fmtCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtCurrencyShort(n: number | null | undefined): string {
  const abs = Math.abs(n || 0);
  if (abs >= 1000) return (n! < 0 ? "-" : "") + "$" + (abs / 1000).toFixed(1) + "k";
  return fmtCurrency(n);
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
