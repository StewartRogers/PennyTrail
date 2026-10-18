"use client";

import { useMemo, useState } from "react";
import type { AppState, CashFlowEntry, CashFlowMonth, EntryStatus } from "@/lib/types";
import {
  addCashFlowEntry,
  deleteCashFlowEntry,
  deleteCashFlowMonth,
  startCashFlowMonth,
  updateCashFlowEntry,
  updateCashFlowMonth,
} from "@/lib/api";
import { entriesForMonth, entryDate, isOverdue, summarizeMonth, type EntryRow, type PeriodSummary } from "@/lib/cashflow";
import { suggestCheckpointBalances, type CheckpointSuggestion } from "@/lib/bankMatching";
import { addMonths } from "@/lib/dates";
import { isValidIsoDate } from "@/lib/request";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, inputStyle, labelStyle } from "../ui";
import {
  ConfirmButton,
  MoneyCell,
  SETTLEMENT_LABELS,
  STATUS_LABELS,
  SmallButton,
  StatTile,
  Tag,
  TextCell,
  errorMessage,
  longMonthLabel,
  monthsForAccount,
  parseMoneyInput,
  shortDate,
  signedAmount,
  statusColor,
  tdStyle,
  thStyle,
  todayIso,
  weekdayDate,
} from "./shared";

type Run = (action: () => Promise<unknown>, success?: string) => Promise<void>;

function useRun(onReload: () => Promise<void>): Run {
  const pushToast = useToast();
  return async (action, success) => {
    try {
      await action();
      await onReload();
      if (success) pushToast(success);
    } catch (err) {
      pushToast(errorMessage(err, "Something went wrong"));
      throw err;
    }
  };
}

export function CashFlowMonthView({
  appState,
  onReload,
  accountId,
  monthKey,
  onMonthKeyChange,
  onGoHistory,
}: {
  appState: AppState;
  onReload: () => Promise<void>;
  accountId: string;
  monthKey: string;
  onMonthKeyChange: (key: string) => void;
  onGoHistory: () => void;
}) {
  const run = useRun(onReload);
  const account = appState.bankAccounts.find((a) => a.id === accountId)!;
  const months = monthsForAccount(appState.cashFlowMonths, accountId);
  const month = months.find((m) => m.month === monthKey);
  const today = todayIso();

  const pickerKeys = useMemo(() => {
    const keys = new Set(months.map((m) => m.month));
    keys.add(monthKey);
    const latest = months[months.length - 1]?.month;
    if (latest) keys.add(addMonths(latest, 1));
    return [...keys].sort().reverse();
  }, [months, monthKey]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <PageTitle>{longMonthLabel(monthKey)}</PageTitle>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
          <SmallButton onClick={() => onMonthKeyChange(addMonths(monthKey, -1))} title="Previous month">‹</SmallButton>
          <select aria-label="Month" value={monthKey} onChange={(e) => onMonthKeyChange(e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }}>
            {pickerKeys.map((k) => (
              <option key={k} value={k}>
                {longMonthLabel(k)}
                {months.some((m) => m.month === k) ? "" : " (not started)"}
              </option>
            ))}
          </select>
          <SmallButton onClick={() => onMonthKeyChange(addMonths(monthKey, 1))} title="Next month">›</SmallButton>
        </div>
      </div>

      {month ? (
        <StartedMonth appState={appState} month={month} run={run} today={today} threshold={account.lowBalanceThreshold ?? 0} />
      ) : (
        <StartMonthPanel appState={appState} accountId={accountId} monthKey={monthKey} run={run} hasAnyMonth={months.length > 0} onGoHistory={onGoHistory} />
      )}
    </div>
  );
}

function StartMonthPanel({
  appState,
  accountId,
  monthKey,
  run,
  hasAnyMonth,
  onGoHistory,
}: {
  appState: AppState;
  accountId: string;
  monthKey: string;
  run: Run;
  hasAnyMonth: boolean;
  onGoHistory: () => void;
}) {
  const previous = appState.cashFlowMonths.find((m) => m.accountId === accountId && m.month === addMonths(monthKey, -1));
  const carried = previous ? summarizeMonth(previous, entriesForMonth(appState.cashFlowEntries, previous.id)).closingBalance : null;
  const [opening, setOpening] = useState("");
  const itemCount = appState.cashFlowItems.filter((i) => i.accountId === accountId && i.active).length;
  const parsed = opening.trim() ? parseMoneyInput(opening) : null;
  const canStart = carried !== null || parsed !== null;

  async function start() {
    await run(
      () => startCashFlowMonth({ accountId, month: monthKey, ...(parsed !== null ? { openingBalance: parsed } : {}) }),
      `Started ${longMonthLabel(monthKey)}`
    ).catch(() => {});
  }

  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "18px 20px", maxWidth: 560 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{longMonthLabel(monthKey)} hasn&apos;t been started</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
        Starting it adds {itemCount} recurring item{itemCount === 1 ? "" : "s"} on their business-day dates, with checkpoints on the first Friday, second Friday,
        and month end.
        {!hasAnyMonth && (
          <>
            {" "}Have a spreadsheet history?{" "}
            <button onClick={onGoHistory} style={{ border: "none", background: "none", color: "var(--accent)", padding: 0, fontSize: 13, textDecoration: "underline" }}>
              Import it from History
            </button>
            .
          </>
        )}
      </div>
      <div style={labelStyle}>Opening balance</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          aria-label="Opening balance"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          placeholder={carried !== null ? carried.toFixed(2) : "0.00"}
          inputMode="decimal"
          style={{ ...inputStyle, width: 140, fontFamily: "var(--mono)" }}
        />
        <PrimaryButton onClick={start} disabled={!canStart}>
          Start {longMonthLabel(monthKey)}
        </PrimaryButton>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        {carried !== null
          ? `Leave blank to carry ${fmtCurrency(carried)} from ${longMonthLabel(previous!.month)}'s close.`
          : "There's no previous month to carry from, so enter the account's balance at the start of the month."}
      </div>
    </div>
  );
}

function StartedMonth({ appState, month, run, today, threshold }: { appState: AppState; month: CashFlowMonth; run: Run; today: string; threshold: number }) {
  const entries = entriesForMonth(appState.cashFlowEntries, month.id);
  const summary = summarizeMonth(month, entries);
  const suggestions = new Map(
    suggestCheckpointBalances({ month, months: appState.cashFlowMonths, bankTransactions: appState.bankTransactions }).map((s) => [s.periodId, s])
  );
  const previousExists = appState.cashFlowMonths.some((m) => m.accountId === month.accountId && m.month === addMonths(month.month, -1));
  const [newCheckpoint, setNewCheckpoint] = useState("");
  const low = summary.lowPoint;
  const lowWarn = low !== null && low.balance < threshold;
  const overdue = entries.filter((e) => isOverdue(e, today)).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", flex: "1 1 170px", minWidth: 160 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Opening balance</div>
          <MoneyCell
            ariaLabel="Opening balance"
            value={month.openingBalance}
            allowNegative
            onCommit={(v) => run(() => updateCashFlowMonth(month.id, { openingBalance: v ?? 0 }))}
            style={{ fontSize: 19, fontWeight: 600, textAlign: "left", padding: "0 4px" }}
          />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
            {month.openingSource === "carried" ? "Carried from last month" : "Entered by hand"}
            {month.openingSource === "manual" && previousExists && (
              <button
                onClick={() => run(() => updateCashFlowMonth(month.id, { openingSource: "carried" }), "Opening now carries from last month").catch(() => {})}
                style={{ border: "none", background: "none", color: "var(--accent)", padding: 0, fontSize: 11.5, textDecoration: "underline" }}
              >
                carry instead
              </button>
            )}
          </div>
        </div>
        <StatTile
          label={summary.closingIsActual ? "Closing balance" : "Projected month end"}
          value={fmtCurrency(summary.closingBalance)}
          sub={summary.closingIsActual ? "Recorded at the last checkpoint" : `Deposits ${fmtCurrency(summary.deposits)} · bills ${fmtCurrency(summary.bills)}`}
        />
        <StatTile
          label="Lowest balance ahead"
          value={low ? fmtCurrency(low.balance) : "—"}
          sub={low ? `${weekdayDate(low.date)}${lowWarn ? ` · below ${fmtCurrency(threshold)}` : ""}` : "Every checkpoint is recorded"}
          color={lowWarn ? "var(--attention)" : undefined}
          title="The lowest projected balance from the next unrecorded checkpoint onward. Weekly Spend is taken at the start of each period, and a deposit with an uncertain date is assumed to arrive at the end."
        />
        <StatTile
          label="Unpaid bills"
          value={String(summary.outstandingBills.count)}
          sub={`${fmtCurrency(summary.outstandingBills.total)}${overdue ? ` · ${overdue} overdue` : ""}`}
          color={overdue ? "var(--attention)" : undefined}
        />
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", flex: "0 1 150px", minWidth: 130 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Daily spend rate</div>
          <MoneyCell
            ariaLabel="Daily spend rate"
            value={month.dailySpendRate}
            onCommit={(v) => run(() => updateCashFlowMonth(month.id, { dailySpendRate: v ?? 0 }))}
            style={{ fontSize: 19, fontWeight: 600, textAlign: "left", padding: "0 4px" }}
          />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>× days = Weekly Spend</div>
        </div>
      </div>

      {summary.periods.map((p) => (
        <PeriodBlock
          key={p.period.id}
          month={month}
          period={p}
          isLast={p.index === summary.periods.length - 1}
          canRemove={summary.periods.length > 1}
          suggestion={suggestions.get(p.period.id)}
          run={run}
          today={today}
        />
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        <SmallButton onClick={() => run(() => updateCashFlowMonth(month.id, { regenerate: true }), "Checked recurring items").catch(() => {})} title="Adds any recurring item created since this month was started; existing entries are left alone">
          Add new recurring items
        </SmallButton>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input aria-label="New checkpoint date" type="date" value={newCheckpoint} min={`${month.month}-01`} max={`${month.month}-31`} onChange={(e) => setNewCheckpoint(e.target.value)} style={{ ...inputStyle, padding: "4px 6px" }} />
          <SmallButton
            disabled={!isValidIsoDate(newCheckpoint)}
            onClick={() => run(() => updateCashFlowMonth(month.id, { addPeriod: { endDate: newCheckpoint } }), "Checkpoint added").then(() => setNewCheckpoint("")).catch(() => {})}
          >
            Add checkpoint
          </SmallButton>
        </span>
        <SmallButton onClick={() => run(() => updateCashFlowMonth(month.id, { closed: !month.closed }), month.closed ? "Month reopened" : "Month marked closed").catch(() => {})}>
          {month.closed ? "Reopen month" : "Mark month closed"}
        </SmallButton>
        {month.closed && <Tag color="var(--positive)">Closed</Tag>}
        {month.importedFrom && <Tag title="Imported from the spreadsheet">From sheet “{month.importedFrom}”</Tag>}
        <span style={{ marginLeft: "auto" }}>
          <ConfirmButton label="Delete month" confirmLabel={`Delete ${longMonthLabel(month.month)} and its entries`} onConfirm={() => run(() => deleteCashFlowMonth(month.id), "Month deleted").catch(() => {})} />
        </span>
      </div>
    </div>
  );
}

function PeriodBlock({
  month,
  period: p,
  isLast,
  canRemove,
  suggestion,
  run,
  today,
}: {
  month: CashFlowMonth;
  period: PeriodSummary;
  isLast: boolean;
  canRemove: boolean;
  suggestion: CheckpointSuggestion | undefined;
  run: Run;
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const spendFromRate = Math.round(month.dailySpendRate * 100 * p.days) / 100;
  const label = isLast ? "END OF MONTH" : "END OF WEEK";

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 6px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {weekdayDate(p.start)} – {weekdayDate(p.end)}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {p.days} day{p.days === 1 ? "" : "s"}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, paddingLeft: 16 }}>Item</th>
            <th style={thStyle}>Date</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Expected</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Actual</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Scheduled</th>
            <th style={thStyle}>Confirmation #</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Balance</th>
            <th style={{ ...thStyle, width: 1 }} />
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "oklch(0.97 0.004 260)" }}>
            <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 600 }}>Weekly Spend</td>
            <td style={{ ...tdStyle, color: "var(--muted)", fontSize: 12 }}>{shortDate(p.start)}</td>
            <td style={{ ...tdStyle, width: 120 }}>
              <MoneyCell
                ariaLabel={`Weekly Spend for the period ending ${p.end}`}
                value={p.period.spendOverride}
                allowEmpty
                placeholder={spendFromRate.toFixed(2)}
                onCommit={(v) => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, spendOverride: v }] }))}
              />
            </td>
            <td style={tdStyle} />
            <td colSpan={3} style={{ ...tdStyle, color: "var(--muted)", fontSize: 12 }}>
              {p.period.spendOverride === undefined ? `${fmtCurrency(month.dailySpendRate)}/day × ${p.days}` : "Set by hand — clear it to use the daily rate"}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(p.opening - p.spend)}</td>
            <td style={tdStyle} />
          </tr>
          {p.rows.map((row) => (
            <EntryRowView key={row.entry.id} row={row} run={run} today={today} />
          ))}
          {adding && <AddEntryRow month={month} defaultDate={p.end} run={run} onDone={() => setAdding(false)} />}
          <tr style={{ background: "oklch(0.97 0.004 260)" }}>
            <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 700, letterSpacing: "0.02em" }}>{label}</td>
            <td style={tdStyle}>
              <input
                type="date"
                aria-label={`Checkpoint date for ${label.toLowerCase()}`}
                value={p.end}
                min={`${month.month}-01`}
                max={`${month.month}-31`}
                onChange={(e) => {
                  if (isValidIsoDate(e.target.value) && e.target.value !== p.end) {
                    run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, endDate: e.target.value }] })).catch(() => {});
                  }
                }}
                style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }}
              />
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
              Projected
              <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)" }}>{fmtCurrency(p.projected)}</div>
            </td>
            <td style={{ ...tdStyle, width: 130 }}>
              <MoneyCell
                ariaLabel={`Actual balance at ${p.end}`}
                value={p.actual}
                allowEmpty
                allowNegative
                placeholder="Actual"
                onCommit={(v) => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, actualBalance: v }] }), v === null ? "Checkpoint cleared" : "Checkpoint recorded")}
                style={{ border: "1px solid var(--border)", background: "var(--panel)", fontWeight: 600 }}
              />
            </td>
            <td colSpan={3} style={{ ...tdStyle, fontSize: 12 }}>
              {p.variance !== undefined ? (
                <span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: p.variance < 0 ? "var(--attention)" : "var(--positive)" }}>
                    {p.variance >= 0 ? "+" : ""}
                    {fmtCurrency(p.variance)}
                  </span>{" "}
                  vs projected · spent about <span style={{ fontFamily: "var(--mono)" }}>{fmtCurrency(p.impliedSpend)}</span>
                  {p.impliedDailySpend !== undefined && <span style={{ color: "var(--muted)" }}> ({fmtCurrency(p.impliedDailySpend)}/day)</span>}
                </span>
              ) : suggestion ? (
                <span>
                  Bank lines put it at <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{fmtCurrency(suggestion.balance)}</span>{" "}
                  <SmallButton
                    title={`${fmtCurrency(suggestion.basedOn.balance)} on ${shortDate(suggestion.basedOn.date)} plus ${suggestion.lines} imported line${suggestion.lines === 1 ? "" : "s"} — check it against your banking app`}
                    onClick={() => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, actualBalance: suggestion.balance }] }), "Checkpoint recorded").catch(() => {})}
                  >
                    Use it
                  </SmallButton>
                </span>
              ) : (
                <span style={{ color: "var(--muted)" }}>Enter the real balance on {shortDate(p.end)}</span>
              )}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{fmtCurrency(p.actual ?? p.projected)}</td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              {canRemove && (
                <ConfirmButton label="×" confirmLabel="Remove checkpoint" title="Remove this checkpoint" onConfirm={() => run(() => updateCashFlowMonth(month.id, { removePeriodId: p.period.id }), "Checkpoint removed").catch(() => {})} />
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding: "8px 16px 12px" }}>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, padding: 0 }}>
            + Add an item to this period
          </button>
        )}
      </div>
    </div>
  );
}

function EntryRowView({ row, run, today }: { row: EntryRow; run: Run; today: string }) {
  const e = row.entry;
  const shownDate = entryDate(e);
  const overdue = isOverdue(e, today);
  const update = (patch: Parameters<typeof updateCashFlowEntry>[1], success?: string) => run(() => updateCashFlowEntry(e.id, patch), success);
  const muted = e.status === "posted" || e.status === "skipped";

  return (
    <tr style={{ opacity: e.status === "skipped" ? 0.55 : 1 }}>
      <td style={{ ...tdStyle, paddingLeft: 10, minWidth: 210 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TextCell ariaLabel={`Name of ${e.name}`} value={e.name} onCommit={(v) => (v ? update({ name: v }) : Promise.resolve())} style={{ fontWeight: muted ? 400 : 600, minWidth: 120 }} />
          {e.settlement && e.settlement !== "manual" && <Tag title={SETTLEMENT_LABELS[e.settlement]}>{e.settlement === "auto" ? "AD" : "X"}</Tag>}
          {!e.itemId && <Tag title="Not from a recurring item">one-off</Tag>}
        </div>
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <input
          type="date"
          aria-label={`Date of ${e.name}`}
          value={shownDate}
          onChange={(ev) => {
            const v = ev.target.value;
            if (!isValidIsoDate(v) || v === shownDate) return;
            update(e.status === "posted" ? { postedDate: v } : { postingDate: v }).catch(() => {});
          }}
          style={{ ...inputStyle, padding: "3px 4px", fontSize: 12, color: overdue ? "var(--attention)" : "var(--text)" }}
        />
        {(e.dateUncertain || e.dueDate !== shownDate) && (
          <div style={{ fontSize: 10.5, color: "var(--muted)", paddingLeft: 4 }}>
            {e.dateUncertain ? "date is an estimate" : `due ${shortDate(e.dueDate)}`}
          </div>
        )}
      </td>
      <td style={{ ...tdStyle, width: 120 }}>
        <MoneyCell
          ariaLabel={`Expected amount of ${e.name}`}
          value={e.expectedAmount}
          onCommit={(v) => update({ expectedAmount: v ?? 0 })}
          style={{ color: e.kind === "deposit" ? "var(--positive)" : "var(--text)" }}
        />
      </td>
      <td style={{ ...tdStyle, width: 120 }}>
        <MoneyCell ariaLabel={`Actual amount of ${e.name}`} value={e.actualAmount} allowEmpty placeholder="—" onCommit={(v) => update({ actualAmount: v })} />
      </td>
      <td style={tdStyle}>
        <select
          aria-label={`Status of ${e.name}`}
          value={e.status}
          onChange={(ev) => update({ status: ev.target.value as EntryStatus }).catch(() => {})}
          style={{ ...inputStyle, padding: "3px 4px", fontSize: 12, color: statusColor(e, today), fontWeight: 600 }}
        >
          {(Object.keys(STATUS_LABELS) as EntryStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
              {s === "planned" && overdue ? " — overdue" : ""}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          type="date"
          aria-label={`Scheduled date of ${e.name}`}
          value={e.scheduledDate ?? ""}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v === "") update({ scheduledDate: null }).catch(() => {});
            else if (isValidIsoDate(v)) update({ scheduledDate: v, ...(e.status === "planned" ? { status: "scheduled" as const } : {}) }).catch(() => {});
          }}
          style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }}
        />
      </td>
      <td style={{ ...tdStyle, width: 140 }}>
        <TextCell
          ariaLabel={`Confirmation number of ${e.name}`}
          value={e.confirmationCode}
          placeholder={e.kind === "bill" && (e.settlement ?? "manual") === "manual" ? "—" : ""}
          onCommit={(v) => update({ confirmationCode: v, ...(v && e.status === "planned" ? { status: "scheduled" as const } : {}) })}
          style={{ fontFamily: "var(--mono)", fontSize: 12 }}
        />
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: row.balanceAfter < 0 ? "var(--attention)" : "var(--text)" }}>
        {fmtCurrency(row.balanceAfter)}
        <div style={{ fontSize: 10.5, color: e.kind === "deposit" ? "var(--positive)" : "var(--muted)" }}>{row.counted ? signedAmount(row.amount, e.kind) : "not counted"}</div>
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <ConfirmButton label="×" confirmLabel="Delete" title={`Delete ${e.name}`} onConfirm={() => run(() => deleteCashFlowEntry(e.id), `Deleted ${e.name}`).catch(() => {})} />
      </td>
    </tr>
  );
}

function AddEntryRow({ month, defaultDate, run, onDone }: { month: CashFlowMonth; defaultDate: string; run: Run; onDone: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CashFlowEntry["kind"]>("bill");
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const parsed = parseMoneyInput(amount);
  const valid = name.trim() !== "" && isValidIsoDate(date) && date.startsWith(month.month) && parsed !== null && parsed >= 0;

  async function add() {
    if (!valid) return;
    await run(() => addCashFlowEntry({ monthId: month.id, name: name.trim(), kind, postingDate: date, expectedAmount: parsed! }), `Added ${name.trim()}`)
      .then(onDone)
      .catch(() => {});
  }

  return (
    <tr>
      <td style={{ ...tdStyle, paddingLeft: 10 }}>
        <input aria-label="New item name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ ...inputStyle, width: "100%" }} />
      </td>
      <td style={tdStyle}>
        <input aria-label="New item date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }} />
      </td>
      <td style={tdStyle}>
        <input aria-label="New item amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" style={{ ...inputStyle, width: 100, fontFamily: "var(--mono)", textAlign: "right" }} />
      </td>
      <td style={tdStyle}>
        <select aria-label="New item kind" value={kind} onChange={(e) => setKind(e.target.value as CashFlowEntry["kind"])} style={{ ...inputStyle, padding: "4px" }}>
          <option value="bill">Bill</option>
          <option value="deposit">Deposit</option>
        </select>
      </td>
      <td colSpan={5} style={tdStyle}>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <SmallButton tone="accent" onClick={add} disabled={!valid}>
            Add
          </SmallButton>
          <SmallButton onClick={onDone}>Cancel</SmallButton>
        </span>
      </td>
    </tr>
  );
}
