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
import { entriesForMonth, entryAmount, entryDate, summarizeMonth, type EntryRow, type PeriodSummary } from "@/lib/cashflow";
import { suggestCheckpointBalances, type CheckpointSuggestion } from "@/lib/bankMatching";
import { addMonths, monthEnd } from "@/lib/dates";
import { isValidIsoDate } from "@/lib/request";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, inputStyle, labelStyle } from "../ui";
import {
  ConfirmButton,
  ConfirmationCell,
  DateCell,
  MoneyCell,
  STATUS_LABELS,
  SmallButton,
  Tag,
  TextCell,
  errorMessage,
  longMonthLabel,
  monthsForAccount,
  parseMoneyInput,
  shortDate,
  statusColor,
  tdStyle,
  thStyle,
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
}: {
  appState: AppState;
  onReload: () => Promise<void>;
  accountId: string;
  monthKey: string;
  onMonthKeyChange: (key: string) => void;
}) {
  const run = useRun(onReload);
  const months = monthsForAccount(appState.cashFlowMonths, accountId);
  const month = months.find((m) => m.month === monthKey);

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
        <StartedMonth appState={appState} month={month} run={run} />
      ) : (
        <StartMonthPanel appState={appState} accountId={accountId} monthKey={monthKey} run={run} />
      )}
    </div>
  );
}

function StartMonthPanel({
  appState,
  accountId,
  monthKey,
  run,
}: {
  appState: AppState;
  accountId: string;
  monthKey: string;
  run: Run;
}) {
  const previous = appState.cashFlowMonths.find((m) => m.accountId === accountId && m.month === addMonths(monthKey, -1));
  const carried = previous ? summarizeMonth(previous, entriesForMonth(appState.cashFlowEntries, previous.id)).closingBalance : null;
  const [opening, setOpening] = useState("");
  const itemCount = appState.cashFlowItems.filter((i) => i.accountId === accountId && i.active).length;
  // With a previous month the opening is always its close; only the first
  // month takes a balance by hand.
  const parsed = carried === null && opening.trim() ? parseMoneyInput(opening) : null;
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
      </div>
      {carried !== null ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            Opens with <b style={{ fontFamily: "var(--mono)" }}>{fmtCurrency(carried)}</b>, {longMonthLabel(previous!.month)}&apos;s closing balance.
          </div>
          <PrimaryButton onClick={start}>Start {longMonthLabel(monthKey)}</PrimaryButton>
        </>
      ) : (
        <>
          <div style={labelStyle}>Opening balance</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              aria-label="Opening balance"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              style={{ ...inputStyle, width: 140, fontFamily: "var(--mono)" }}
            />
            <PrimaryButton onClick={start} disabled={!canStart}>
              Start {longMonthLabel(monthKey)}
            </PrimaryButton>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            There&apos;s no previous month to carry from, so enter the account&apos;s balance at the start of the month.
          </div>
        </>
      )}
    </div>
  );
}

function StartedMonth({ appState, month, run }: { appState: AppState; month: CashFlowMonth; run: Run }) {
  const entries = entriesForMonth(appState.cashFlowEntries, month.id);
  const summary = summarizeMonth(month, entries);
  const suggestions = new Map(
    suggestCheckpointBalances({ month, months: appState.cashFlowMonths, bankTransactions: appState.bankTransactions }).map((s) => [s.periodId, s])
  );
  const previous = appState.cashFlowMonths.find((m) => m.accountId === month.accountId && m.month === addMonths(month.month, -1));
  const [newCheckpoint, setNewCheckpoint] = useState("");
  // Shown only when the projection ahead dips under the account's warning
  // level (zero — overdrawn — when none is set).
  const lowPoint = summary.lowPoint;
  const lowThreshold = appState.bankAccounts.find((a) => a.id === month.accountId)?.lowBalanceThreshold ?? 0;
  const notProjected = entries.filter((e) => e.status !== "projected").length;
  const settingLabel = { fontSize: 12.5, color: "var(--muted)" };
  const settingInput = { border: "1px solid var(--border)", background: "var(--panel)", width: 120, fontWeight: 600 };

  return (
    <div>
      <div style={{ display: "flex", gap: "8px 24px", flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={settingLabel}>Opening balance</span>
          {previous ? (
            // The opening follows the previous month's close; it isn't typed in.
            <>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13.5 }}>
                {fmtCurrency(month.openingBalance)}
              </span>
              {month.openingSource === "carried" ? (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{longMonthLabel(previous.month)}&apos;s close</span>
              ) : (
                <button
                  onClick={() => run(() => updateCashFlowMonth(month.id, { openingSource: "carried" }), `Opening now carries ${longMonthLabel(previous.month)}'s close`).catch(() => {})}
                  style={{ border: "none", background: "none", color: "var(--accent)", padding: 0, fontSize: 11.5, textDecoration: "underline" }}
                >
                  use {longMonthLabel(previous.month)}&apos;s close
                </button>
              )}
            </>
          ) : (
            <MoneyCell
              ariaLabel="Opening balance"
              value={month.openingBalance}
              allowNegative
              onCommit={(v) => run(() => updateCashFlowMonth(month.id, { openingBalance: v ?? 0 }))}
              style={settingInput}
            />
          )}
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={settingLabel}>Daily spend rate</span>
          <MoneyCell
            ariaLabel="Daily spend rate"
            value={month.dailySpendRate}
            onCommit={(v) => run(() => updateCashFlowMonth(month.id, { dailySpendRate: v ?? 0 }))}
            style={settingInput}
          />
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>× days = Weekly Spend</span>
        </span>
      </div>

      {lowPoint && lowPoint.balance < lowThreshold && (
        <div role="alert" style={{ fontSize: 13, color: "var(--attention)", marginBottom: 12 }}>
          Lowest balance ahead: <b style={{ fontFamily: "var(--mono)" }}>{fmtCurrency(lowPoint.balance)}</b> on {weekdayDate(lowPoint.date)}
          {lowThreshold !== 0 && <> — below your {fmtCurrency(lowThreshold)} warning level</>}
        </div>
      )}

      {summary.periods.map((p) => (
        <PeriodBlock
          key={p.period.id}
          month={month}
          period={p}
          isLast={p.index === summary.periods.length - 1}
          canRemove={summary.periods.length > 1}
          suggestion={suggestions.get(p.period.id)}
          run={run}
        />
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        <SmallButton onClick={() => run(() => updateCashFlowMonth(month.id, { regenerate: true }), "Checked recurring items").catch(() => {})} title="Adds any recurring item created since this month was started; existing entries are left alone">
          Add new recurring items
        </SmallButton>
        {notProjected > 0 && (
          <ConfirmButton
            label="Set all to Projected"
            confirmLabel={`Set ${notProjected} entr${notProjected === 1 ? "y" : "ies"} back to Projected`}
            title="Puts every entry in this month back to Projected, as if each were set to Projected by hand. Confirmation numbers are kept; bank-line matches are undone, and matched entries go back to their projected amount and date."
            onConfirm={() => run(() => updateCashFlowMonth(month.id, { resetStatuses: true }), "Every entry is Projected").catch(() => {})}
          />
        )}
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input aria-label="New checkpoint date" type="date" value={newCheckpoint} min={`${month.month}-01`} max={`${month.month}-31`} onChange={(e) => setNewCheckpoint(e.target.value)} style={{ ...inputStyle, padding: "4px 6px" }} />
          <SmallButton
            disabled={!isValidIsoDate(newCheckpoint)}
            onClick={() => run(() => updateCashFlowMonth(month.id, { addPeriod: { endDate: newCheckpoint } }), "Checkpoint added").then(() => setNewCheckpoint("")).catch(() => {})}
          >
            Add checkpoint
          </SmallButton>
        </span>
        <SmallButton
          disabled={!month.closed && !summary.closingIsActual}
          title={month.closed || summary.closingIsActual ? undefined : "Record the end-of-month balance first — the month closes itself when you do"}
          onClick={() => run(() => updateCashFlowMonth(month.id, { closed: !month.closed }), month.closed ? "Month reopened" : "Month marked closed").catch(() => {})}
        >
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
}: {
  month: CashFlowMonth;
  period: PeriodSummary;
  isLast: boolean;
  canRemove: boolean;
  suggestion: CheckpointSuggestion | undefined;
  run: Run;
}) {
  const [adding, setAdding] = useState(false);
  const label = isLast ? "END OF MONTH" : "END OF WEEK";
  // The last checkpoint closes the month on its last day; it only stays
  // editable when an imported month has it somewhere else, so it can be moved there.
  const fixedDate = isLast && p.end === monthEnd(month.month);

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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, paddingLeft: 16 }}>Item</th>
            <th style={thStyle}>Date</th>
            <th style={{ ...thStyle, textAlign: "right" }} title="Money out: spending, bill payments, rent — subtracted from the balance">Withdrawals (−)</th>
            <th style={{ ...thStyle, textAlign: "right" }} title="Money in — added to the balance">Deposits (+)</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Confirmation #</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Balance</th>
            <th style={{ ...thStyle, width: 1 }} />
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "oklch(0.97 0.004 260)" }}>
            <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 600, whiteSpace: "nowrap" }}>
              Weekly Spend{" "}
              <span
                style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}
                title={p.period.spendOverride === undefined ? undefined : "Clear the amount to use the daily rate"}
              >
                [{p.period.spendOverride === undefined ? `${fmtCurrency(month.dailySpendRate)}/day × ${p.days}` : "set by hand"}]
              </span>
            </td>
            <td style={{ ...tdStyle, color: "var(--muted)", fontSize: 12 }}>{shortDate(p.start)}</td>
            <td style={{ ...tdStyle, width: 120 }}>
              <MoneyCell
                ariaLabel={`Weekly Spend for the period ending ${p.end}`}
                value={p.period.spendOverride}
                allowEmpty
                placeholder={p.rateSpend.toFixed(2)}
                onCommit={(v) => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, spendOverride: v }] }))}
              />
            </td>
            <td style={tdStyle} />
            <td colSpan={2} style={tdStyle} />
            <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(p.afterSpend)}</td>
            <td style={tdStyle} />
          </tr>
          {p.rows.map((row) => (
            <EntryRowView key={row.entry.id} row={row} run={run} />
          ))}
          {adding && <AddEntryRow month={month} defaultDate={p.end} run={run} onDone={() => setAdding(false)} />}
          {/* Yellow while the balance is projected, green once the actual is typed over it. */}
          <tr data-balance={p.actual === undefined ? "projected" : "actual"} style={{ background: p.actual === undefined ? "var(--row-projected)" : "var(--row-actual)" }}>
            <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 700, letterSpacing: "0.02em" }}>{label}</td>
            {/* Just the label and the balance. The middle stays empty unless
                imported bank lines have a balance to offer. */}
            <td colSpan={5} style={{ ...tdStyle, fontSize: 12, textAlign: "right" }}>
              {p.actual === undefined && suggestion && (
                <span>
                  Bank lines put it at <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{fmtCurrency(suggestion.balance)}</span>{" "}
                  <SmallButton
                    title={`${fmtCurrency(suggestion.basedOn.balance)} on ${shortDate(suggestion.basedOn.date)} plus ${suggestion.lines} imported line${suggestion.lines === 1 ? "" : "s"} — check it against your banking app`}
                    onClick={() => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, actualBalance: suggestion.balance }] }), "Checkpoint recorded").catch(() => {})}
                  >
                    Use it
                  </SmallButton>
                </span>
              )}
            </td>
            {/* The balance is the field: the projection shows greyed until the
                real balance is typed over it, which records the checkpoint. */}
            <td style={{ ...tdStyle, width: 140 }}>
              <MoneyCell
                ariaLabel={`Actual balance at ${p.end}`}
                value={p.actual}
                allowEmpty
                allowNegative
                format={fmtCurrency}
                placeholder={fmtCurrency(p.projected)}
                title={p.actual === undefined ? "Projected — type the real balance to record it" : "Actual balance — clear it to go back to the projection"}
                onCommit={(v) => run(() => updateCashFlowMonth(month.id, { periods: [{ id: p.period.id, actualBalance: v }] }), v === null ? "Checkpoint cleared" : "Checkpoint recorded")}
                style={{ border: "1px solid var(--border)", background: "transparent", fontWeight: 600 }}
              />
            </td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              {canRemove && !fixedDate && (
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

function EntryRowView({ row, run }: { row: EntryRow; run: Run }) {
  const e = row.entry;
  const shownDate = entryDate(e);
  const update = (patch: Parameters<typeof updateCashFlowEntry>[1], success?: string) => run(() => updateCashFlowEntry(e.id, patch), success);
  const muted = e.status === "actual" || e.status === "skipped";
  const settlement = e.settlement ?? "manual";
  // Automatic (AD) and someone-else (X) items need no confirmation number,
  // so the Confirmation # cell shows the code instead.
  const shownCode = settlement === "auto" ? "AD" : settlement === "external" ? "X" : e.confirmationCode;
  const missingConfirmation = settlement === "manual" && !e.confirmationCode && e.status !== "skipped";

  function commitCode(text: string) {
    const code = text.trim().toUpperCase();
    if (code === "AD" || code === "AUTO") return update({ settlement: "auto", confirmationCode: "" });
    if (code === "X") return update({ settlement: "external", confirmationCode: "" });
    return update({ settlement: "manual", confirmationCode: text });
  }

  return (
    <tr
      data-missing-confirmation={missingConfirmation || undefined}
      style={{ opacity: e.status === "skipped" ? 0.55 : 1, background: missingConfirmation ? "var(--row-missing)" : undefined }}
    >
      <td style={{ ...tdStyle, paddingLeft: 10, minWidth: 210 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TextCell ariaLabel={`Name of ${e.name}`} value={e.name} onCommit={(v) => (v ? update({ name: v }) : Promise.resolve())} style={{ fontWeight: muted ? 400 : 600, minWidth: 120 }} />
          {!e.itemId && <Tag title="Not from a recurring item">one-off</Tag>}
        </div>
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <DateCell
          ariaLabel={`Date of ${e.name}`}
          value={shownDate}
          // Edits whichever date is shown: the real one once there is one.
          onCommit={(v) => update(e.postedDate !== undefined ? { postedDate: v } : { postingDate: v })}
        />
        {(e.dateUncertain || e.dueDate !== shownDate) && (
          <div style={{ fontSize: 10.5, color: "var(--muted)", paddingLeft: 4 }}>
            {e.dateUncertain ? "date is an estimate" : `due ${shortDate(e.dueDate)}`}
          </div>
        )}
      </td>
      {/* Withdrawals (money out) in the first column, deposits in the second. */}
      {e.kind === "bill" ? (
        <>
          <AmountCell entry={e} update={update} />
          <td style={tdStyle} />
        </>
      ) : (
        <>
          <td style={tdStyle} />
          <AmountCell entry={e} update={update} />
        </>
      )}
      <td style={tdStyle}>
        <select
          aria-label={`Status of ${e.name}`}
          value={e.status}
          onChange={(ev) => update({ status: ev.target.value as EntryStatus }).catch(() => {})}
          style={{ ...inputStyle, padding: "3px 4px", fontSize: 12, color: statusColor(e), fontWeight: 600 }}
        >
          {(Object.keys(STATUS_LABELS) as EntryStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdStyle, width: 140 }}>
        <ConfirmationCell name={e.name} value={shownCode} recordedAt={e.confirmationRecordedAt} showInfo={settlement === "manual"} onCommit={commitCode} />
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: row.balanceAfter < 0 ? "var(--attention)" : "var(--text)" }}>
        {fmtCurrency(row.balanceAfter)}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <ConfirmButton label="×" confirmLabel="Delete" title={`Delete ${e.name}`} onConfirm={() => run(() => deleteCashFlowEntry(e.id), `Deleted ${e.name}`).catch(() => {})} />
      </td>
    </tr>
  );
}

// The withdrawal or deposit cell: one amount, the projection until you type or
// paste the real figure over it. Saving it makes that the entry's only
// amount, so a stale actual can't shadow it — except on a bank-matched
// entry, where it corrects the actual and keeps the projection, which
// unmatching falls back to.
function AmountCell({ entry: e, update }: { entry: CashFlowEntry; update: (patch: Parameters<typeof updateCashFlowEntry>[1]) => Promise<void> }) {
  return (
    <td style={{ ...tdStyle, width: 120 }}>
      <MoneyCell
        ariaLabel={`Amount of ${e.name}`}
        value={entryAmount(e)}
        onCommit={(v) => update(e.bankTransactionId ? { actualAmount: v ?? 0 } : { expectedAmount: v ?? 0, actualAmount: null })}
        style={{ color: e.kind === "deposit" ? "var(--positive)" : "var(--text)" }}
      />
    </td>
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
      <td colSpan={2} style={tdStyle}>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <select aria-label="New item kind" value={kind} onChange={(e) => setKind(e.target.value as CashFlowEntry["kind"])} style={{ ...inputStyle, padding: "4px" }}>
            <option value="bill">Withdrawal (−)</option>
            <option value="deposit">Deposit (+)</option>
          </select>
          <input aria-label="New item amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" style={{ ...inputStyle, width: 100, fontFamily: "var(--mono)", textAlign: "right" }} />
        </span>
      </td>
      <td colSpan={4} style={tdStyle}>
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
