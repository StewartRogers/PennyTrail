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
const PLOT_HEIGHT = 190;
const GROUP_GAP = 22;
const MIN_STEP = 30;
const MAX_STEP = 72;
const LABEL_CHARS = 22;
const HIDDEN_KEY = "pennytrail.cf.flowChartHidden";

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

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, "1");
    else window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Storage blocked: the toggle still works for this visit.
  }
}

export function MonthFlowChart({ flow }: { flow: MonthFlow }) {
  // The month view only renders after the client has fetched the state, so
  // reading storage in the initializer can't cause a hydration mismatch.
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    writeHidden(!hidden);
    setHidden(!hidden);
  };

  return (
    <section aria-label="Deposits and withdrawals" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px 18px", flexWrap: "wrap", padding: "12px 16px 8px" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Deposits &amp; withdrawals</div>
        <LegendItem color={DEPOSIT} label="Deposits" value={flow.deposits} />
        <LegendItem color={WITHDRAWAL} label="Withdrawals" value={flow.withdrawals} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          <svg width={12} height={12} aria-hidden>
            <rect width={12} height={12} rx={2} fill="var(--muted)" fillOpacity={PROJECTED_OPACITY} />
          </svg>
          Lighter = still projected
        </span>
        <button
          onClick={toggle}
          aria-expanded={!hidden}
          style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--accent)", padding: 0, fontSize: 12.5, fontWeight: 600 }}
        >
          {hidden ? "Show chart" : "Hide chart"}
        </button>
      </div>
      {!hidden &&
        (flow.columns.length === 0 ? (
          <div style={{ padding: "4px 16px 16px", fontSize: 13, color: "var(--muted)" }}>Nothing in or out this month yet.</div>
        ) : (
          <Plot columns={flow.columns} />
        ))}
    </section>
  );
}

function LegendItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      <svg width={12} height={12} aria-hidden>
        <rect width={12} height={12} rx={2} fill={color} />
      </svg>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <b style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{fmtCurrency(value)}</b>
    </span>
  );
}

function Plot({ columns }: { columns: FlowColumn[] }) {
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
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;
  const baseline = MARGIN.top + PLOT_HEIGHT;
  const top = niceMax(Math.max(...columns.map((c) => c.total)));
  const scale = (v: number) => (Math.max(0, v) / top) * PLOT_HEIGHT;
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
    <div ref={wrapRef} style={{ overflowX: "auto", padding: "0 0 8px" }}>
      <div style={{ position: "relative", width }} onMouseLeave={() => setActive(null)}>
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
                  height={PLOT_HEIGHT + 40}
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
