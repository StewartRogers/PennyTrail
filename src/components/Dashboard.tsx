"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction } from "@/lib/types";
import { fmtCurrency, monthKey, monthLabel, quarterKey, yearKey } from "@/lib/format";
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

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(rangePreset);
    return appState.transactions.filter((t) => {
      if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
      if (cutoff && t.date < cutoff) return false;
      return true;
    });
  }, [appState.transactions, cardFilter, rangePreset]);

  const purchases = useMemo(() => filtered.filter((t) => t.type === "purchase"), [filtered]);

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
    for (const t of purchases) {
      const key = keyFn(t.date);
      totals.set(key, (totals.get(key) || 0) + t.amount);
    }
    const keys = Array.from(totals.keys()).sort();
    const capped = keys.slice(-12);
    return capped.map((key, i) => {
      const total = totals.get(key) || 0;
      const prev = i > 0 ? totals.get(capped[i - 1]) || 0 : null;
      const delta = prev != null && prev > 0 ? ((total - prev) / prev) * 100 : null;
      return { key, label: labelFn(key), total, delta };
    });
  }, [purchases, trendGroup]);

  const maxBarTotal = Math.max(1, ...trendBuckets.map((b) => b.total));
  const chartWidth = 760;
  const chartHeight = 220;
  const barAreaTop = 20;
  const barAreaBottom = 178;
  const barAreaHeight = barAreaBottom - barAreaTop;
  const gap = 10;
  const barWidth = trendBuckets.length > 0 ? Math.min(48, (chartWidth - gap * (trendBuckets.length + 1)) / trendBuckets.length) : 0;
  const totalBarsWidth = trendBuckets.length * barWidth + (trendBuckets.length - 1) * gap;
  const startX = (chartWidth - totalBarsWidth) / 2;

  const breakdownRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of purchases) {
      const key = breakdownMode === "category" ? t.category : t.vendor;
      if (!key) continue;
      totals.set(key, (totals.get(key) || 0) + t.amount);
    }
    const rows = Array.from(totals.entries())
      .map(([key, total]) => {
        if (breakdownMode === "category") {
          const cat = categoryById.get(key);
          return { key, name: cat?.name || key, color: cat?.color || "var(--muted)", total };
        }
        const vendorTxns = purchases.filter((t) => t.vendor === key);
        const catCounts = new Map<string, number>();
        for (const t of vendorTxns) {
          if (t.category) catCounts.set(t.category, (catCounts.get(t.category) || 0) + 1);
        }
        const topCat = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1])[0];
        const color = topCat ? categoryById.get(topCat[0])?.color || "var(--muted)" : "var(--muted)";
        return { key, name: key, color, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const max = Math.max(1, ...rows.map((r) => r.total));
    return rows.map((r) => ({ ...r, widthPct: (r.total / max) * 100 }));
  }, [purchases, breakdownMode, categoryById]);

  const topMerchants = useMemo(() => {
    const byVendor = new Map<string, { total: number; count: number; categories: Map<string, number> }>();
    for (const t of purchases) {
      const entry = byVendor.get(t.vendor) || { total: 0, count: 0, categories: new Map<string, number>() };
      entry.total += t.amount;
      entry.count += 1;
      if (t.category) entry.categories.set(t.category, (entry.categories.get(t.category) || 0) + 1);
      byVendor.set(t.vendor, entry);
    }
    return Array.from(byVendor.entries())
      .map(([vendor, data]) => {
        const topCat = Array.from(data.categories.entries()).sort((a, b) => b[1] - a[1])[0];
        const catName = topCat ? categoryById.get(topCat[0])?.name || "Uncategorized" : "Uncategorized";
        return { vendor, total: data.total, count: data.count, catName };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [purchases, categoryById]);

  function purchasesFor(predicate: (t: Transaction) => boolean) {
    return purchases.filter(predicate).sort((a, b) => (a.date < b.date ? 1 : -1));
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
            const deltaColor = bar.delta == null ? "var(--muted)" : bar.delta > 0 ? "var(--attention)" : "var(--positive)";
            const deltaLabel = bar.delta == null ? "" : `${bar.delta > 0 ? "+" : ""}${bar.delta.toFixed(0)}%`;
            return (
              <g key={bar.key}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  fill="var(--accent)"
                  rx={3}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    onDrillDown({
                      title: bar.label,
                      subtitle: `${purchasesFor((t) => {
                        const keyFn = trendGroup === "month" ? monthKey : trendGroup === "quarter" ? quarterKey : yearKey;
                        return keyFn(t.date) === bar.key;
                      }).length} purchases`,
                      transactions: purchasesFor((t) => {
                        const keyFn = trendGroup === "month" ? monthKey : trendGroup === "quarter" ? quarterKey : yearKey;
                        return keyFn(t.date) === bar.key;
                      }),
                    })
                  }
                />
                <text x={x + barWidth / 2} y={200} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-sans), sans-serif">
                  {bar.label}
                </text>
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fill={deltaColor} fontFamily="var(--mono)">
                  {deltaLabel}
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
                const txns = purchasesFor((t) => (breakdownMode === "category" ? t.category === row.key : t.vendor === row.key));
                onDrillDown({
                  title: row.name,
                  subtitle: `${txns.length} purchases`,
                  transactions: txns,
                  viewAllFilter: breakdownMode === "category" ? { categoryFilter: row.key } : { search: row.key },
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
                key={m.vendor}
                onClick={() => {
                  const txns = purchasesFor((t) => t.vendor === m.vendor);
                  onDrillDown({
                    title: m.vendor,
                    subtitle: `${txns.length} purchases`,
                    transactions: txns,
                    viewAllFilter: { search: m.vendor },
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
    </div>
  );
}
