"use client";

import type { AppState } from "@/lib/types";
import { entriesForMonth } from "@/lib/cashflow";
import { spendingByPeriod } from "@/lib/bankSpending";
import { categoryIdForTransaction } from "@/lib/vendors";
import { fmtCurrency } from "@/lib/format";
import { PageTitle, inputStyle } from "../ui";
import { longMonthLabel, monthsForAccount, weekdayDate } from "./shared";

// Day-to-day spending from imported bank lines against each period's Weekly
// Spend estimate — and, once the checkpoint is in, the spend it implies.
export function CashFlowSpending({ appState, accountId, monthKey, onMonthKeyChange }: { appState: AppState; accountId: string; monthKey: string; onMonthKeyChange: (k: string) => void }) {
  const months = monthsForAccount(appState.cashFlowMonths, accountId);
  const month = months.find((m) => m.month === monthKey) ?? months[months.length - 1];
  const childById = new Map(appState.childVendors.map((c) => [c.id, c]));
  const parentById = new Map(appState.parentVendors.map((p) => [p.id, p]));
  const categoryById = new Map(appState.categories.map((c) => [c.id, c]));
  const hasLines = appState.bankTransactions.some((t) => t.accountId === accountId);

  if (!month) return <div><PageTitle>Spending</PageTitle><div style={{ color: "var(--muted)", fontSize: 13.5 }}>Start a month first.</div></div>;

  const periods = spendingByPeriod({
    month,
    entries: entriesForMonth(appState.cashFlowEntries, month.id),
    bankTransactions: appState.bankTransactions,
    categoryOf: (t) => categoryIdForTransaction(t, childById, parentById),
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <PageTitle>Spending</PageTitle>
        <select aria-label="Month" value={month.month} onChange={(e) => onMonthKeyChange(e.target.value)} style={{ ...inputStyle, marginLeft: "auto", padding: "6px 8px" }}>
          {[...months].reverse().map((m) => (
            <option key={m.id} value={m.month}>
              {longMonthLabel(m.month)}
            </option>
          ))}
        </select>
      </div>
      {!hasLines && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          No bank lines imported yet, so only the estimates and checkpoint-implied spend are shown. Import the account&apos;s CSV to see what was actually spent.
        </div>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {periods.map((p) => {
          const max = Math.max(p.estimate, p.spent, p.impliedSpend ?? 0, 1);
          const bar = (value: number, color: string, label: string) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: "var(--muted)" }}>{label}</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{fmtCurrency(value)}</span>
              </div>
              <div style={{ height: 8, background: "oklch(0.95 0.004 260)", borderRadius: 4 }}>
                <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: 8, background: color, borderRadius: 4 }} />
              </div>
            </div>
          );
          return (
            <div key={p.periodId} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", flex: "1 1 280px", minWidth: 260 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {weekdayDate(p.start)} – {weekdayDate(p.end)}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                {p.days} days{hasLines && !p.complete ? " · bank lines not imported through the end yet" : ""}
              </div>
              {bar(p.estimate, "oklch(0.75 0.03 260)", "Weekly Spend estimate")}
              {hasLines && bar(p.spent, "var(--accent)", `Debit spending (${p.lines} line${p.lines === 1 ? "" : "s"})`)}
              {p.impliedSpend !== undefined && bar(p.impliedSpend, "oklch(0.6 0.1 155)", "Implied by the checkpoint")}
              {p.unplannedBills > 0 && <div style={{ fontSize: 12, color: "var(--attention)", marginBottom: 8 }}>Plus {fmtCurrency(p.unplannedBills)} in bill payments with no planned entry</div>}
              {p.byCategory.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 6 }}>
                  {p.byCategory.map((c) => (
                    <div key={c.categoryId ?? "none"} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.categoryId ? (categoryById.get(c.categoryId)?.color ?? "var(--muted)") : "var(--border)" }} />
                        {c.categoryId ? (categoryById.get(c.categoryId)?.name ?? "Unknown") : "Uncategorized"}
                      </span>
                      <span style={{ fontFamily: "var(--mono)" }}>{fmtCurrency(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
