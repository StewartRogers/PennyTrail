"use client";

import { useState } from "react";
import type { AppState, CashFlowEntry } from "@/lib/types";
import { updateCashFlowEntry } from "@/lib/api";
import { entryAmount, entryDate, isOutstanding, isOverdue, needsScheduling } from "@/lib/cashflow";
import { addDays } from "@/lib/dates";
import { isValidIsoDate } from "@/lib/request";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, SegmentedControl, inputStyle } from "../ui";
import { SETTLEMENT_LABELS, SmallButton, Tag, errorMessage, longMonthLabel, parseMoneyInput, signedAmount, tdStyle, thStyle, todayIso, weekdayDate } from "./shared";

type Horizon = "7" | "14" | "31";

// Bills and deposits that aren't done yet (done means posted), across every
// month: what's overdue, what still needs scheduling, what's scheduled and
// waiting to post, and what's expected on its own.
export function CashFlowUpcoming({ appState, onReload, accountId, onOpenMonth }: { appState: AppState; onReload: () => Promise<void>; accountId: string; onOpenMonth: (monthKey: string) => void }) {
  const [horizon, setHorizon] = useState<Horizon>("14");
  const today = todayIso();
  const until = addDays(today, Number(horizon));
  const monthById = new Map(appState.cashFlowMonths.filter((m) => m.accountId === accountId).map((m) => [m.id, m]));
  const outstanding = appState.cashFlowEntries
    .filter((e) => monthById.has(e.monthId) && isOutstanding(e))
    .sort((a, b) => (entryDate(a) < entryDate(b) ? -1 : entryDate(a) > entryDate(b) ? 1 : 0));

  const overdue = outstanding.filter((e) => isOverdue(e, today));
  const soon = outstanding.filter((e) => !isOverdue(e, today) && entryDate(e) <= until);
  const groups: { title: string; hint: string; entries: CashFlowEntry[] }[] = [
    { title: "Overdue", hint: "Past their date and not posted yet", entries: overdue },
    { title: "Needs scheduling", hint: "Bills you pay yourself that don't have a payment set up", entries: soon.filter(needsScheduling) },
    { title: "Scheduled, waiting to post", hint: "Payment set up; done once the bank posts it", entries: soon.filter((e) => e.status === "scheduled") },
    { title: "Expected", hint: "Automatic payments, deposits, and items someone else handles", entries: soon.filter((e) => e.status === "planned" && !needsScheduling(e)) },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <PageTitle>Upcoming</PageTitle>
        <div style={{ marginLeft: "auto" }}>
          <SegmentedControl
            options={[
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "31", label: "31 days" },
            ]}
            value={horizon}
            onChange={setHorizon}
          />
        </div>
      </div>
      {groups.every((g) => g.entries.length === 0) && (
        <div style={{ color: "var(--muted)", fontSize: 13.5 }}>Nothing due in the next {horizon} days, and nothing overdue.</div>
      )}
      {groups
        .filter((g) => g.entries.length > 0)
        .map((g) => (
          <div key={g.title} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14, overflowX: "auto" }}>
            <div style={{ padding: "12px 16px 4px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: g.title === "Overdue" ? "var(--attention)" : "var(--text)" }}>
                {g.title} · {g.entries.length}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{g.hint}</div>
              <div style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 13 }}>
                {fmtCurrency(g.entries.filter((e) => e.kind === "bill").reduce((s, e) => s + Math.round(entryAmount(e) * 100), 0) / 100)} out
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 16 }}>Date</th>
                  <th style={thStyle}>Item</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  <th style={thStyle}>Month</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {g.entries.map((e) => (
                  <UpcomingRow key={e.id} entry={e} monthKey={monthById.get(e.monthId)!.month} onReload={onReload} onOpenMonth={onOpenMonth} today={today} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function UpcomingRow({ entry: e, monthKey, onReload, onOpenMonth, today }: { entry: CashFlowEntry; monthKey: string; onReload: () => Promise<void>; onOpenMonth: (k: string) => void; today: string }) {
  const pushToast = useToast();
  const [mode, setMode] = useState<"idle" | "schedule" | "post">("idle");
  const [date, setDate] = useState(today);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState(entryAmount(e).toFixed(2));

  async function save(patch: Parameters<typeof updateCashFlowEntry>[1], message: string) {
    try {
      await updateCashFlowEntry(e.id, patch);
      await onReload();
      pushToast(message);
      setMode("idle");
    } catch (err) {
      pushToast(errorMessage(err, "Couldn't update the entry"));
    }
  }

  const parsedAmount = parseMoneyInput(amount);
  return (
    <tr>
      <td style={{ ...tdStyle, paddingLeft: 16, whiteSpace: "nowrap", color: isOverdue(e, today) ? "var(--attention)" : "var(--text)" }}>
        {weekdayDate(entryDate(e))}
        {e.dateUncertain && <span style={{ color: "var(--muted)", fontSize: 11 }}> (estimate)</span>}
      </td>
      <td style={tdStyle}>
        <span style={{ fontWeight: 600 }}>{e.name}</span>{" "}
        {e.settlement && e.settlement !== "manual" && <Tag>{SETTLEMENT_LABELS[e.settlement]}</Tag>}{" "}
        {e.status === "scheduled" && (
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            scheduled{e.scheduledDate ? ` ${weekdayDate(e.scheduledDate)}` : ""}
            {e.confirmationCode ? ` · #${e.confirmationCode}` : ""}
          </span>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", color: e.kind === "deposit" ? "var(--positive)" : "var(--text)" }}>{signedAmount(entryAmount(e), e.kind)}</td>
      <td style={tdStyle}>
        <button onClick={() => onOpenMonth(monthKey)} style={{ border: "none", background: "none", color: "var(--accent)", padding: 0, fontSize: 12.5 }}>
          {longMonthLabel(monthKey)}
        </button>
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        {mode === "idle" && (
          <span style={{ display: "inline-flex", gap: 6 }}>
            {e.kind === "bill" && e.status === "planned" && <SmallButton onClick={() => setMode("schedule")}>Schedule</SmallButton>}
            <SmallButton tone="accent" onClick={() => setMode("post")}>Mark posted</SmallButton>
          </span>
        )}
        {mode === "schedule" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input aria-label={`Scheduled date for ${e.name}`} type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }} />
            <input aria-label={`Confirmation number for ${e.name}`} value={code} onChange={(ev) => setCode(ev.target.value)} placeholder="Confirmation #" style={{ ...inputStyle, padding: "4px 6px", width: 130, fontFamily: "var(--mono)" }} />
            <SmallButton tone="accent" disabled={!isValidIsoDate(date)} onClick={() => save({ status: "scheduled", scheduledDate: date, confirmationCode: code }, `${e.name} scheduled`)}>
              Save
            </SmallButton>
            <SmallButton onClick={() => setMode("idle")}>Cancel</SmallButton>
          </span>
        )}
        {mode === "post" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input aria-label={`Posted date for ${e.name}`} type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={{ ...inputStyle, padding: "3px 4px", fontSize: 12 }} />
            <input aria-label={`Posted amount for ${e.name}`} value={amount} onChange={(ev) => setAmount(ev.target.value)} inputMode="decimal" style={{ ...inputStyle, padding: "4px 6px", width: 100, fontFamily: "var(--mono)", textAlign: "right" }} />
            <SmallButton
              tone="accent"
              disabled={!isValidIsoDate(date) || parsedAmount === null || parsedAmount < 0}
              onClick={() => save({ status: "posted", postedDate: date, actualAmount: parsedAmount! }, `${e.name} posted`)}
            >
              Save
            </SmallButton>
            <SmallButton onClick={() => setMode("idle")}>Cancel</SmallButton>
          </span>
        )}
      </td>
    </tr>
  );
}
