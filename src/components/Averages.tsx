"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import type { AppState } from "@/lib/types";
import { computeMonthlyAverages, type MonthlyAverageEntry, type ParentAverage } from "@/lib/aggregate";
import { fmtCurrency, monthKey, monthLabel } from "@/lib/format";
import { Card as PanelCard, ColorDot, SegmentedControl } from "./ui";
import type { DrillDown } from "./DrillDownModal";

type ViewMode = "list" | "chart";

const MONTHS_BACK = 6;

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "0 10px 8px 0",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--muted)",
  borderBottom: "1px solid var(--border)",
};

const tdStyle: CSSProperties = { padding: "10px 10px 10px 0", borderBottom: "1px solid var(--border)" };

function mixColor(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`;
}

function MiniTrendChart({ months, values, color }: { months: string[]; values: number[]; color: string }) {
  const width = 200;
  const height = 46;
  const labelHeight = 12;
  const gap = 4;
  const barAreaHeight = height - labelHeight;
  const barWidth = values.length > 0 ? (width - gap * (values.length - 1)) / values.length : 0;
  const max = Math.max(1, ...values);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", flexShrink: 0 }}>
      {values.map((v, i) => {
        const barHeight = v > 0 ? Math.max(2, (v / max) * barAreaHeight) : 0;
        const x = i * (barWidth + gap);
        const y = barAreaHeight - barHeight;
        return (
          <g key={months[i]}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill={color} rx={2}>
              <title>{`${monthLabel(months[i])}: ${fmtCurrency(v)}`}</title>
            </rect>
            <text x={x + barWidth / 2} y={height - 2} textAnchor="middle" fontSize={7.5} fill="var(--muted)" fontFamily="var(--font-sans), sans-serif">
              {monthLabel(months[i]).slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ValueCell({
  viewMode,
  months,
  values,
  avgPerMonth,
  color,
  bold,
}: {
  viewMode: ViewMode;
  months: string[];
  values: number[];
  avgPerMonth: number;
  color: string;
  bold?: boolean;
}) {
  if (viewMode === "chart") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
        <MiniTrendChart months={months} values={values} color={color} />
        <span style={{ fontFamily: "var(--mono)", fontWeight: bold ? 600 : 400, minWidth: 70, textAlign: "right" }}>{fmtCurrency(avgPerMonth)}</span>
      </div>
    );
  }
  return <span style={{ fontFamily: "var(--mono)", fontWeight: bold ? 600 : 400 }}>{fmtCurrency(avgPerMonth)}</span>;
}

export function Averages({ appState, onDrillDown }: { appState: AppState; onDrillDown: (drillDown: DrillDown) => void }) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const averages = useMemo(
    () => computeMonthlyAverages(appState.transactions, appState.categories, appState.parentVendors, appState.childVendors, MONTHS_BACK),
    [appState.transactions, appState.categories, appState.parentVendors, appState.childVendors]
  );

  const monthSet = useMemo(() => new Set(averages.months), [averages.months]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  // The leaf level (a raw-description Vendor) is the only one that drills
  // down to actual transactions — Categories and Parents just expand, since
  // "View all in Transactions" only supports filtering by Parent (see
  // TxnFilterSeed.vendorFilter), not by an individual raw description.
  function openVendorDrillDown(vendor: MonthlyAverageEntry, parent: ParentAverage, categoryName: string) {
    const txns = appState.transactions
      .filter((t) => t.type === "purchase" && monthSet.has(monthKey(t.date)) && t.childVendorId === vendor.id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    onDrillDown({
      title: vendor.name,
      subtitle: `${parent.name} · ${categoryName} · ${txns.length} purchases over the last ${MONTHS_BACK} full months`,
      transactions: txns,
      viewAllFilter: { vendorFilter: parent.id },
    });
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
          <h1 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.01em" }}>Averages</h1>
          <div style={{ color: "var(--muted)", fontSize: 13.5 }}>Last {MONTHS_BACK} full months</div>
        </div>
        <SegmentedControl
          options={[
            { value: "list", label: "List" },
            { value: "chart", label: "Chart" },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
      </div>

      <PanelCard>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={thStyle}>Category / Parent / Vendor</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{viewMode === "chart" ? `Trend (${MONTHS_BACK}mo)` : "Avg / Month"}</th>
              {viewMode === "list" && <th style={{ ...thStyle, textAlign: "right" }}>Total ({MONTHS_BACK}mo)</th>}
            </tr>
          </thead>
          <tbody>
            {averages.categories.map((cat) => {
              const catExpanded = expandedCategories.has(cat.id);
              return (
                <Fragment key={cat.id}>
                  <tr onClick={() => toggle(expandedCategories, setExpandedCategories, cat.id)} style={{ cursor: "pointer" }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 12, display: "inline-block", color: "var(--muted)", fontSize: 10 }}>{catExpanded ? "▾" : "▸"}</span>
                        <ColorDot color={cat.color} />
                        <span style={{ fontWeight: 600 }}>{cat.name}</span>
                        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                          ({cat.parents.length} parent{cat.parents.length === 1 ? "" : "s"})
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <ValueCell viewMode={viewMode} months={averages.months} values={cat.monthlyTotals} avgPerMonth={cat.avgPerMonth} color={cat.color} bold />
                    </td>
                    {viewMode === "list" && (
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: "var(--muted)" }}>{fmtCurrency(cat.total)}</td>
                    )}
                  </tr>
                  {catExpanded &&
                    cat.parents.map((parent) => {
                      const parentExpanded = expandedParents.has(parent.id);
                      return (
                        <Fragment key={parent.id}>
                          <tr onClick={() => toggle(expandedParents, setExpandedParents, parent.id)} style={{ cursor: "pointer", background: "var(--bg)" }}>
                            <td style={{ ...tdStyle, paddingLeft: 34 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 12, display: "inline-block", color: "var(--muted)", fontSize: 10 }}>
                                  {parentExpanded ? "▾" : "▸"}
                                </span>
                                <span>{parent.name}</span>
                                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                                  ({parent.vendors.length} vendor{parent.vendors.length === 1 ? "" : "s"})
                                </span>
                              </div>
                            </td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              <ValueCell
                                viewMode={viewMode}
                                months={averages.months}
                                values={parent.monthlyTotals}
                                avgPerMonth={parent.avgPerMonth}
                                color={mixColor(parent.color, 70)}
                              />
                            </td>
                            {viewMode === "list" && (
                              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: "var(--muted)" }}>{fmtCurrency(parent.total)}</td>
                            )}
                          </tr>
                          {parentExpanded &&
                            parent.vendors.map((vendor) => (
                              <tr key={vendor.id} onClick={() => openVendorDrillDown(vendor, parent, cat.name)} style={{ cursor: "pointer" }}>
                                <td style={{ ...tdStyle, paddingLeft: 58, color: "var(--muted)" }}>{vendor.name}</td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  <ValueCell
                                    viewMode={viewMode}
                                    months={averages.months}
                                    values={vendor.monthlyTotals}
                                    avgPerMonth={vendor.avgPerMonth}
                                    color={mixColor(vendor.color, 40)}
                                  />
                                </td>
                                {viewMode === "list" && (
                                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: "var(--muted)" }}>{fmtCurrency(vendor.total)}</td>
                                )}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {averages.categories.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 0" }}>No data yet.</div>}
      </PanelCard>
    </div>
  );
}
