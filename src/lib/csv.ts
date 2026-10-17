// CSV parsing and column-mapping helpers, ported from the design handoff's
// cc-analyzer-data.js (plain, dependency-free reference implementation).

export function parseCSV(text: string): string[][] {
  // Excel's "CSV UTF-8" export leads with a byte-order mark. Left in place it
  // sat in front of the first header's opening quote, so that quote no longer
  // started the field and `"Date"` kept its literal quotes.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
      // A quote only opens a quoted field at the *start* of a field. Treating
      // any bare `"` as an opening quote meant one stray inch-mark in a
      // description ("BEST BUY 21\" TV") swallowed every remaining row of the
      // file into a single field, and the wizard imported the survivors with
      // no error. Mid-field quotes are literal characters, as in every real
      // CSV reader.
      // Padding before the quote (`a, "b, c"`) still counts as the start of
      // the field — otherwise the quote was literal and the comma inside it
      // split the value in two.
      if (c === '"' && field.trim() === "") {
        inQuotes = true;
        field = "";
      }
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
  // Needles run most-specific-first. With "date" listed first, the substring
  // pass matched it inside "Post Date" before "transaction date" was ever
  // tried, so on a `Post Date, Transaction Date, ...` export the posting date
  // won purely by column order and the later needles were dead code.
  const mapping = {
    dateCol: find("transaction date", "posted date", "post date", "date"),
    descCol: find("description", "merchant", "payee", "details", "name"),
    amountCol: find("amount", "amt"),
    debitCol: find("debit"),
    creditCol: find("credit"),
    categoryCol: find("category"),
    typeCol: find("transaction type", "type"),
  };
  // A single combined column ("Debit/Credit") substring-matches both needles.
  // Mapping it to both meant split mode read the same indicator cell twice —
  // parseAmount("DR") is NaN both times, so every row was silently dropped.
  // It's a direction flag, not an amount column; leave both unmapped.
  if (mapping.debitCol > -1 && mapping.debitCol === mapping.creditCol) {
    mapping.debitCol = -1;
    mapping.creditCol = -1;
  }
  return mapping;
}

// Works out which of "." and "," is the decimal point before any separator is
// stripped. Blanket-stripping both (the previous behaviour) silently produced
// wrong money: "12,34" read as 1234 (100x too large), "1.234,56" as 1.23456
// (1000x too small), and the corrupt cell "1.234.56" as a plausible 1.234
// rather than NaN, so it was imported instead of skipped.
// A leading thousands group can't start with 0 — "0.123" is a decimal, not
// 123.
const LEADING_GROUP = /^[1-9]\d{0,2}$/;

function stripGroupingSeparators(s: string): string | null {
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // Whichever separator comes last is the decimal point; the other groups
    // thousands. Covers both "1,234.56" and "1.234,56". The integer part
    // still has to be well-formed grouping — "1,2,3.4" is a corrupt cell,
    // not 123.4.
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    const cut = s.lastIndexOf(decimal);
    const groups = s.slice(0, cut).split(grouping);
    if (!groups.every((p, i) => (i === 0 ? LEADING_GROUP : /^\d{3}$/).test(p))) return null;
    return groups.join("") + "." + s.slice(cut + 1);
  }

  const sep = hasDot ? "." : hasComma ? "," : null;
  if (!sep) return s;

  const parts = s.split(sep);
  if (parts.length === 2) {
    // A single separator with a 3-digit tail is genuinely ambiguous
    // ("1,234" is 1234 in en-US, 1.234 in de-DE). This app formats as en-US
    // throughout, so read it as a thousands group.
    if (LEADING_GROUP.test(parts[0]) && /^\d{3}$/.test(parts[1])) return parts[0] + parts[1];
    return parts[0] + "." + parts[1];
  }
  // Several separators can only be thousands grouping, and only if every
  // group is well-formed — otherwise it's a corrupt cell and must not parse.
  if (parts.every((p, i) => (i === 0 ? LEADING_GROUP : /^\d{3}$/).test(p))) return parts.join("");
  return null;
}

export function parseAmount(str: unknown): number {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (s === "") return NaN;
  s = s.replace(/[‐-―−]/g, "-"); // normalize unicode hyphen/dash/minus variants to ascii hyphen
  let negative = false;
  // Some issuers mark direction with a trailing CR/DR instead of a sign;
  // "12.34 CR" read as +12.34, so in single-amount mode a refund imported as
  // a charge.
  const indicator = /(?<=[\d\s)])(CR|DR)\.?$/i.exec(s);
  if (indicator) {
    if (indicator[1].toUpperCase() === "CR") negative = true;
    s = s.slice(0, indicator.index).trim();
  }
  // Accounting negatives. The parens were previously only recognized when "("
  // was the very first character, so "$(1,234.56)" — the same value with the
  // symbol outside — imported as a positive charge instead of a credit.
  if (/\(.*\)/.test(s)) {
    negative = true;
    s = s.replace(/[()]/g, "");
  }
  // Currency symbols and a leading/trailing code ("CAD 12.34", "12.34 USD",
  // "US$12") are decoration. Anything else non-numeric left after that means
  // the cell isn't an amount — stripping it silently read "1e3" as 13.
  s = s.replace(/\p{Sc}/gu, " ").trim();
  s = s.replace(/^[A-Za-z]{2,3}(?![A-Za-z])\s*|\s*(?<![A-Za-z])[A-Za-z]{2,3}$/g, "").trim();
  // A minus only signs the amount at either end; one buried mid-cell
  // ("USD-ish 5") made the whole amount negative.
  if (/^-|-$/.test(s)) negative = true;
  s = s.replace(/^[-+\s]+|[-+\s]+$/g, "").replace(/\s/g, "");
  if (s === "" || /[^0-9.,]/.test(s)) return NaN;
  const normalized = stripGroupingSeparators(s);
  if (normalized === null) return NaN;
  const n = parseFloat(normalized);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

// Exactly three numeric parts, with the year a 2- or 4-digit field. Plain
// splitting accepted "1/15/2026/9" (extra part ignored) and "01/15/126"
// (stored as year 0126).
function splitDateParts(s: string, yearIndex: number): string[] | null {
  const p = s.split(/[-/]/);
  if (p.length !== 3 || !p.every((part) => /^\d+$/.test(part))) return null;
  if (!/^(\d{2}|\d{4})$/.test(p[yearIndex])) return null;
  if (p.some((part, i) => i !== yearIndex && part.length > 2)) return null;
  return p;
}

// A statement can't be dated far in the future, so a 2-digit year that would
// land more than a year ahead belongs to the 1900s ("99" is 1999, not 2099).
function expandTwoDigitYear(y: number): number {
  return 2000 + y > new Date().getFullYear() + 1 ? 1900 + y : 2000 + y;
}

export function parseDateFlexible(str: unknown, format: string): string | null {
  if (!str) return null;
  const s = String(str).trim();
  let y: number, m: number, d: number;
  if (format === "Month DD, YYYY") {
    // Accepts both full ("May 21, 2026") and abbreviated ("Jan 5, 2026")
    // month names, with or without the comma.
    const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}|\d{2})$/.exec(s);
    if (!match) return null;
    m = MONTH_NAMES[match[1].toLowerCase()] ?? NaN;
    d = +match[2];
    y = +match[3];
  } else if (format === "YYYYMMDD") {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!match) return null;
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else if (format === "YYYY-MM-DD HH:MM:SS") {
    // Only the date portion matters — whatever time-of-day, seconds
    // precision, or "T" vs space separator follows is discarded.
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T]/.exec(s);
    if (!match) return null;
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else if (format === "YYYY-MM-DD") {
    const p = splitDateParts(s, 0);
    if (!p) return null;
    y = +p[0];
    m = +p[1];
    d = +p[2];
  } else if (format === "DD/MM/YYYY") {
    const p = splitDateParts(s, 2);
    if (!p) return null;
    d = +p[0];
    m = +p[1];
    y = +p[2];
  } else {
    // MM/DD/YYYY default (also handles MM/DD/YY)
    const p = splitDateParts(s, 2);
    if (!p) return null;
    m = +p[0];
    d = +p[1];
    y = +p[2];
  }
  if (y < 100) y = expandTwoDigitYear(y);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // `d <= 31` alone let impossible dates through: "02/30/2026" became the ISO
  // string "2026-02-30", which passes the import route's format check and is
  // stored — then fmtDateShort's `new Date(2026, 1, 30)` rolls it over and the
  // row displays as "Mar 2, 2026" while monthKey still buckets it under
  // February, so the table and the charts disagree. Reject anything the
  // calendar doesn't actually have.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  const iso =
    y.toString().padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  return iso;
}
