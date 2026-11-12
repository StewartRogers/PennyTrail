"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction } from "@/lib/types";
import { fmtCurrency, fmtCurrencyWhole, monthKey, monthLabel, quarterKey, toISODate, yearKey } from "@/lib/format";
import { categoryIdForTransaction, dashboardSpendForTransaction, isDashboardSpend, parentIdForTransaction } from "@/lib/vendors";
import { currentPeriodKey, trailingPeriodKeys } from "@/lib/aggregate";
import { addMonths, monthIndex } from "@/lib/dates";
import { bcYearMonth } from "@/lib/bcTime";
import { Card as PanelCard, SectionTitle, ColorDot, SegmentedControl, inputStyle } from "./ui";
import type { DrillDown } from "./DrillDownModal";

type RangePreset = "6mo" | "12mo" | "ytd" | "all";
type TrendGroup = "month" | "quarter" | "year";
type BreakdownMode = "category" | "vendor";

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "6mo", label: "6mo" },
  { value: "12mo", label: "12mo" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
];

const RANGE_LABELS: Record<RangePreset, string> = {
  "6mo": "Last 6 months",
  "12mo": "Last 12 months",
  ytd: "Year to date",
  all: "All time",
};

function rangeCutoff(preset: RangePreset): string | null {
  // The current year and month on BC's calendar, not the device's.
  const { year, month } = bcYearMonth();
  if (preset === "all") return null;
  if (preset === "ytd") {
    return `${year}-01-01`;
  }
  const months = preset === "6mo" ? 6 : 12;
  const cutoff = new Date(year, month - 1 - months + 1, 1);
  // toISOString() would convert this local date to UTC first, pulling the
  // cutoff back a day for anyone east of UTC.
  return toISODate(cutoff);
}

const TREND_BUCKET_COUNT: Record<TrendGroup, number> = { month: 12, quarter: 8, year: 6 };
// One distinct color per bar position (oldest → newest), cycling for
// shorter bucket counts (quarter/year).
const TREND_COLORS = [
  "oklch(0.55 0.20 25)", // Crimson Red
  "oklch(0.68 0.17 45)", // Coral Orange
  "oklch(0.80 0.15 85)", // Amber Yellow
  "oklch(0.75 0.18 130)", // Lime Green
  "oklch(0.50 0.12 145)", // Forest Green
  "oklch(0.65 0.12 195)", // Teal / Cyan
  "oklch(0.70 0.12 230)", // Sky Blue
  "oklch(0.45 0.18 265)", // Royal Blue
  "oklch(0.45 0.15 300)", // Deep Purple
  "oklch(0.55 0.22 335)", // Magenta / Fuchsia
  "oklch(0.70 0.13 10)", // Warm Rose / Pink
  "oklch(0.45 0.02 260)", // Slate Grey / Charcoal
];

export function Dashboard({
  appState,
  onDrillDown,
}: {
  appState: AppState;
  onDrillDown: (drillDown: DrillDown) => void;
}) {
  const [cardFilter, setCardFilter] = useState<string>("all");
  const [rangePreset, setRangePreset] = useState<RangePreset>("12mo");
  const [trendGroup, setTrendGroup] = useState<TrendGroup>("month");
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("category");

  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const cardById = useMemo(() => new Map(appState.cards.map((c) => [c.id, c])), [appState.cards]);
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);
  // Categories flagged "Exclude from Dashboards" drop their transactions out
  // of every Dashboard aggregate below — everywhere else (Transactions,
  // Categories) still shows them in full.
  const excludedCategoryIds = useMemo(
    () => new Set(appState.categories.filter((c) => c.excludeFromDashboard).map((c) => c.id)),
    [appState.categories]
  );

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(rangePreset);
    return appState.transactions.filter((t) => {
      if (t.excludeFromDashboard) return false;
      if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
      if (cutoff && t.date < cutoff) return false;
      const categoryId = categoryIdForTransaction(t, childById, parentById);
      if (categoryId && excludedCategoryIds.has(categoryId)) return false;
      return true;
    });
  }, [appState.transactions, cardFilter, rangePreset, childById, parentById, excludedCategoryIds]);

  // Spend is purchases less merchant refunds (dashboardSpendForTransaction):
  // a $100 purchase and its $100 refund net to $0, not $100.
  const spendTxns = useMemo(() => filtered.filter(isDashboardSpend), [filtered]);

  // Spend in a dashboard-excluded category or transaction (e.g. reimbursed
  // expenses, or a one-off outlier) still gets paid off on the card, so it
  // inflates Total Payments even though it was deliberately dropped from
  // Total Spend. Netting this back out keeps the two KPIs comparable —
  // Payments then reflects only what came out of the cardholder's own
  // pocket, same as Spend does.
  const excludedSpend = useMemo(() => {
    const cutoff = rangeCutoff(rangePreset);
    return appState.transactions
      .filter((t) => {
        if (!isDashboardSpend(t)) return false;
        if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
        if (cutoff && t.date < cutoff) return false;
        if (t.excludeFromDashboard) return true;
        const categoryId = categoryIdForTransaction(t, childById, parentById);
        return categoryId ? excludedCategoryIds.has(categoryId) : false;
      })
      .reduce((sum, t) => sum + dashboardSpendForTransaction(t), 0);
  }, [appState.transactions, cardFilter, rangePreset, childById, parentById, excludedCategoryIds]);

  // The trend chart always shows a fixed trailing calendar window regardless
  // of the top-of-page range preset (6mo/12mo/YTD/All) — only the card
  // filter narrows it — so switching presets can't shrink or shift it.
  const spendForTrend = useMemo(
    () =>
      appState.transactions.filter((t) => {
        if (!isDashboardSpend(t) || t.excludeFromDashboard || (cardFilter !== "all" && t.cardId !== cardFilter)) return false;
        const categoryId = categoryIdForTransaction(t, childById, parentById);
        return !(categoryId && excludedCategoryIds.has(categoryId));
      }),
    [appState.transactions, cardFilter, childById, parentById, excludedCategoryIds]
  );

  // The first month the selected card(s) have any history at all. Months
  // before it aren't $0 months — they're months nobody imported — so the
  // averages below never divide by them.
  const firstDataMonth = useMemo(() => {
    let earliest: string | null = null;
    for (const t of appState.transactions) {
      if (cardFilter !== "all" && t.cardId !== cardFilter) continue;
      if (earliest === null || t.date < earliest) earliest = t.date;
    }
    return earliest ? monthKey(earliest) : null;
  }, [appState.transactions, cardFilter]);

  const lastFullMonth = addMonths(currentPeriodKey("month"), -1);

  const kpis = useMemo(() => {
    const spend = spendTxns.reduce((sum, t) => sum + dashboardSpendForTransaction(t), 0);
    const rawPayments = filtered.filter((t) => t.type === "payment").reduce((sum, t) => sum + t.amount, 0);
    const payments = Math.max(0, rawPayments - excludedSpend);
    const cashback = filtered.filter((t) => t.type === "cashback").reduce((sum, t) => sum + t.amount, 0);
    // Full months only: the in-progress month would count as a whole month
    // while holding only part of one, dragging the average down. The window
    // runs from the range start (or the first month with history, if later)
    // to the last full month; null when that holds no full month yet.
    const cutoff = rangeCutoff(rangePreset);
    const cutoffMonth = cutoff ? monthKey(cutoff) : null;
    const firstMonth = firstDataMonth && cutoffMonth && cutoffMonth > firstDataMonth ? cutoffMonth : firstDataMonth;
    let avgMonthly: number | null = null;
    let avgMonthCount = 0;
    if (firstMonth && firstMonth <= lastFullMonth) {
      avgMonthCount = monthIndex(lastFullMonth) - monthIndex(firstMonth) + 1;
      const fullMonthSpend = spendTxns
        .filter((t) => monthKey(t.date) <= lastFullMonth)
        .reduce((sum, t) => sum + dashboardSpendForTransaction(t), 0);
      avgMonthly = fullMonthSpend / avgMonthCount;
    }
    return { spend, payments, cashback, avgMonthly, avgMonthCount };
  }, [filtered, spendTxns, excludedSpend, rangePreset, firstDataMonth, lastFullMonth]);

  // The last N-1 complete periods plus the current one, drawn as a lighter
  // "to date" bar so this month's spend is visible without passing for a
  // finished month.
  const trendBuckets = useMemo(() => {
    const keyFn = trendGroup === "month" ? monthKey : trendGroup === "quarter" ? quarterKey : yearKey;
    const labelFn = trendGroup === "month" ? monthLabel : (k: string) => k;
    const totals = new Map<string, number>();
    for (const t of spendForTrend) {
      const key = keyFn(t.date);
      totals.set(key, (totals.get(key) || 0) + dashboardSpendForTransaction(t));
    }
    const current = currentPeriodKey(trendGroup);
    const keys = [...trailingPeriodKeys(trendGroup, TREND_BUCKET_COUNT[trendGroup] - 1), current];
    return keys.map((key) => ({ key, label: labelFn(key), total: totals.get(key) || 0, partial: key === current }));
  }, [spendForTrend, trendGroup]);

  const maxBarTotal = Math.max(1, ...trendBuckets.map((b) => b.total));
  const chartWidth = 760;
  const chartHeight = 220;
  const barAreaTop = 28;
  const barAreaBottom = 178;
  const barAreaHeight = barAreaBottom - barAreaTop;
  const gap = 10;
  const barWidth = trendBuckets.length > 0 ? Math.min(48, (chartWidth - gap * (trendBuckets.length + 1)) / trendBuckets.length) : 0;
  const totalBarsWidth = trendBuckets.length * barWidth + (trendBuckets.length - 1) * gap;
  const startX = (chartWidth - totalBarsWidth) / 2;

  const breakdownRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of spendTxns) {
      const key = breakdownMode === "category" ? categoryIdForTransaction(t, childById, parentById) : parentIdForTransaction(t, childById);
      if (!key) continue;
      totals.set(key, (totals.get(key) || 0) + dashboardSpendForTransaction(t));
    }
    const rows = Array.from(totals.entries())
      .map(([key, total]) => {
        if (breakdownMode === "category") {
          const cat = categoryById.get(key);
          return { key, name: cat?.name || key, color: cat?.color || "var(--muted)", total };
        }
        // Category lives directly on the parent now — no majority-vote needed.
        const parent = parentById.get(key);
        const color = parent ? categoryById.get(parent.category)?.color || "var(--muted)" : "var(--muted)";
        return { key, name: parent?.name || key, color, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const max = Math.max(1, ...rows.map((r) => r.total));
    // A refund of a purchase from before the range can leave a row negative.
    return rows.map((r) => ({ ...r, widthPct: (Math.max(0, r.total) / max) * 100 }));
  }, [spendTxns, breakdownMode, categoryById, childById, parentById]);

  const topMerchants = useMemo(() => {
    const byParent = new Map<string, { total: number; count: number }>();
    for (const t of spendTxns) {
      const parentId = parentIdForTransaction(t, childById);
      if (!parentId) continue;
      const entry = byParent.get(parentId) || { total: 0, count: 0 };
      entry.total += dashboardSpendForTransaction(t);
      entry.count += 1;
      byParent.set(parentId, entry);
    }
    return Array.from(byParent.entries())
      .map(([parentId, data]) => {
        const parent = parentById.get(parentId);
        const catName = parent ? categoryById.get(parent.category)?.name || "Uncategorized" : "Uncategorized";
        return { parentId, vendor: parent?.name || parentId, total: data.total, count: data.count, catName };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [spendTxns, childById, parentById, categoryById]);

  // Same window/filters as everything else on the page (respects both the
  // card filter and the range preset above) — picking a single card up top
  // just degrades this to a one-row breakdown, same as Breakdown/Top
  // Merchants do in that case.
  const spendingByCard = useMemo(() => {
    const byCard = new Map<string, { total: number; count: number }>();
    for (const t of spendTxns) {
      const entry = byCard.get(t.cardId) || { total: 0, count: 0 };
      entry.total += dashboardSpendForTransaction(t);
      entry.count += 1;
      byCard.set(t.cardId, entry);
    }
    return Array.from(byCard.entries())
      .map(([cardId, data]) => {
        const card = cardById.get(cardId);
        return { cardId, name: card?.name || cardId, bank: card?.bank || "—", total: data.total, count: data.count };
      })
      .sort((a, b) => b.total - a.total);
  }, [spendTxns, cardById]);

  // Up to the trailing 6 full months, but never reaching back before the
  // first month with any history. Within that window every month counts,
  // spend or not — a category with two $100 months and four $0 months
  // averages ~$33/mo, not $100/mo — but months before the history starts
  // aren't $0 months, they're months that were never imported.
  const avgMonths = useMemo(
    () => (firstDataMonth ? trailingPeriodKeys("month", 6).filter((m) => m >= firstDataMonth) : []),
    [firstDataMonth]
  );

  const avgMonthlyByCategory = useMemo(() => {
    const monthSet = new Set(avgMonths);
    const totals = new Map<string, number>();
    for (const t of spendForTrend) {
      const category = categoryIdForTransaction(t, childById, parentById);
      if (!category || !monthSet.has(monthKey(t.date))) continue;
      totals.set(category, (totals.get(category) || 0) + dashboardSpendForTransaction(t));
    }
    return Array.from(totals.entries())
      .map(([categoryId, total]) => {
        const cat = categoryById.get(categoryId);
        return { key: categoryId, name: cat?.name || categoryId, color: cat?.color || "var(--muted)", total, avgPerMonth: total / avgMonths.length };
      })
      .sort((a, b) => b.avgPerMonth - a.avgPerMonth);
  }, [spendForTrend, avgMonths, categoryById, childById, parentById]);

  const newestFirst = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  function spendFor(predicate: (t: Transaction) => boolean) {
    return spendTxns.filter(predicate).sort(newestFirst);
  }

  function trendSpendFor(predicate: (t: Transaction) => boolean) {
    return spendForTrend.filter(predicate).sort(newestFirst);
  }

  // "3 purchases", or "3 purchases, 1 refund" once refunds are in the list.
  function countLabel(txns: Transaction[]): string {
    const refunds = txns.filter((t) => t.type === "credit").length;
    const purchases = txns.length - refunds;
    const base = `${purchases} purchase${purchases === 1 ? "" : "s"}`;
    return refunds ? `${base}, ${refunds} refund${refunds === 1 ? "" : "s"}` : base;
  }

  const avgWindowLabel = avgMonths.length === 1 ? "Last full month" : `Last ${avgMonths.length} full months`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 22,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.01em" }}>Dashboard</h1>
          <div style={{ color: "var(--muted)", fontSize: 13.5 }}>{RANGE_LABELS[rangePreset]}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)} style={inputStyle}>
            <option value="all">All Cards</option>
            {appState.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <SegmentedControl options={RANGE_OPTIONS} value={rangePreset} onChange={setRangePreset} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total Spend", value: fmtCurrency(kpis.spend) },
          {
            label: "Total Payments",
            value: fmtCurrency(kpis.payments),
            title:
              excludedSpend > 0
                ? `Excludes ${fmtCurrency(excludedSpend)} paid toward dashboard-excluded categories (e.g. reimbursed expenses)`
                : undefined,
          },
          { label: "Net Cashback Earned", value: fmtCurrency(kpis.cashback), color: "var(--positive)" },
          {
            label: "Avg Monthly Spend",
            value: kpis.avgMonthly === null ? "—" : fmtCurrency(kpis.avgMonthly),
            title:
              kpis.avgMonthly === null
                ? "Needs at least one full month of history in this range"
                : `Average over ${kpis.avgMonthCount} full month${kpis.avgMonthCount === 1 ? "" : "s"}; the current month is left out until it ends`,
          },
        ].map((kpi) => (
          <PanelCard key={kpi.label} style={{ flex: 1, minWidth: 180, padding: "18px 20px" }}>
            <div title={kpi.title} style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
              {kpi.label}
            </div>
            <div title={kpi.title} style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 600, color: kpi.color }}>
              {kpi.value}
            </div>
          </PanelCard>
        ))}
      </div>

      <PanelCard style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>Spending Trend</SectionTitle>
          <SegmentedControl
            options={[
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
            value={trendGroup}
            onChange={setTrendGroup}
          />
        </div>
        <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {trendBuckets.map((bar, i) => {
            const x = startX + i * (barWidth + gap);
            // A period whose refunds outweigh its purchases draws no bar
            // rather than a negative-height one.
            const height = (Math.max(0, bar.total) / maxBarTotal) * barAreaHeight;
            const y = barAreaBottom - height;
            const keyFn = trendGroup === "month" ? monthKey : trendGroup === "quarter" ? quarterKey : yearKey;
            return (
              <g key={bar.key}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  fill={TREND_COLORS[i % TREND_COLORS.length]}
                  fillOpacity={bar.partial ? 0.4 : 1}
                  rx={3}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    const txns = trendSpendFor((t) => keyFn(t.date) === bar.key);
                    onDrillDown({
                      title: bar.partial ? `${bar.label} (to date)` : bar.label,
                      subtitle: countLabel(txns),
                      transactions: txns,
                    });
                  }}
                />
                <text x={x + barWidth / 2} y={200} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-sans), sans-serif">
                  {bar.label}
                </text>
                {bar.partial && (
                  <text x={x + barWidth / 2} y={213} textAnchor="middle" fontSize={9.5} fill="var(--muted)" fontFamily="var(--font-sans), sans-serif">
                    to date
                  </text>
                )}
                <text x={x + barWidth / 2} y={20} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text)" fontFamily="var(--mono)">
                  {fmtCurrencyWhole(bar.total)}
                </text>
              </g>
            );
          })}
        </svg>
      </PanelCard>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <PanelCard style={{ flex: 1, minWidth: 320 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <SectionTitle>Breakdown</SectionTitle>
            <SegmentedControl
              options={[
                { value: "category", label: "Category" },
                { value: "vendor", label: "Vendor" },
              ]}
              value={breakdownMode}
              onChange={setBreakdownMode}
            />
          </div>
          {breakdownRows.map((row) => (
            <div
              key={row.key}
              onClick={() => {
                const txns = spendFor((t) =>
                  breakdownMode === "category"
                    ? categoryIdForTransaction(t, childById, parentById) === row.key
                    : parentIdForTransaction(t, childById) === row.key
                );
                onDrillDown({
                  title: row.name,
                  subtitle: countLabel(txns),
                  transactions: txns,
                  viewAllFilter: breakdownMode === "category" ? { categoryFilter: row.key } : { vendorFilter: row.key },
                });
              }}
              style={{ cursor: "pointer", padding: "9px 0", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <ColorDot color={row.color} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600, flexShrink: 0, paddingLeft: 10 }}>
                  {fmtCurrency(row.total)}
                </div>
              </div>
              <div style={{ height: 5, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${row.widthPct}%`, background: row.color }} />
              </div>
            </div>
          ))}
          {breakdownRows.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 0" }}>No data yet.</div>}
        </PanelCard>

        <PanelCard style={{ flex: 1, minWidth: 320 }}>
          <SectionTitle>Top Merchants</SectionTitle>
          <div style={{ marginTop: 14 }}>
            {topMerchants.map((m, i) => (
              <div
                key={m.parentId}
                onClick={() => {
                  const txns = spendFor((t) => parentIdForTransaction(t, childById) === m.parentId);
                  onDrillDown({
                    title: m.vendor,
                    subtitle: countLabel(txns),
                    transactions: txns,
                    viewAllFilter: { vendorFilter: m.parentId },
                  });
                }}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)", width: 16 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.vendor}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {m.catName} · {m.count} txns
                  </div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13.5 }}>{fmtCurrency(m.total)}</div>
              </div>
            ))}
            {topMerchants.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No data yet.</div>}
          </div>
        </PanelCard>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <PanelCard style={{ flex: 1, minWidth: 380 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <SectionTitle>Avg Monthly Spend by Category</SectionTitle>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{avgWindowLabel}</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0 10px 8px 0", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  Category
                </th>
                <th style={{ textAlign: "right", padding: "0 0 8px 10px", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  Avg / Month
                </th>
                <th style={{ textAlign: "right", padding: "0 0 8px 10px", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  Total ({avgMonths.length}mo)
                </th>
              </tr>
            </thead>
            <tbody>
              {avgMonthlyByCategory.map((row) => (
                <tr
                  key={row.key}
                  onClick={() => {
                    const months = new Set(avgMonths);
                    const txns = trendSpendFor((t) => categoryIdForTransaction(t, childById, parentById) === row.key && months.has(monthKey(t.date)));
                    onDrillDown({
                      title: row.name,
                      subtitle: `${countLabel(txns)} over the ${avgWindowLabel.toLowerCase()}`,
                      transactions: txns,
                      viewAllFilter: { categoryFilter: row.key },
                    });
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ColorDot color={row.color} />
                      {row.name}
                    </div>
                  </td>
                  <td style={{ padding: "9px 0 9px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                    {fmtCurrency(row.avgPerMonth)}
                  </td>
                  <td style={{ padding: "9px 0 9px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--mono)", color: "var(--muted)" }}>
                    {fmtCurrency(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {avgMonthlyByCategory.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 0" }}>No data yet.</div>}
        </PanelCard>

        <PanelCard style={{ flex: 1, minWidth: 320 }}>
          <SectionTitle>Spending by Card</SectionTitle>
          <div style={{ marginTop: 14 }}>
            {spendingByCard.map((row, i) => (
              <div
                key={row.cardId}
                onClick={() => {
                  const txns = spendFor((t) => t.cardId === row.cardId);
                  onDrillDown({
                    title: row.name,
                    subtitle: countLabel(txns),
                    transactions: txns,
                    viewAllFilter: { cardFilter: row.cardId },
                  });
                }}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)", width: 16 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {row.bank} · {row.count} txns
                  </div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13.5 }}>{fmtCurrency(row.total)}</div>
              </div>
            ))}
            {spendingByCard.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No data yet.</div>}
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
