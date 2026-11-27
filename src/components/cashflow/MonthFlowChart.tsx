"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FlowColumn, MonthFlow } from "@/lib/cashflow";
import { fmtCurrency, fmtCurrencyShort } from "@/lib/format";

// The month's deposits and withdrawals as columns: deposits first, then
// withdrawals, each largest first. The confirmed part of a column (status
// Actual, or Weekly Spend implied by a recorded checkpoint) is solid; the
// part still projected sits on top of it, lighter.

const DEPOSIT = "var(--positive)";
const WITHDRAWAL = "var(--accent)";
const PROJECTED_OPACITY = 0.38;

const MARGIN = { left: 56, right: 12, top: 26, bottom: 96 };
const GROUP_GAP = 22;
const MIN_STEP = 30;
const MAX_STEP = 72;
const LABEL_CHARS = 22;

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  // Fine steps keep the tallest column near the top: 5,300 tops out at
  // 6,000, not 10,000.
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

// A bar with its top corners rounded and its base square on the axis.
function topRoundedBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function truncate(label: string): string {
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;
}

export function MonthFlowChart({ flow, plotHeight = 260 }: { flow: MonthFlow; plotHeight?: number }) {
  return (
    <section aria-label="Deposits and withdrawals" className="cf-print-block" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px 18px", flexWrap: "wrap", padding: "16px 20px 8px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Deposits &amp; withdrawals</div>
        <LegendItem color={DEPOSIT} label="Deposits" />
        <LegendItem color={WITHDRAWAL} label="Withdrawals" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          <svg width={12} height={12} aria-hidden>
            <rect width={12} height={12} rx={2} fill="var(--muted)" fillOpacity={PROJECTED_OPACITY} />
          </svg>
          Lighter = still projected
        </span>
      </div>
      {flow.columns.length === 0 ? (
        <div style={{ padding: "4px 20px 18px", fontSize: 13, color: "var(--muted)" }}>Nothing in or out this month yet.</div>
      ) : (
        <Plot columns={flow.columns} plotHeight={plotHeight} />
      )}
    </section>
  );
}

// The columns as a list with their amounts — the chart's table view, and
// what carries the numbers on paper, where there's no hover.
export function FlowList({ title, columns, total }: { title: string; columns: FlowColumn[]; total: number }) {
  const color = title === "Deposits" ? DEPOSIT : WITHDRAWAL;
  return (
    <section aria-label={title} className="cf-print-block" style={{ flex: 1, minWidth: 300, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {columns.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>None this month.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key}>
                <td style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <svg width={8} height={8} aria-hidden>
                      <rect width={8} height={8} rx={2} fill={color} fillOpacity={c.confirmed > 0 ? 1 : PROJECTED_OPACITY} />
                    </svg>
                    {c.label}
                    {c.count > 1 && !c.isSpend && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>×{c.count}</span>}
                  </span>
                </td>
                <td style={{ padding: "5px 0 5px 12px", borderBottom: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {projectedNote(c)}
                </td>
                <td style={{ padding: "5px 0 5px 12px", borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtCurrency(c.total)}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ padding: "8px 0 0", fontWeight: 600 }}>Total</td>
              <td style={{ padding: "8px 0 0 12px", fontFamily: "var(--mono)", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{fmtCurrency(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function projectedNote(c: FlowColumn): string {
  if (c.projected === 0) return "";
  const word = c.isSpend ? "estimated" : "projected";
  return c.confirmed === 0 ? word : `incl. ${fmtCurrency(c.projected)} ${word}`;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      <svg width={12} height={12} aria-hidden>
        <rect width={12} height={12} rx={2} fill={color} />
      </svg>
      <span style={{ color: "var(--muted)" }}>{label}</span>
    </span>
  );
}

function Plot({ columns, plotHeight }: { columns: FlowColumn[]; plotHeight: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(800);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth || 800);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const depositCount = columns.filter((c) => c.kind === "deposit").length;
  const hasBoth = depositCount > 0 && depositCount < columns.length;
  const gaps = hasBoth ? GROUP_GAP : 0;
  const step = Math.max(MIN_STEP, Math.min(MAX_STEP, (available - MARGIN.left - MARGIN.right - gaps) / columns.length));
  const barWidth = Math.min(40, Math.round(step * 0.62));
  const width = MARGIN.left + MARGIN.right + gaps + step * columns.length;
  const height = MARGIN.top + plotHeight + MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const top = niceMax(Math.max(...columns.map((c) => c.total)));
  const scale = (v: number) => (Math.max(0, v) / top) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const xOf = (i: number) => MARGIN.left + (hasBoth && i >= depositCount ? GROUP_GAP : 0) + i * step;
  const groupLabelY = MARGIN.top - 12;

  const shown = active === null ? null : columns[active];
  // Beside the column (right of it, or left near the edge), level with its top.
  const TIP_WIDTH = 220;
  let tipLeft = 0;
  let tipTop = 0;
  if (shown && active !== null) {
    const right = xOf(active) + (step + barWidth) / 2 + 6;
    tipLeft = right + TIP_WIDTH <= width ? right : Math.max(4, xOf(active) + (step - barWidth) / 2 - 6 - TIP_WIDTH);
    tipTop = Math.min(Math.max(baseline - scale(shown.total) - 10, 4), baseline - 90);
  }

  return (
    <div ref={wrapRef} className="cf-flow-plot" style={{ overflowX: "auto", padding: "0 0 8px" }}>
      <div className="cf-flow-inner" style={{ position: "relative", width }} onMouseLeave={() => setActive(null)}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={columns.map((c) => `${c.label} ${c.kind === "deposit" ? "deposit" : "withdrawal"} ${fmtCurrency(c.total)}`).join("; ")}
          style={{ display: "block", fontFamily: "var(--font-sans), sans-serif" }}
        >
          {ticks.map((t) => {
            const y = baseline - scale(t);
            return (
              <g key={t}>
                <line x1={MARGIN.left - 4} x2={width - MARGIN.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y + 3.5} textAnchor="end" fontSize={10.5} fill="var(--muted)" fontFamily="var(--mono)">
                  {t === 0 ? "$0" : fmtCurrencyShort(t)}
                </text>
              </g>
            );
          })}

          {depositCount > 0 && (
            <text x={xOf(0) + 2} y={groupLabelY} fontSize={11} fontWeight={600} fill="var(--muted)" letterSpacing="0.04em">
              DEPOSITS
            </text>
          )}
          {depositCount < columns.length && (
            <text x={xOf(depositCount) + 2} y={groupLabelY} fontSize={11} fontWeight={600} fill="var(--muted)" letterSpacing="0.04em">
              WITHDRAWALS
            </text>
          )}
          {hasBoth && (
            <line
              x1={xOf(depositCount) - GROUP_GAP / 2}
              x2={xOf(depositCount) - GROUP_GAP / 2}
              y1={MARGIN.top - 22}
              y2={baseline}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          )}

          {columns.map((c, i) => {
            const x = xOf(i) + (step - barWidth) / 2;
            const color = c.kind === "deposit" ? DEPOSIT : WITHDRAWAL;
            const confirmedH = scale(c.confirmed);
            const projectedH = c.confirmed > 0 ? scale(c.total) - confirmedH : scale(c.total);
            // A 2px surface gap separates the confirmed and projected parts.
            const gap = confirmedH > 0 && projectedH > 2 ? 2 : 0;
            const labelX = xOf(i) + step / 2 + 3;
            const labelY = baseline + 12;
            return (
              <g key={c.key} opacity={active === null || active === i ? 1 : 0.55}>
                {confirmedH > 0 && (
                  <path
                    d={projectedH > 0 ? `M${x},${baseline}V${baseline - confirmedH}H${x + barWidth}V${baseline}Z` : topRoundedBar(x, baseline - confirmedH, barWidth, confirmedH, 4)}
                    fill={color}
                  />
                )}
                {projectedH - gap > 0 && (
                  <path d={topRoundedBar(x, baseline - confirmedH - projectedH, barWidth, projectedH - gap, 4)} fill={color} fillOpacity={PROJECTED_OPACITY} />
                )}
                <text
                  x={labelX}
                  y={labelY}
                  fontSize={11}
                  fill={active === i ? "var(--text)" : "var(--muted)"}
                  textAnchor="end"
                  transform={`rotate(-40 ${labelX} ${labelY})`}
                >
                  {truncate(c.label)}
                </text>
                {/* Hit target: the whole column, taller and wider than the bar. */}
                <rect
                  data-column={c.label}
                  x={xOf(i)}
                  y={MARGIN.top}
                  width={step}
                  height={plotHeight + 40}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${c.label}: ${fmtCurrency(c.total)}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  style={{ outline: "none" }}
                />
              </g>
            );
          })}
          <line x1={MARGIN.left - 4} x2={width - MARGIN.right} y1={baseline} y2={baseline} stroke="var(--muted)" strokeWidth={1} />
        </svg>
        {shown && (
          <div
            role="tooltip"
            className="no-print"
            style={{
              position: "absolute",
              left: tipLeft,
              top: tipTop,
              width: TIP_WIDTH,
              pointerEvents: "none",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 4px 14px oklch(0.2 0.01 260 / 0.12)",
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <Tip column={shown} />
          </div>
        )}
      </div>
    </div>
  );
}

function Tip({ column: c }: { column: FlowColumn }) {
  const mixed = c.confirmed !== 0 && c.projected !== 0;
  const confirmedLabel = c.isSpend ? "From recorded balances" : "Actual";
  const projectedLabel = c.isSpend ? "Estimated" : "Projected";
  const row = (label: string, value: number) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--muted)" }}>
      <span>{label}</span>
      <span style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>{fmtCurrency(value)}</span>
    </div>
  );
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
      <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        {c.kind === "deposit" ? "+" : "−"}
        {fmtCurrency(c.total)}
      </div>
      {mixed ? (
        <>
          {row(confirmedLabel, c.confirmed)}
          {row(projectedLabel, c.projected)}
        </>
      ) : (
        <div style={{ color: "var(--muted)" }}>{c.projected !== 0 ? `All ${projectedLabel.toLowerCase()}` : `All ${confirmedLabel.toLowerCase()}`}</div>
      )}
      {c.count > 1 && (
        <div style={{ color: "var(--muted)", marginTop: 2 }}>
          {c.isSpend ? `${c.count} periods` : `${c.count} entries combined`}
        </div>
      )}
    </>
  );
}
