"use client";

import type { AppState } from "@/lib/types";
import { entriesForMonth, monthFlow, summarizeMonth } from "@/lib/cashflow";
import { addMonths } from "@/lib/dates";
import { fmtCurrency } from "@/lib/format";
import { Card, PrimaryButton } from "../ui";
import { MonthHeader } from "./CashFlowMonthView";
import { FlowList, MonthFlowChart } from "./MonthFlowChart";
import { SmallButton, longMonthLabel, todayIso, weekdayDate } from "./shared";

// Month Chart: one month at a glance, laid out like the card side's
// Dashboard and made to print — balances as tiles, the deposits and
// withdrawals chart, and the same columns listed with their amounts. It
// follows the month picked on This Month (they share the picker).
export function CashFlowChartView({
  appState,
  accountId,
  monthKey,
  onMonthKeyChange,
  onGoMonth,
}: {
  appState: AppState;
  accountId: string;
  monthKey: string;
  onMonthKeyChange: (key: string) => void;
  onGoMonth: () => void;
}) {
  const month = appState.cashFlowMonths.find((m) => m.accountId === accountId && m.month === monthKey);
  const account = appState.bankAccounts.find((a) => a.id === accountId);

  return (
    <div className="cf-chart-page">
      <MonthHeader appState={appState} accountId={accountId} monthKey={monthKey} onMonthKeyChange={onMonthKeyChange} />
      {!month ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "18px 20px", maxWidth: 560 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{longMonthLabel(monthKey)} hasn&apos;t been started</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Start it on This Month to chart it.</div>
          <PrimaryButton onClick={onGoMonth}>Go to This Month</PrimaryButton>
        </div>
      ) : (
        <StartedChart appState={appState} monthId={month.id} accountName={account?.name ?? ""} />
      )}
    </div>
  );
}

function StartedChart({ appState, monthId, accountName }: { appState: AppState; monthId: string; accountName: string }) {
  const month = appState.cashFlowMonths.find((m) => m.id === monthId)!;
  const summary = summarizeMonth(month, entriesForMonth(appState.cashFlowEntries, month.id));
  const flow = monthFlow(summary);
  const previous = appState.cashFlowMonths.find((m) => m.accountId === month.accountId && m.month === addMonths(month.month, -1));

  const tiles: { label: string; value: number; note: string; color?: string }[] = [
    {
      label: "Opening balance",
      value: flow.opening,
      note: month.openingSource === "carried" && previous ? `${longMonthLabel(previous.month)}'s close` : "entered by hand",
    },
    { label: "Deposits", value: flow.deposits, note: "money in", color: "var(--positive)" },
    { label: "Withdrawals", value: flow.withdrawals, note: "money out, incl. Weekly Spend" },
    {
      label: "Closing balance",
      value: flow.closing,
      note: flow.closingIsActual ? "recorded" : "projected",
      color: flow.closing < 0 ? "var(--attention)" : undefined,
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, fontSize: 12.5, color: "var(--muted)" }}>
        <span>
          {accountName && <>{accountName} · </>}as of {weekdayDate(todayIso())}
        </span>
        <span className="no-print" style={{ marginLeft: "auto" }}>
          <SmallButton onClick={() => window.print()} title="Print this page, or save it as a PDF">
            Print
          </SmallButton>
        </span>
      </div>

      <div className="cf-print-block" style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        {tiles.map((t) => (
          <Card key={t.label} style={{ flex: 1, minWidth: 150, padding: "18px 20px" }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>{t.label}</div>
            <div data-testid={`tile-${t.label}`} style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 600, color: t.color }}>
              {fmtCurrency(t.value)}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t.note}</div>
          </Card>
        ))}
      </div>

      <MonthFlowChart flow={flow} />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <FlowList title="Deposits" columns={flow.columns.filter((c) => c.kind === "deposit")} total={flow.deposits} />
        <FlowList title="Withdrawals" columns={flow.columns.filter((c) => c.kind === "bill")} total={flow.withdrawals} />
      </div>
    </div>
  );
}
