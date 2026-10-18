"use client";

import { useState } from "react";
import type { AppState, BankAccount } from "@/lib/types";
import { addBankAccount, deleteBankAccount, updateBankAccount } from "@/lib/api";
import { canadianBankHolidays } from "@/lib/businessDays";
import { isValidIsoDate } from "@/lib/request";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, inputStyle, labelStyle } from "../ui";
import { ConfirmButton, MoneyCell, SmallButton, TextCell, errorMessage, parseMoneyInput, weekdayDate } from "./shared";

export function BankAccounts({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [last4, setLast4] = useState("");
  const [rate, setRate] = useState("50.00");

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      await onReload();
      if (success) pushToast(success);
    } catch (err) {
      pushToast(errorMessage(err, "Couldn't save the account"));
      throw err;
    }
  }

  const parsedRate = parseMoneyInput(rate);
  return (
    <div>
      <PageTitle>Accounts</PageTitle>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, maxWidth: 720 }}>
        The bank account Cash Flow tracks. Its bank holidays decide when a payment due on a holiday actually posts.
      </div>

      <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px", maxWidth: 620, marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>+ Add an account</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" style={{ ...inputStyle, flex: "2 1 160px" }} />
          <input aria-label="Bank" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Bank" style={{ ...inputStyle, flex: "1 1 110px" }} />
          <input aria-label="Last 4" value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="Last 4" style={{ ...inputStyle, width: 70 }} />
          <label>
            <div style={labelStyle}>Daily spend</div>
            <input aria-label="Daily spend rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 80, fontFamily: "var(--mono)" }} />
          </label>
          <PrimaryButton
            disabled={!name.trim() || parsedRate === null || parsedRate < 0}
            onClick={() =>
              run(() => addBankAccount({ name: name.trim(), institution: institution.trim(), last4: last4.trim(), dailySpendRate: parsedRate! }), `Added ${name.trim()}`)
                .then(() => {
                  setName("");
                  setInstitution("");
                  setLast4("");
                })
                .catch(() => {})
            }
          >
            Add account
          </PrimaryButton>
        </div>
      </div>

      {appState.bankAccounts.map((a) => (
        <AccountCard key={a.id} account={a} run={run} />
      ))}
    </div>
  );
}

function AccountCard({ account: a, run }: { account: BankAccount; run: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [showHolidays, setShowHolidays] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");
  const years = [...new Set(a.bankHolidays.map((d) => Number(d.slice(0, 4))))].sort();
  const nextYear = (years[years.length - 1] ?? new Date().getFullYear()) + 1;
  const thisYear = new Date().getFullYear();
  const upcoming = a.bankHolidays.filter((d) => d.startsWith(String(thisYear)) || d.startsWith(String(thisYear + 1)));

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 14, maxWidth: 820 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ width: 14, height: 14, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
        <TextCell ariaLabel="Account name" value={a.name} onCommit={(v) => (v ? run(() => updateBankAccount(a.id, { name: v })) : Promise.resolve())} style={{ fontSize: 14, fontWeight: 600, width: 200 }} />
        <TextCell ariaLabel="Bank" value={a.institution} placeholder="Bank" onCommit={(v) => run(() => updateBankAccount(a.id, { institution: v }))} style={{ width: 140, color: "var(--muted)" }} />
        <TextCell ariaLabel="Last 4" value={a.last4} placeholder="Last 4" onCommit={(v) => run(() => updateBankAccount(a.id, { last4: v }))} style={{ width: 70, fontFamily: "var(--mono)" }} />
        <span style={{ marginLeft: "auto" }}>
          <ConfirmButton label="Delete" confirmLabel="Delete account" title="Only possible while it has no months, items, or bank lines" onConfirm={() => run(() => deleteBankAccount(a.id), `Deleted ${a.name}`).catch(() => {})} />
        </span>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
        <label>
          <div style={labelStyle}>Daily spend rate (new months)</div>
          <MoneyCell ariaLabel="Daily spend rate" value={a.dailySpendRate} onCommit={(v) => run(() => updateBankAccount(a.id, { dailySpendRate: v ?? 0 }), "Saved — months you start from now use it")} style={{ border: "1px solid var(--border)", width: 110, textAlign: "left" }} />
        </label>
        <label>
          <div style={labelStyle}>Warn when the low point is below</div>
          <MoneyCell
            ariaLabel="Low-balance warning"
            value={a.lowBalanceThreshold}
            allowEmpty
            allowNegative
            placeholder="0.00"
            onCommit={(v) => run(() => updateBankAccount(a.id, { lowBalanceThreshold: v }))}
            style={{ border: "1px solid var(--border)", width: 110, textAlign: "left" }}
          />
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <button onClick={() => setShowHolidays((s) => !s)} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, padding: 0 }}>
          {showHolidays ? "Hide" : "Show"} bank holidays ({a.bankHolidays.length}, {years[0]}–{years[years.length - 1]})
        </button>
        {showHolidays && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Payments Canada&apos;s non-business days plus BC&apos;s Family Day and BC Day; weekend holidays are moved to the next weekday. Remove a date if your bank posts on it.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {upcoming.map((d) => (
                <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border)", borderRadius: 14, padding: "2px 4px 2px 10px", fontSize: 12 }}>
                  {weekdayDate(d)}, {d.slice(0, 4)}
                  <button
                    aria-label={`Remove ${d}`}
                    onClick={() => run(() => updateBankAccount(a.id, { bankHolidays: a.bankHolidays.filter((x) => x !== d) }), "Holiday removed").catch(() => {})}
                    style={{ border: "none", background: "none", color: "var(--muted)", fontSize: 13, padding: "0 4px" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input aria-label="Holiday to add" type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} style={{ ...inputStyle, padding: "4px 6px" }} />
              <SmallButton
                disabled={!isValidIsoDate(newHoliday) || a.bankHolidays.includes(newHoliday)}
                onClick={() => run(() => updateBankAccount(a.id, { bankHolidays: [...a.bankHolidays, newHoliday] }), "Holiday added").then(() => setNewHoliday("")).catch(() => {})}
              >
                Add date
              </SmallButton>
              <SmallButton
                onClick={() => run(() => updateBankAccount(a.id, { bankHolidays: [...a.bankHolidays, ...canadianBankHolidays(nextYear).map((h) => h.date)] }), `Added ${nextYear}'s holidays`).catch(() => {})}
              >
                Add {nextYear}&apos;s holidays
              </SmallButton>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Showing {thisYear} and {thisYear + 1}. Earlier years are kept for the history.</div>
          </div>
        )}
      </div>
    </div>
  );
}
