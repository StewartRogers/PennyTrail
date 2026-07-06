"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction } from "@/lib/types";
import { fmtCurrency, fmtCurrencyWhole, monthKey, monthLabel, quarterKey, yearKey } from "@/lib/format";
import { categoryIdForTransaction, parentIdForTransaction } from "@/lib/vendors";
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
  const now = new Date();
  if (preset === "all") return null;
  if (preset === "ytd") {
    return `${now.getFullYear()}-01-01`;
  }
  const months = preset === "6mo" ? 6 : 12;
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  return cutoff.toISOString().slice(0, 10);
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

// Trailing N *complete* periods ending at the last fully-elapsed one — the
// current, still-in-progress month/quarter/year is deliberately excluded so
// it can't show up as a misleadingly short bar. Missing periods (no
// transactions at all) are zero-filled rather than silently skipped, so the
// chart is always a stable calendar window, not a function of which months
// happen to have data.
function trailingPeriodKeys(group: TrendGroup, count: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  if (group === "month") {
    for (let i = count; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  } else if (group === "quarter") {
    const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    for (let i = count; i >= 1; i--) {
      const d = new Date(now.getFullYear(), currentQuarterStartMonth - i * 3, 1);
      keys.push(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
    }
  } else {
    for (let i = count; i >= 1; i--) {
      keys.push(String(now.getFullYear() - i));
    }
  }
  return keys;
}

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
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(rangePreset);
    return appState.transactions.filter((t) => {
      if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
      if (cutoff && t.date < cutoff) return false;
      return true;
    });
  }, [appState.transactions, cardFilter, rangePreset]);

  const purchases = useMemo(() => filtered.filter((t) => t.type === "purchase"), [filtered]);

  // The trend chart always shows a fixed trailing calendar window regardless
  // of the top-of-page range preset (6mo/12mo/YTD/All) — only the card
  // filter narrows it — so switching presets can't shrink or shift it.
  const purchasesForTrend = useMemo(
    () => appState.transactions.filter((t) => t.type === "purchase" && (cardFilter === "all" || t.cardId === cardFilter)),
    [appState.transactions, cardFilter]
  );

  const kpis = useMemo(() => {
    const spend = purchases.reduce((sum, t) => sum + t.amount, 0);
    const payments = filtered.filter((t) => t.type === "payment").reduce((sum, t) => sum + t.amount, 0);
    const cashback = filtered.filter((t) => t.type === "cashback").reduce((sum, t) => sum + t.amount, 0);
    const monthsInData = new Set(purchases.map((t) => monthKey(t.date)));
    const avgMonthly = monthsInData.size > 0 ? spend / monthsInData.size : 0;
    return { spend, payments, cashback, avgMonthly };
  }, [filtered, purchases]);

  const trendBuckets = useMemo(() => {
    const keyFn = trendGroup === "month" ? monthKey : trendGroup === "quarter" ? quarterKey : yearKey;
    const labelFn = trendGroup === "month" ? monthLabel : (k: string) => k;
    const totals = new Map<string, number>();
    for (const t of purchasesForTrend) {
      const key = keyFn(t.date);
      totals.set(key, (totals.get(key) || 0) + t.amount);
    }
    const keys = trailingPeriodKeys(trendGroup, TREND_BUCKET_COUNT[trendGroup]);
    return keys.map((key) => ({ key, label: labelFn(key), total: totals.get(key) || 0 }));
  }, [purchasesForTrend, trendGroup]);

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
    for (const t of purchases) {
      const key = breakdownMode === "category" ? categoryIdForTransaction(t, childById, parentById) : parentIdForTransaction(t, childById);
      if (!key) continue;
      totals.set(key, (totals.get(key) || 0) + t.amount);
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
    return rows.map((r) => ({ ...r, widthPct: (r.total / max) * 100 }));
  }, [purchases, breakdownMode, categoryById, childById, parentById]);

  const topMerchants = useMemo(() => {
    const byParent = new Map<string, { total: number; count: number }>();
    for (const t of purchases) {
      const parentId = parentIdForTransaction(t, childById);
      if (!parentId) continue;
      const entry = byParent.get(parentId) || { total: 0, count: 0 };
      entry.total += t.amount;
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
  }, [purchases, childById, parentById, categoryById]);

  // Same trailing-12-full-months window as the trend chart's Month view —
  // dividing by a fixed 12 (not "months that had spend") so a category with
  // three $100 months and nine $0 months correctly averages to $25/mo, not $100/mo.
  const avgMonthlyByCategory = useMemo(() => {
    const months = trailingPeriodKeys("month", 12);
    const monthSet = new Set(months);
    const totals = new Map<string, number>();
    for (const t of purchasesForTrend) {
      const category = categoryIdForTransaction(t, childById, parentById);
      if (!category || !monthSet.has(monthKey(t.date))) continue;
      totals.set(category, (totals.get(category) || 0) + t.amount);
    }
    return Array.from(totals.entries())
      .map(([categoryId, total]) => {
        const cat = categoryById.get(categoryId);
        return { key: categoryId, name: cat?.name || categoryId, color: cat?.color || "var(--muted)", total, avgPerMonth: total / months.length };
      })
      .sort((a, b) => b.avgPerMonth - a.avgPerMonth);
  }, [purchasesForTrend, categoryById, childById, parentById]);

  function purchasesFor(predicate: (t: Transaction) => boolean) {
    return purchases.filter(predicate).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function trendPurchasesFor(predicate: (t: Transaction) => boolean) {
    return purchasesForTrend.filter(predicate).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

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
          { label: "Total Payments", value: fmtCurrency(kpis.payments) },
          { label: "Net Cashback Earned", value: fmtCurrency(kpis.cashback), color: "var(--positive)" },
          { label: "Avg Monthly Spend", value: fmtCurrency(kpis.avgMonthly) },
        ].map((kpi) => (
          <PanelCard key={kpi.label} style={{ flex: 1, minWidth: 180, padding: "18px 20px" }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>{kpi.label}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 600, color: kpi.color }}>
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
            const height = maxBarTotal > 0 ? (bar.total / maxBarTotal) * barAreaHeight : 0;
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
                  rx={3}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    onDrillDown({
                      title: bar.label,
                      subtitle: `${trendPurchasesFor((t) => keyFn(t.date) === bar.key).length} purchases`,
                      transactions: trendPurchasesFor((t) => keyFn(t.date) === bar.key),
                    })
                  }
                />
                <text x={x + barWidth / 2} y={200} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-sans), sans-serif">
                  {bar.label}
                </text>
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
                const txns = purchasesFor((t) =>
                  breakdownMode === "category"
                    ? categoryIdForTransaction(t, childById, parentById) === row.key
                    : parentIdForTransaction(t, childById) === row.key
                );
                onDrillDown({
                  title: row.name,
                  subtitle: `${txns.length} purchases`,
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
                  const txns = purchasesFor((t) => parentIdForTransaction(t, childById) === m.parentId);
                  onDrillDown({
                    title: m.vendor,
                    subtitle: `${txns.length} purchases`,
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

      <PanelCard style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>Avg Monthly Spend by Category</SectionTitle>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Last 12 full months</div>
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
                Total (12mo)
              </th>
            </tr>
          </thead>
          <tbody>
            {avgMonthlyByCategory.map((row) => (
              <tr
                key={row.key}
                onClick={() => {
                  const months = new Set(trailingPeriodKeys("month", 12));
                  const txns = trendPurchasesFor((t) => categoryIdForTransaction(t, childById, parentById) === row.key && months.has(monthKey(t.date)));
                  onDrillDown({
                    title: row.name,
                    subtitle: `${txns.length} purchases over the last 12 full months`,
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
    </div>
  );
}
