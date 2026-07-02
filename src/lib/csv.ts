// CSV parsing and column-mapping helpers, ported from the design handoff's
// cc-analyzer-data.js (plain, dependency-free reference implementation).

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && next === "\n") i++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface GuessedMapping {
  dateCol: number;
  descCol: number;
  amountCol: number;
  debitCol: number;
  creditCol: number;
  categoryCol: number;
  typeCol: number;
}

export function guessMapping(headers: string[]): GuessedMapping {
  const low = headers.map((h) => (h || "").toLowerCase().trim());
  const find = (...needles: string[]) => {
    for (const n of needles) {
      const i = low.findIndex((h) => h === n);
      if (i > -1) return i;
    }
    for (const n of needles) {
      const i = low.findIndex((h) => h.includes(n));
      if (i > -1) return i;
    }
    return -1;
  };
  return {
    dateCol: find("date", "transaction date", "post date", "posted date"),
    descCol: find("description", "merchant", "payee", "details", "name"),
    amountCol: find("amount", "amt"),
    debitCol: find("debit"),
    creditCol: find("credit"),
    categoryCol: find("category"),
    typeCol: find("type", "transaction type"),
  };
}

export function parseAmount(str: unknown): number {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (s === "") return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.\-]/g, "");
  if (s.startsWith("-")) negative = true;
  s = s.replace("-", "");
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

export function parseDateFlexible(str: unknown, format: string): string | null {
  if (!str) return null;
  const s = String(str).trim();
  let y: number, m: number, d: number;
  if (format === "YYYY-MM-DD") {
    const p = s.split(/[-/]/);
    y = +p[0];
    m = +p[1];
    d = +p[2];
  } else if (format === "DD/MM/YYYY") {
    const p = s.split(/[-/]/);
    d = +p[0];
    m = +p[1];
    y = +p[2];
  } else {
    // MM/DD/YYYY default (also handles MM/DD/YY)
    const p = s.split(/[-/]/);
    m = +p[0];
    d = +p[1];
    y = +p[2];
    if (y < 100) y += 2000;
  }
  if (!y || !m || !d) return null;
  const iso =
    y.toString().padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  return iso;
}
