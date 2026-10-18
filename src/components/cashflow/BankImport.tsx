"use client";

import { useMemo, useState } from "react";
import type { AppState, BankImportMapping } from "@/lib/types";
import { importBankTransactions, updateBankAccount, type BankImportRow } from "@/lib/api";
import { guessMapping, parseAmount, parseCSV, parseDateFlexible } from "@/lib/csv";
import { BANK_TXN_TYPE_LABELS, classifyBankLine } from "@/lib/bankClassify";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, SecondaryButton, inputStyle, labelStyle } from "../ui";
import { errorMessage, tdStyle, thStyle, weekdayDate } from "./shared";

const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "Month DD, YYYY", "YYYYMMDD", "YYYY-MM-DD HH:MM:SS"];

interface Parsed {
  rows: BankImportRow[];
  bad: number;
}

// Turns CSV lines into import rows with the mapping. A line with both
// columns empty (or zero) carries no money and is skipped; one with both
// filled imports as the net.
export function rowsFromCsv(lines: string[][], mapping: BankImportMapping): Parsed {
  const rows: BankImportRow[] = [];
  let bad = 0;
  for (const line of lines) {
    const date = parseDateFlexible(line[mapping.dateCol], mapping.dateFormat);
    const out = mapping.outCol >= 0 ? parseAmount(line[mapping.outCol]) : NaN;
    const inn = mapping.inCol >= 0 ? parseAmount(line[mapping.inCol]) : NaN;
    const outCents = Number.isFinite(out) ? Math.round(Math.abs(out) * 100) : 0;
    const inCents = Number.isFinite(inn) ? Math.round(Math.abs(inn) * 100) : 0;
    const net = inCents - outCents;
    const rawDescription = String(line[mapping.descCol] ?? "").trim().replace(/\s+/g, " ");
    if (!date || net === 0 || !rawDescription) {
      bad++;
      continue;
    }
    rows.push({ date, rawDescription, amount: Math.abs(net) / 100, direction: net > 0 ? "in" : "out" });
  }
  return { rows, bad };
}

function initialMapping(headers: string[], saved: BankImportMapping | undefined): BankImportMapping {
  if (saved && Math.max(saved.dateCol, saved.descCol, saved.outCol, saved.inCol) < headers.length) return saved;
  const g = guessMapping(headers);
  return { dateCol: Math.max(0, g.dateCol), descCol: Math.max(0, g.descCol), outCol: g.debitCol, inCol: g.creditCol, dateFormat: "MM/DD/YYYY" };
}

export function BankImport({ appState, onReload, accountId, onGoTransactions }: { appState: AppState; onReload: () => Promise<void>; accountId: string; onGoTransactions: () => void }) {
  const pushToast = useToast();
  const account = appState.bankAccounts.find((a) => a.id === accountId)!;
  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<BankImportMapping | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ total: number; review: number; skipped: number; duplicates: BankImportRow[] } | null>(null);

  const headers = lines?.[0] ?? [];
  const parsed = useMemo(() => (lines && mapping ? rowsFromCsv(lines.slice(1), mapping) : null), [lines, mapping]);

  async function onFile(file: File) {
    const text = await file.text();
    const all = parseCSV(text);
    if (all.length < 2) {
      pushToast("That file has no rows to import");
      return;
    }
    setFileName(file.name);
    setLines(all);
    setMapping(initialMapping(all[0].map((h) => h.trim()), account.importMapping));
    setResult(null);
  }

  async function submit(rows: BankImportRow[]) {
    if (!mapping) return;
    setSaving(true);
    try {
      const r = await importBankTransactions(accountId, rows);
      await updateBankAccount(accountId, { importMapping: mapping }).catch(() => {});
      await onReload();
      setResult({ total: r.counts.total, review: r.counts.review, skipped: r.counts.skipped, duplicates: r.duplicates });
      pushToast(`Imported ${r.counts.total} line${r.counts.total === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast(errorMessage(err, "The import failed — nothing was saved"));
    } finally {
      setSaving(false);
    }
  }

  const col = (label: string, key: keyof BankImportMapping, optional: boolean) => (
    <label>
      <div style={labelStyle}>{label}</div>
      <select
        aria-label={label}
        value={String(mapping![key])}
        onChange={(e) => setMapping({ ...mapping!, [key]: Number(e.target.value) })}
        style={{ ...inputStyle, padding: "7px" }}
      >
        {optional && <option value="-1">(none)</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h.trim() || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <PageTitle>Import Bank CSV</PageTitle>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, maxWidth: 720 }}>
        Import {account.name}&apos;s CSV export (Date, Transaction Details, Funds Out, Funds In). Lines are sorted into pay, e-transfers, debit purchases, bill
        payments, and so on from their details text; lines already imported are skipped.
      </div>
      <input aria-label="Bank CSV file" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />

      {lines && mapping && parsed && !result && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
            {col("Date", "dateCol", false)}
            {col("Details", "descCol", false)}
            {col("Funds out", "outCol", true)}
            {col("Funds in", "inCol", true)}
            <label>
              <div style={labelStyle}>Date format</div>
              <select aria-label="Date format" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value })} style={{ ...inputStyle, padding: "7px" }}>
                {DATE_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <b>{fileName}</b>: {parsed.rows.length} line{parsed.rows.length === 1 ? "" : "s"} to import
            {parsed.bad > 0 && <span style={{ color: "var(--attention)" }}> · {parsed.bad} without a readable date, details, or amount (check the date format)</span>}
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto", maxHeight: 420, marginBottom: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 14 }}>Date</th>
                  <th style={thStyle}>Details</th>
                  <th style={thStyle}>Type</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 200).map((r, i) => {
                  const c = classifyBankLine(r.rawDescription, r.direction);
                  return (
                    <tr key={i}>
                      <td style={{ ...tdStyle, paddingLeft: 14, whiteSpace: "nowrap" }}>{weekdayDate(r.date)}</td>
                      <td style={tdStyle}>{r.rawDescription}</td>
                      <td style={{ ...tdStyle, color: c.recognised ? "var(--text)" : "var(--attention)" }}>
                        {BANK_TXN_TYPE_LABELS[c.type]}
                        {!c.recognised && " (guess)"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: r.direction === "in" ? "var(--positive)" : "var(--text)" }}>
                        {r.direction === "in" ? "+" : "−"}
                        {fmtCurrency(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 200 && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Showing the first 200.</div>}
          <PrimaryButton onClick={() => submit(parsed.rows)} disabled={saving || parsed.rows.length === 0}>
            {saving ? "Importing…" : `Import ${parsed.rows.length} lines`}
          </PrimaryButton>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 18, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", maxWidth: 720 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Imported {result.total} line{result.total === 1 ? "" : "s"}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            {result.review} to review · {result.duplicates.length} already imported{result.skipped ? ` · ${result.skipped} unreadable` : ""}
          </div>
          {result.duplicates.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                Skipped as already imported — if any are genuinely separate (two same-day, same-amount lines), import them anyway:
              </div>
              <ul style={{ fontSize: 12.5, margin: "0 0 8px", paddingLeft: 18 }}>
                {result.duplicates.slice(0, 20).map((d, i) => (
                  <li key={i}>
                    {d.date} · {d.rawDescription} · {fmtCurrency(d.amount)}
                  </li>
                ))}
              </ul>
              <SecondaryButton onClick={() => submit(result.duplicates.map((d) => ({ ...d, forceImport: true })))}>Import these anyway</SecondaryButton>
            </div>
          )}
          <PrimaryButton onClick={onGoTransactions}>Review and match bank lines</PrimaryButton>
        </div>
      )}
    </div>
  );
}
