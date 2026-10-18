"use client";

import { useState } from "react";
import type { AppState, CashFlowItem, CashFlowKind, DayOfMonth, Recurrence, RollRule, Settlement } from "@/lib/types";
import { addCashFlowItem, deleteCashFlowItem, updateCashFlowItem } from "@/lib/api";
import { isValidIsoDate } from "@/lib/request";
import { isValidMonthKey } from "@/lib/dates";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "../ToastContext";
import { PageTitle, PrimaryButton, SecondaryButton, inputStyle, labelStyle } from "../ui";
import { ConfirmButton, SETTLEMENT_LABELS, SmallButton, Tag, currentMonthKey, describeRecurrence, errorMessage, parseMoneyInput, tdStyle, thStyle, todayIso } from "./shared";

const ROLL_LABELS: Record<RollRule, string> = {
  next: "Next business day",
  previous: "Previous business day",
  none: "Don't move",
};

interface Draft {
  name: string;
  kind: CashFlowKind;
  amount: string;
  amountMode: "fixed" | "variable";
  recurrence: Recurrence;
  roll: RollRule;
  settlement: Settlement;
  dateUncertain: boolean;
  owner: string;
  matchText: string;
  active: boolean;
}

function draftFrom(item?: CashFlowItem): Draft {
  return {
    name: item?.name ?? "",
    kind: item?.kind ?? "bill",
    amount: item ? item.defaultAmount.toFixed(2) : "",
    amountMode: item?.amountMode ?? "fixed",
    recurrence: item?.recurrence ?? { type: "monthly", day: 1 },
    roll: item?.roll ?? "next",
    settlement: item?.settlement ?? "manual",
    dateUncertain: item?.dateUncertain ?? false,
    owner: item?.owner ?? "",
    matchText: item?.matchText ?? "",
    active: item?.active ?? true,
  };
}

function recurrenceValid(r: Recurrence): boolean {
  switch (r.type) {
    case "monthly":
      return true;
    case "everyNMonths":
      return r.n >= 1 && isValidMonthKey(r.anchorMonth);
    case "semiMonthly":
      return r.days[0] !== r.days[1];
    case "everyNWeeks":
      return r.n >= 1 && isValidIsoDate(r.anchorDate);
    case "once":
      return isValidIsoDate(r.date);
  }
}

function DaySelect({ value, onChange, label }: { value: DayOfMonth; onChange: (d: DayOfMonth) => void; label: string }) {
  return (
    <select aria-label={label} value={String(value)} onChange={(e) => onChange(e.target.value === "last" ? "last" : Number(e.target.value))} style={{ ...inputStyle, padding: "6px" }}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      <option value="last">Last day</option>
    </select>
  );
}

export function RecurrenceEditor({ value, onChange }: { value: Recurrence; onChange: (r: Recurrence) => void }) {
  const setType = (type: Recurrence["type"]) => {
    if (type === "monthly") onChange({ type, day: 1 });
    else if (type === "everyNMonths") onChange({ type, n: 2, day: 1, anchorMonth: currentMonthKey() });
    else if (type === "semiMonthly") onChange({ type, days: [15, "last"] });
    else if (type === "everyNWeeks") onChange({ type, n: 2, anchorDate: todayIso() });
    else onChange({ type, date: todayIso() });
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select aria-label="Schedule" value={value.type} onChange={(e) => setType(e.target.value as Recurrence["type"])} style={{ ...inputStyle, padding: "6px" }}>
        <option value="monthly">Monthly</option>
        <option value="semiMonthly">Twice a month</option>
        <option value="everyNMonths">Every few months</option>
        <option value="everyNWeeks">Every few weeks</option>
        <option value="once">Once</option>
      </select>
      {value.type === "monthly" && (
        <>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>on day</span>
          <DaySelect label="Day of month" value={value.day} onChange={(day) => onChange({ ...value, day })} />
        </>
      )}
      {value.type === "semiMonthly" && (
        <>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>on days</span>
          <DaySelect label="First day" value={value.days[0]} onChange={(d) => onChange({ ...value, days: [d, value.days[1]] })} />
          <DaySelect label="Second day" value={value.days[1]} onChange={(d) => onChange({ ...value, days: [value.days[0], d] })} />
        </>
      )}
      {value.type === "everyNMonths" && (
        <>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>every</span>
          <input aria-label="Months between" type="number" min={1} max={12} value={value.n} onChange={(e) => onChange({ ...value, n: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} style={{ ...inputStyle, width: 56 }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>months on day</span>
          <DaySelect label="Day of month" value={value.day} onChange={(day) => onChange({ ...value, day })} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>including</span>
          <input aria-label="A month it's due" type="month" value={value.anchorMonth} onChange={(e) => onChange({ ...value, anchorMonth: e.target.value })} style={{ ...inputStyle, padding: "5px" }} />
        </>
      )}
      {value.type === "everyNWeeks" && (
        <>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>every</span>
          <input aria-label="Weeks between" type="number" min={1} max={12} value={value.n} onChange={(e) => onChange({ ...value, n: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} style={{ ...inputStyle, width: 56 }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>weeks, including</span>
          <input aria-label="A date it's due" type="date" value={value.anchorDate} onChange={(e) => onChange({ ...value, anchorDate: e.target.value })} style={{ ...inputStyle, padding: "5px" }} />
        </>
      )}
      {value.type === "once" && <input aria-label="Date" type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} style={{ ...inputStyle, padding: "5px" }} />}
    </div>
  );
}

function ItemForm({ initial, onSave, onCancel, saveLabel, showApply }: { initial: Draft; onSave: (d: Draft, apply: boolean) => Promise<void>; onCancel: () => void; saveLabel: string; showApply: boolean }) {
  const [d, setD] = useState(initial);
  const [apply, setApply] = useState(false);
  const [saving, setSaving] = useState(false);
  const amount = parseMoneyInput(d.amount);
  const valid = d.name.trim() !== "" && amount !== null && amount >= 0 && recurrenceValid(d.recurrence);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel)" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ flex: "2 1 220px" }}>
          <div style={labelStyle}>Name</div>
          <input aria-label="Item name" value={d.name} onChange={(e) => set("name", e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </label>
        <label>
          <div style={labelStyle}>Type</div>
          <select
            aria-label="Item type"
            value={d.kind}
            onChange={(e) => {
              const kind = e.target.value as CashFlowKind;
              setD((prev) => ({ ...prev, kind, roll: kind === "deposit" ? "previous" : "next" }));
            }}
            style={{ ...inputStyle, padding: "7px" }}
          >
            <option value="bill">Bill (money out)</option>
            <option value="deposit">Deposit (money in)</option>
          </select>
        </label>
        <label>
          <div style={labelStyle}>Amount</div>
          <input aria-label="Item amount" value={d.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 110, fontFamily: "var(--mono)", textAlign: "right" }} />
        </label>
        <label>
          <div style={labelStyle}>Amount is</div>
          <select aria-label="Amount mode" value={d.amountMode} onChange={(e) => set("amountMode", e.target.value as Draft["amountMode"])} style={{ ...inputStyle, padding: "7px" }}>
            <option value="fixed">Fixed</option>
            <option value="variable">Variable (use last posted)</option>
          </select>
        </label>
      </div>
      <div>
        <div style={labelStyle}>Schedule</div>
        <RecurrenceEditor value={d.recurrence} onChange={(r) => set("recurrence", r)} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label>
          <div style={labelStyle}>On a weekend or holiday</div>
          <select aria-label="Business-day rule" value={d.roll} onChange={(e) => set("roll", e.target.value as RollRule)} style={{ ...inputStyle, padding: "7px" }}>
            {(Object.keys(ROLL_LABELS) as RollRule[]).map((r) => (
              <option key={r} value={r}>
                {ROLL_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div style={labelStyle}>Who completes it</div>
          <select aria-label="Who completes it" value={d.settlement} onChange={(e) => set("settlement", e.target.value as Settlement)} style={{ ...inputStyle, padding: "7px" }}>
            <option value="manual">You pay it (confirmation #)</option>
            <option value="auto">Automatic (AD)</option>
            <option value="external">Someone else (X)</option>
          </select>
        </label>
        <label>
          <div style={labelStyle}>Owner</div>
          <input aria-label="Owner" value={d.owner} onChange={(e) => set("owner", e.target.value)} placeholder="SR, KA…" style={{ ...inputStyle, width: 80 }} />
        </label>
        <label style={{ flex: "1 1 200px" }}>
          <div style={labelStyle}>Bank text to match</div>
          <input aria-label="Bank text to match" value={d.matchText} onChange={(e) => set("matchText", e.target.value)} placeholder="e.g. BC HYDRO" style={{ ...inputStyle, width: "100%", fontFamily: "var(--mono)" }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={d.dateUncertain} onChange={(e) => set("dateUncertain", e.target.checked)} />
          The date is an estimate
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} />
          Active (added to new months)
        </label>
        {showApply && (
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
            Also update this item&apos;s unpaid entries in months already started
          </label>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PrimaryButton
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            await onSave(d, apply).finally(() => setSaving(false));
          }}
        >
          {saveLabel}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    </div>
  );
}

function payload(d: Draft) {
  return {
    name: d.name.trim(),
    kind: d.kind,
    defaultAmount: parseMoneyInput(d.amount) ?? 0,
    amountMode: d.amountMode,
    recurrence: d.recurrence,
    roll: d.roll,
    settlement: d.settlement,
    dateUncertain: d.dateUncertain,
    owner: d.owner.trim(),
    matchText: d.matchText.trim(),
    active: d.active,
  };
}

export function RecurringItems({ appState, onReload, accountId }: { appState: AppState; onReload: () => Promise<void>; accountId: string }) {
  const pushToast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const items = appState.cashFlowItems.filter((i) => i.accountId === accountId);

  async function save(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      await onReload();
      pushToast(message);
      setEditing(null);
    } catch (err) {
      pushToast(errorMessage(err, "Couldn't save the item"));
    }
  }

  const sections: { title: string; list: CashFlowItem[] }[] = [
    { title: "Bills", list: items.filter((i) => i.kind === "bill" && i.active) },
    { title: "Deposits", list: items.filter((i) => i.kind === "deposit" && i.active) },
    { title: "Inactive", list: items.filter((i) => !i.active) },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <PageTitle>Recurring Items</PageTitle>
        <div style={{ marginLeft: "auto" }}>{editing !== "new" && <PrimaryButton onClick={() => setEditing("new")}>Add an item</PrimaryButton>}</div>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, maxWidth: 720 }}>
        Each new month gets these on their business-day dates. Editing an item changes the months you start from now on — past months keep what they had.
      </div>
      {editing === "new" && (
        <div style={{ marginBottom: 18 }}>
          <ItemForm
            initial={draftFrom()}
            saveLabel="Add item"
            showApply={false}
            onCancel={() => setEditing(null)}
            onSave={(d) => save(() => addCashFlowItem({ ...payload(d), accountId, owner: d.owner.trim() || undefined, matchText: d.matchText.trim() || undefined }), `Added ${d.name.trim()}`)}
          />
        </div>
      )}
      {items.length === 0 && editing !== "new" && <div style={{ color: "var(--muted)", fontSize: 13.5 }}>No recurring items yet. Add your bills and pay, or import your spreadsheet history to set them up from it.</div>}
      {sections
        .filter((s) => s.list.length > 0)
        .map((s) => (
          <div key={s.title} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14, overflowX: "auto" }}>
            <div style={{ padding: "12px 16px 4px", fontSize: 14, fontWeight: 600 }}>
              {s.title} · {s.list.length}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 16 }}>Name</th>
                  <th style={thStyle}>Schedule</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  <th style={thStyle}>Completed by</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {s.list
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((item) =>
                    editing === item.id ? (
                      <tr key={item.id}>
                        <td colSpan={5} style={{ padding: 10 }}>
                          <ItemForm
                            initial={draftFrom(item)}
                            saveLabel="Save changes"
                            showApply
                            onCancel={() => setEditing(null)}
                            onSave={(d, apply) => save(() => updateCashFlowItem(item.id, { ...payload(d), applyToOutstanding: apply }), `Saved ${d.name.trim()}`)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={item.id}>
                        <td style={{ ...tdStyle, paddingLeft: 16, fontWeight: 600 }}>
                          {item.name} {item.owner && <Tag>{item.owner}</Tag>} {item.dateUncertain && <Tag title="The date is an estimate">~date</Tag>}
                        </td>
                        <td style={tdStyle}>
                          {describeRecurrence(item.recurrence)}
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            {ROLL_LABELS[item.roll]} on weekends and holidays{item.matchText ? ` · matches “${item.matchText}”` : ""}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)" }}>
                          {fmtCurrency(item.defaultAmount)}
                          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-sans), sans-serif" }}>{item.amountMode === "variable" ? "varies" : "fixed"}</div>
                        </td>
                        <td style={tdStyle}>{SETTLEMENT_LABELS[item.settlement]}</td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap", textAlign: "right" }}>
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <SmallButton onClick={() => setEditing(item.id)}>Edit</SmallButton>
                            <ConfirmButton
                              label="Remove"
                              confirmLabel="Remove item"
                              title="Items with history are made inactive instead of deleted"
                              onConfirm={() =>
                                save(async () => {
                                  const r = await deleteCashFlowItem(item.id);
                                  if (r.deactivated) pushToast(`${item.name} has history, so it was made inactive`);
                                }, `Removed ${item.name}`)
                              }
                            />
                          </span>
                        </td>
                      </tr>
                    )
                  )}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
