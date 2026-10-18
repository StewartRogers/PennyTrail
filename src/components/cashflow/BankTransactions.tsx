"use client";

import { useMemo, useState } from "react";
import type { AppState, BankTransaction, BankTxnType } from "@/lib/types";
import { confirmBankMatches, deleteBankTransactions, unlinkBankMatch, updateBankTransaction } from "@/lib/api";
import { suggestMatches } from "@/lib/bankMatching";
import { BANK_TXN_TYPES, BANK_TXN_TYPE_LABELS } from "@/lib/bankClassify";
import { categoryIdForTransaction } from "@/lib/vendors";
import { entryAmount, entryDate } from "@/lib/cashflow";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, inputStyle } from "../ui";
import { ConfirmButton, SmallButton, Tag, errorMessage, longMonthLabel, signedAmount, tdStyle, thStyle, weekdayDate } from "./shared";

export function BankTransactions({ appState, onReload, accountId }: { appState: AppState; onReload: () => Promise<void>; accountId: string }) {
  const pushToast = useToast();
  const lines = useMemo(() => appState.bankTransactions.filter((t) => t.accountId === accountId), [appState.bankTransactions, accountId]);
  const months = [...new Set(lines.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const [month, setMonth] = useState<string>("all");
  const [type, setType] = useState<BankTxnType | "all">("all");
  const [reviewOnly, setReviewOnly] = useState(false);

  const entryById = new Map(appState.cashFlowEntries.map((e) => [e.id, e]));
  const suggestions = useMemo(
    () => suggestMatches({ bankTransactions: lines, entries: appState.cashFlowEntries, items: appState.cashFlowItems, months: appState.cashFlowMonths }),
    [lines, appState.cashFlowEntries, appState.cashFlowItems, appState.cashFlowMonths]
  );
  // Exact matches start ticked and likely ones unticked; `toggled` records
  // the boxes changed from that default.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isChecked = (s: (typeof suggestions)[number]) => (s.confidence === "exact") !== toggled.has(s.bankTransactionId + s.entryId);
  const txnById = new Map(lines.map((t) => [t.id, t]));

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      await onReload();
      if (success) pushToast(success);
    } catch (err) {
      pushToast(errorMessage(err, "Couldn't save the change"));
    }
  }

  const shown = lines.filter((t) => (month === "all" || t.date.startsWith(month)) && (type === "all" || t.type === type) && (!reviewOnly || t.needsReview));
  const selected = suggestions.filter(isChecked);

  return (
    <div>
      <PageTitle>Bank Transactions</PageTitle>

      {suggestions.length > 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 18, overflowX: "auto" }}>
          <div style={{ padding: "12px 16px 4px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Suggested matches · {suggestions.length}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Confirming marks the entry posted on the bank line&apos;s date, for its amount.</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 16, width: 1 }} />
                <th style={thStyle}>Bank line</th>
                <th style={thStyle}>Entry</th>
                <th style={thStyle}>Why</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => {
                const t = txnById.get(s.bankTransactionId)!;
                const e = entryById.get(s.entryId)!;
                const key = s.bankTransactionId + s.entryId;
                return (
                  <tr key={key}>
                    <td style={{ ...tdStyle, paddingLeft: 16 }}>
                      <input
                        type="checkbox"
                        aria-label={`Match ${t.rawDescription} to ${e.name}`}
                        checked={isChecked(s)}
                        onChange={() =>
                          setToggled((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td style={tdStyle}>
                      {weekdayDate(t.date)} · {t.rawDescription} · <span style={{ fontFamily: "var(--mono)" }}>{t.direction === "in" ? "+" : "−"}{fmtCurrency(t.amount)}</span>
                    </td>
                    <td style={tdStyle}>
                      <b>{e.name}</b> · {weekdayDate(entryDate(e))} · <span style={{ fontFamily: "var(--mono)" }}>{signedAmount(entryAmount(e), e.kind)}</span>
                    </td>
                    <td style={tdStyle}>
                      <Tag color={s.confidence === "exact" ? "var(--positive)" : "var(--accent)"}>{s.confidence}</Tag> <span style={{ color: "var(--muted)" }}>{s.reasons.join(" · ")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px 14px" }}>
            <PrimaryButton
              disabled={selected.length === 0}
              onClick={() => run(() => confirmBankMatches(selected.map((s) => ({ bankTransactionId: s.bankTransactionId, entryId: s.entryId }))), `Matched ${selected.length}`)}
            >
              Confirm {selected.length} match{selected.length === 1 ? "" : "es"}
            </PrimaryButton>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select aria-label="Month filter" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inputStyle, padding: "6px" }}>
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {longMonthLabel(m)}
            </option>
          ))}
        </select>
        <select aria-label="Type filter" value={type} onChange={(e) => setType(e.target.value as BankTxnType | "all")} style={{ ...inputStyle, padding: "6px" }}>
          <option value="all">All types</option>
          {BANK_TXN_TYPES.map((t) => (
            <option key={t} value={t}>
              {BANK_TXN_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          Needs review only ({lines.filter((t) => t.needsReview).length})
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)" }}>
          {shown.length} of {lines.length}
        </span>
      </div>

      {lines.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13.5 }}>No bank lines yet — import a CSV export first.</div>
      ) : (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 16 }}>Date</th>
                <th style={thStyle}>Details</th>
                <th style={thStyle}>Type</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                <th style={thStyle}>Vendor / category</th>
                <th style={thStyle}>Matched to</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 500).map((t) => (
                <LineRow key={t.id} txn={t} appState={appState} run={run} entryName={t.entryId ? entryById.get(t.entryId)?.name : undefined} />
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted)" }}>Showing the first 500 — narrow it with the filters.</div>}
        </div>
      )}
    </div>
  );
}

function LineRow({ txn: t, appState, run, entryName }: { txn: BankTransaction; appState: AppState; run: (a: () => Promise<unknown>, s?: string) => Promise<void>; entryName?: string }) {
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState(appState.categories[0]?.id ?? "");
  const childById = new Map(appState.childVendors.map((c) => [c.id, c]));
  const parentById = new Map(appState.parentVendors.map((p) => [p.id, p]));
  const parent = t.childVendorId ? parentById.get(childById.get(t.childVendorId)?.parentId ?? "") : undefined;
  const categoryId = categoryIdForTransaction(t, childById, parentById);
  const category = appState.categories.find((c) => c.id === categoryId);

  return (
    <tr style={{ background: t.needsReview ? "oklch(0.58 0.13 35 / 0.05)" : undefined }}>
      <td style={{ ...tdStyle, paddingLeft: 16, whiteSpace: "nowrap" }}>{weekdayDate(t.date)}</td>
      <td style={tdStyle}>{t.rawDescription}</td>
      <td style={tdStyle}>
        <select aria-label={`Type of ${t.rawDescription}`} value={t.type} onChange={(e) => run(() => updateBankTransaction(t.id, { type: e.target.value as BankTxnType }))} style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }}>
          {BANK_TXN_TYPES.map((x) => (
            <option key={x} value={x}>
              {BANK_TXN_TYPE_LABELS[x]}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: t.direction === "in" ? "var(--positive)" : "var(--text)" }}>
        {t.direction === "in" ? "+" : "−"}
        {fmtCurrency(t.amount)}
      </td>
      <td style={tdStyle}>
        {t.type !== "purchase" ? (
          <span style={{ color: "var(--muted)" }}>—</span>
        ) : naming ? (
          <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
            <input aria-label="New vendor name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Vendor name" style={{ ...inputStyle, padding: "3px 6px", width: 120 }} />
            <select aria-label="Category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ ...inputStyle, padding: "3px" }}>
              {appState.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <SmallButton tone="accent" disabled={!newName.trim() || !newCategory} onClick={() => run(() => updateBankTransaction(t.id, { newParentName: newName.trim(), category: newCategory }), "Vendor added").then(() => setNaming(false))}>
              Save
            </SmallButton>
            <SmallButton onClick={() => setNaming(false)}>Cancel</SmallButton>
          </span>
        ) : (
          <select
            aria-label={`Vendor of ${t.rawDescription}`}
            value={parent?.id ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new") setNaming(true);
              else if (e.target.value) run(() => updateBankTransaction(t.id, { parentId: e.target.value }));
            }}
            style={{ ...inputStyle, padding: "3px 4px", fontSize: 12, maxWidth: 220 }}
          >
            <option value="">{parent ? parent.name : "Choose a vendor…"}</option>
            <option value="__new">+ New vendor…</option>
            {appState.parentVendors
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        )}
        {category && <div style={{ fontSize: 11, color: "var(--muted)" }}>{category.name}</div>}
      </td>
      <td style={tdStyle}>
        {t.entryId ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span>{entryName ?? "an entry"}</span>
            <SmallButton onClick={() => run(() => unlinkBankMatch(t.id), "Unlinked")}>Unlink</SmallButton>
          </span>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {t.needsReview && <SmallButton onClick={() => run(() => updateBankTransaction(t.id, { needsReview: false }))}>OK</SmallButton>}
          <ConfirmButton label="×" confirmLabel="Delete" title="Delete this bank line" onConfirm={() => run(() => deleteBankTransactions([t.id]), "Deleted")} />
        </span>
      </td>
    </tr>
  );
}
