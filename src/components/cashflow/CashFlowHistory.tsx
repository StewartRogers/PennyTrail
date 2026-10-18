"use client";

import { Fragment, useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { importCashFlowHistory } from "@/lib/api";
import { entriesForMonth, summarizeMonth } from "@/lib/cashflow";
import { readXlsx, type XlsxCell } from "@/lib/xlsx";
import { parseBudgetSheet, seedItems, normalizeItemName, type ParsedMonth, type SeededItem } from "@/lib/historyImport";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, SecondaryButton } from "../ui";
import { SETTLEMENT_LABELS, Tag, describeRecurrence, errorMessage, longMonthLabel, monthsForAccount, tdStyle, thStyle, todayIso } from "./shared";

export function CashFlowHistory({ appState, onReload, accountId, onOpenMonth }: { appState: AppState; onReload: () => Promise<void>; accountId: string; onOpenMonth: (monthKey: string) => void }) {
  const months = monthsForAccount(appState.cashFlowMonths, accountId).reverse();
  const [importing, setImporting] = useState(months.length === 0);

  const rows = months.map((m) => {
    const s = summarizeMonth(m, entriesForMonth(appState.cashFlowEntries, m.id));
    const recordedDays = s.periods.filter((p) => p.actual !== undefined).reduce((n, p) => n + p.days, 0);
    return { m, s, perDay: recordedDays > 0 ? Math.round((s.impliedSpend / recordedDays) * 100) / 100 : null };
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <PageTitle>History</PageTitle>
        <div style={{ marginLeft: "auto" }}>{!importing && <SecondaryButton onClick={() => setImporting(true)}>Import spreadsheet history</SecondaryButton>}</div>
      </div>

      {importing && <HistoryImport appState={appState} accountId={accountId} onReload={onReload} onClose={() => setImporting(false)} />}

      {rows.length > 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 16 }}>Month</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Opening</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Deposits</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Bills</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Est. spend</th>
                <th style={{ ...thStyle, textAlign: "right" }} title="Weekly Spend minus each checkpoint's variance, over the recorded periods">
                  Actual spend
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>Closing</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, s, perDay }) => (
                <tr key={m.id} onClick={() => onOpenMonth(m.month)} style={{ cursor: "pointer" }}>
                  <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 600 }}>{longMonthLabel(m.month)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(s.opening)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: "var(--positive)" }}>{fmtCurrency(s.deposits)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(s.bills)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(s.spend)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>
                    {perDay === null ? "—" : fmtCurrency(s.impliedSpend)}
                    {perDay !== null && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmtCurrency(perDay)}/day</div>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                    {fmtCurrency(s.closingBalance)}
                    {!s.closingIsActual && <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 400 }}>projected</div>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{m.closed ? <Tag color="var(--positive)">Closed</Tag> : <Tag color="var(--accent)">Open</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Keeps what the server needs: cell values only, rows trimmed of trailing
// blanks, and trailing empty rows dropped.
function compactRows(rows: XlsxCell[][]): XlsxCell[][] {
  const trimmed = rows.map((r) => {
    const row = r.slice(0, 26);
    let end = row.length;
    while (end > 0 && (row[end - 1] === null || row[end - 1] === "")) end--;
    return row.slice(0, end);
  });
  let last = trimmed.length;
  while (last > 0 && trimmed[last - 1].length === 0) last--;
  return trimmed.slice(0, last);
}

interface Loaded {
  fileName: string;
  sheets: { name: string; rows: XlsxCell[][] }[];
  parsed: ParsedMonth[];
  errors: { sheetName: string; error: string }[];
}

function HistoryImport({ appState, accountId, onReload, onClose }: { appState: AppState; accountId: string; onReload: () => Promise<void>; onClose: () => void }) {
  const pushToast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [oneOff, setOneOff] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = todayIso();
  const account = appState.bankAccounts.find((a) => a.id === accountId)!;
  const existingMonths = new Set(appState.cashFlowMonths.filter((m) => m.accountId === accountId).map((m) => m.month));
  const existingItemKeys = new Set(appState.cashFlowItems.filter((i) => i.accountId === accountId).map((i) => normalizeItemName(i.name).key));

  const seeded: SeededItem[] = useMemo(() => (loaded ? seedItems(loaded.parsed, new Set(account.bankHolidays)) : []), [loaded, account.bankHolidays]);

  async function onFile(file: File) {
    setReading(true);
    try {
      const sheets = (await readXlsx(await file.arrayBuffer())).filter((s) => !s.hidden).map((s) => ({ name: s.name, rows: compactRows(s.rows) }));
      const parsed: ParsedMonth[] = [];
      const errors: Loaded["errors"] = [];
      for (const s of sheets) {
        const r = parseBudgetSheet(s.name, s.rows, today);
        if (r.ok) parsed.push(r.month);
        else errors.push({ sheetName: r.sheetName, error: r.error });
      }
      parsed.sort((a, b) => (a.month < b.month ? -1 : 1));
      setLoaded({ fileName: file.name, sheets, parsed, errors });
      setOneOff(new Set());
    } catch (err) {
      pushToast(errorMessage(err, "Couldn't read that file"));
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    if (!loaded) return;
    setSaving(true);
    try {
      const months = new Set(loaded.parsed.map((p) => p.sheetName));
      const result = await importCashFlowHistory({
        accountId,
        sheets: loaded.sheets.filter((s) => months.has(s.name)),
        oneOffKeys: [...oneOff],
        today,
      });
      await onReload();
      pushToast(`Imported ${result.importedMonths} month${result.importedMonths === 1 ? "" : "s"}, ${result.entries} entries, ${result.items} recurring item${result.items === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      pushToast(errorMessage(err, "The import failed — nothing was saved"));
    } finally {
      setSaving(false);
    }
  }

  const duplicateMonths = loaded ? loaded.parsed.filter((p, i, all) => all.findIndex((q) => q.month === p.month) !== i).map((p) => p.month) : [];
  const toImport = loaded ? loaded.parsed.filter((p) => !existingMonths.has(p.month)) : [];

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Import spreadsheet history</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, maxWidth: 760 }}>
        In Google Sheets choose <b>File → Download → Microsoft Excel (.xlsx)</b>, then pick that file here. Each worksheet becomes a month: Weekly Spend rows set each period&apos;s
        spend, END OF WEEK rows its recorded balance, and every other row an entry. Nothing is saved until you import, and months you already have are never overwritten.
      </div>
      <input aria-label="Workbook file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={reading} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {reading && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Reading…</div>}

      {loaded && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5, marginBottom: 10 }}>
            <b>{loaded.fileName}</b>: {loaded.parsed.length} month{loaded.parsed.length === 1 ? "" : "s"}
            {loaded.parsed.length > 0 && ` (${longMonthLabel(loaded.parsed[0].month)} – ${longMonthLabel(loaded.parsed[loaded.parsed.length - 1].month)})`}
            {loaded.errors.length > 0 && `, ${loaded.errors.length} sheet${loaded.errors.length === 1 ? "" : "s"} skipped`}.
            {toImport.length !== loaded.parsed.length && ` ${loaded.parsed.length - toImport.length} already exist and will be skipped.`}
          </div>
          {duplicateMonths.length > 0 && (
            <div role="alert" style={{ color: "var(--attention)", fontSize: 13, marginBottom: 10 }}>
              Two sheets are both {duplicateMonths.map(longMonthLabel).join(", ")} — rename or hide one in the spreadsheet and download it again.
            </div>
          )}
          {loaded.errors.length > 0 && (
            <ul style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", paddingLeft: 18 }}>
              {loaded.errors.map((e) => (
                <li key={e.sheetName}>
                  “{e.sheetName}”: {e.error}
                </li>
              ))}
            </ul>
          )}

          <div style={{ fontSize: 14, fontWeight: 600, margin: "16px 0 6px" }}>Months</div>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 12 }}>Sheet</th>
                  <th style={thStyle}>Month</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Opening</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Entries</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Checkpoints</th>
                  <th style={thStyle}>Checks</th>
                </tr>
              </thead>
              <tbody>
                {loaded.parsed.map((p) => {
                  const issues = p.warnings.length + p.balanceMismatches.length;
                  const exists = existingMonths.has(p.month);
                  return (
                    <Fragment key={p.sheetName}>
                      <tr style={{ opacity: exists ? 0.5 : 1 }}>
                        <td style={{ ...tdStyle, paddingLeft: 12 }}>{p.sheetName}</td>
                        <td style={tdStyle}>{longMonthLabel(p.month)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(p.openingBalance)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{p.entries.length}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {p.periods.filter((x) => x.actualBalance !== undefined).length}/{p.periods.length} recorded
                        </td>
                        <td style={tdStyle}>
                          {exists ? (
                            <Tag>Already imported — skipped</Tag>
                          ) : issues === 0 ? (
                            <Tag color="var(--positive)">Balances match the sheet</Tag>
                          ) : (
                            <button onClick={() => setOpen(open === p.sheetName ? null : p.sheetName)} style={{ border: "none", background: "none", color: "var(--attention)", padding: 0, fontSize: 12.5, textDecoration: "underline" }}>
                              {issues} thing{issues === 1 ? "" : "s"} to check
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === p.sheetName && (
                        <tr>
                          <td colSpan={6} style={{ ...tdStyle, paddingLeft: 24, fontSize: 12, color: "var(--muted)" }}>
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {p.balanceMismatches.map((b) => (
                                <li key={`b${b.row}`}>
                                  Row {b.row}: the sheet shows {fmtCurrency(b.sheet)}, the rows above add up to {fmtCurrency(b.computed)}
                                </li>
                              ))}
                              {p.warnings.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, margin: "16px 0 4px" }}>Recurring items</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
            Worked out from the history: names seen in at least three months. Untick any you&apos;d rather keep as one-off rows. You can edit them afterwards in Recurring Items.
          </div>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 12, width: 1 }} />
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Schedule</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  <th style={thStyle}>Completed by</th>
                  <th style={thStyle}>Months</th>
                </tr>
              </thead>
              <tbody>
                {seeded.map((s) => {
                  const exists = existingItemKeys.has(s.key);
                  return (
                    <tr key={s.key} style={{ opacity: s.active ? 1 : 0.6 }}>
                      <td style={{ ...tdStyle, paddingLeft: 12 }}>
                        <input
                          type="checkbox"
                          aria-label={`Make ${s.name} a recurring item`}
                          checked={!oneOff.has(s.key)}
                          disabled={exists}
                          onChange={(e) =>
                            setOneOff((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(s.key);
                              else next.add(s.key);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {s.name} {s.owner && <Tag>{s.owner}</Tag>} {!s.active && <Tag>inactive</Tag>} {exists && <Tag>already set up</Tag>}
                      </td>
                      <td style={tdStyle}>
                        {describeRecurrence(s.recurrence)}
                        {s.dateUncertain && <span style={{ color: "var(--muted)" }}> (date is an estimate)</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>
                        {fmtCurrency(s.defaultAmount)} <span style={{ color: "var(--muted)", fontFamily: "var(--font-sans), sans-serif" }}>{s.amountMode === "variable" ? "varies" : "fixed"}</span>
                      </td>
                      <td style={tdStyle}>{SETTLEMENT_LABELS[s.settlement]}</td>
                      <td style={tdStyle}>{s.monthsSeen}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <PrimaryButton onClick={runImport} disabled={saving || toImport.length === 0 || duplicateMonths.length > 0}>
              {saving ? "Importing…" : `Import ${toImport.length} month${toImport.length === 1 ? "" : "s"}`}
            </PrimaryButton>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          </div>
        </div>
      )}
      {!loaded && (
        <div style={{ marginTop: 12 }}>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      )}
    </div>
  );
}
