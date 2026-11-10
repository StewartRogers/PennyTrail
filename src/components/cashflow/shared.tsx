"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { BankAccount, CashFlowEntry, CashFlowMonth, DayOfMonth, EntryStatus, Recurrence, Settlement } from "@/lib/types";
import { parseAmount } from "@/lib/csv";
import { fmtCurrency, toISODate } from "@/lib/format";
import { isOverdue, needsScheduling } from "@/lib/cashflow";
import { addDays } from "@/lib/dates";

export function todayIso(): string {
  return toISODate(new Date());
}

export function currentMonthKey(): string {
  return todayIso().slice(0, 7);
}

export function longMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// "Oct 9" — the year is implied by the month on screen.
export function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function dayLabel(day: DayOfMonth): string {
  return day === "last" ? "the last day" : `the ${ordinal(day)}`;
}

export function describeRecurrence(r: Recurrence): string {
  switch (r.type) {
    case "monthly":
      return `Monthly on ${dayLabel(r.day)}`;
    case "everyNMonths":
      return `Every ${r.n} months on ${dayLabel(r.day)} (from ${longMonthLabel(r.anchorMonth)})`;
    case "semiMonthly":
      return `Twice a month: ${dayLabel(r.days[0])} and ${dayLabel(r.days[1])}`;
    case "everyNWeeks":
      return `Every ${r.n === 1 ? "week" : `${r.n} weeks`} from ${weekdayDate(r.anchorDate)}`;
    case "once":
      return `Once, on ${weekdayDate(r.date)}`;
  }
}

export const SETTLEMENT_LABELS: Record<Settlement, string> = {
  manual: "You pay it",
  auto: "Automatic",
  external: "Someone else",
};

export const STATUS_LABELS: Record<EntryStatus, string> = {
  planned: "Planned",
  scheduled: "Scheduled",
  posted: "Posted",
  skipped: "Skipped",
};

export function statusColor(entry: Pick<CashFlowEntry, "status" | "postedDate" | "postingDate">, today: string): string {
  if (isOverdue(entry, today)) return "var(--attention)";
  if (entry.status === "posted") return "var(--positive)";
  if (entry.status === "scheduled") return "var(--accent)";
  return "var(--muted)";
}

// Signed for display: deposits read "+$3,000.00".
export function signedAmount(amount: number, kind: "bill" | "deposit"): string {
  return (kind === "deposit" ? "+" : "−") + fmtCurrency(amount).replace("-", "");
}

export function parseMoneyInput(text: string): number | null {
  const n = parseAmount(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function moneyText(n: number | undefined): string {
  return n === undefined ? "" : n.toFixed(2);
}

// What Upcoming and the sidebar badge count: overdue, or a manual bill
// still to schedule within the next week.
export function attentionCount(entries: CashFlowEntry[], today: string): number {
  const horizon = addDays(today, 7);
  return entries.filter((e) => isOverdue(e, today) || (needsScheduling(e) && (e.postedDate ?? e.postingDate) <= horizon)).length;
}

export function monthsForAccount(months: CashFlowMonth[], accountId: string | null): CashFlowMonth[] {
  return months.filter((m) => m.accountId === accountId).sort((a, b) => (a.month < b.month ? -1 : 1));
}

export const cellInput: CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 6,
  padding: "4px 6px",
  fontSize: 12.5,
  background: "transparent",
  color: "var(--text)",
  width: "100%",
};

export const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 8px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: 11.5,
  whiteSpace: "nowrap",
};

export const tdStyle: CSSProperties = { padding: "5px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

// A money cell edited in place: commits on blur or Enter, reverts on Escape
// or a failed save. `allowEmpty` lets clearing the field mean "unset".
export function MoneyCell({
  value,
  onCommit,
  allowEmpty = false,
  allowNegative = false,
  placeholder,
  ariaLabel,
  style,
}: {
  value: number | undefined;
  onCommit: (value: number | null) => Promise<void>;
  allowEmpty?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? moneyText(value);
  // The typed text stays on screen until the save (and the reload after it)
  // finishes, then gives way to the stored value — which is the old one if
  // the save failed.
  async function commit() {
    if (draft === null) return;
    const text = draft.trim();
    if (text === "") {
      if (allowEmpty && value !== undefined) await onCommit(null).catch(() => {});
      setDraft(null);
      return;
    }
    const parsed = parseMoneyInput(text);
    if (parsed !== null && (allowNegative || parsed >= 0) && (value === undefined || Math.round(parsed * 100) !== Math.round(value * 100))) {
      await onCommit(parsed).catch(() => {});
    }
    setDraft(null);
  }
  return (
    <input
      aria-label={ariaLabel}
      className="inline-editable"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      style={{ ...cellInput, fontFamily: "var(--mono)", textAlign: "right", ...style }}
    />
  );
}

export function TextCell({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  style,
}: {
  value: string | undefined;
  onCommit: (value: string) => Promise<void>;
  placeholder?: string;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  async function commit() {
    if (draft === null) return;
    const text = draft.trim();
    if (text !== (value ?? "")) await onCommit(text).catch(() => {});
    setDraft(null);
  }
  return (
    <input
      aria-label={ariaLabel}
      className="inline-editable"
      value={draft ?? value ?? ""}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      style={{ ...cellInput, ...style }}
    />
  );
}

export function Tag({ children, color = "var(--muted)", title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} style={{ border: `1px solid ${color}`, color, fontSize: 10.5, fontWeight: 600, borderRadius: 10, padding: "0 6px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function SmallButton({ children, onClick, disabled, title, tone = "default" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; tone?: "default" | "accent" | "danger" }) {
  const color = tone === "accent" ? "var(--accent)" : tone === "danger" ? "var(--attention)" : "var(--text)";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{ border: "1px solid var(--border)", background: "var(--panel)", color, borderRadius: 6, padding: "4px 9px", fontSize: 12, fontWeight: 600, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
    >
      {children}
    </button>
  );
}

// A destructive action that takes two clicks instead of a browser dialog.
export function ConfirmButton({ label, confirmLabel, onConfirm, title }: { label: string; confirmLabel: string; onConfirm: () => void; title?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <SmallButton tone="danger" onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</SmallButton>
      <SmallButton onClick={() => setArmed(false)}>Cancel</SmallButton>
    </span>
  ) : (
    <SmallButton title={title} tone="danger" onClick={() => setArmed(true)}>{label}</SmallButton>
  );
}

export function NoAccount({ onGoAccounts }: { onGoAccounts: () => void }) {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "20px 22px", maxWidth: 520, color: "var(--muted)", fontSize: 13.5 }}>
      <div style={{ marginBottom: 12 }}>Add your bank account first — Cash Flow tracks one account&apos;s balance month by month.</div>
      <SmallButton tone="accent" onClick={onGoAccounts}>Go to Accounts</SmallButton>
    </div>
  );
}

export function AccountPicker({ accounts, value, onChange }: { accounts: BankAccount[]; value: string | null; onChange: (id: string) => void }) {
  if (accounts.length < 2) return null;
  return (
    <select aria-label="Account" value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.last4 ? ` ····${a.last4}` : ""}
        </option>
      ))}
    </select>
  );
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
