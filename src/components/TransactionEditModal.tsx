"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card, ParentVendor, Transaction, TxnType } from "@/lib/types";
import { cleanVendorName } from "@/lib/classify";
import { fmtDateShort } from "@/lib/format";
import { TYPE_META } from "@/lib/categories";
import { inputStyle, labelStyle, PrimaryButton, SecondaryButton } from "./ui";

export interface TransactionEditPatch {
  date: string;
  amount: number;
  type: TxnType;
  reimbursedAmount: number | null;
  excludeFromDashboard: boolean;
  conversionNote: string;
  parentId?: string;
  newParentName?: string;
  category?: string;
}

export function TransactionEditModal({
  txn,
  card,
  currentParentId,
  currentVendorName,
  parents,
  categories,
  onClose,
  onSave,
}: {
  txn: Transaction;
  card: Card | undefined;
  currentParentId: string | null;
  currentVendorName: string | null;
  parents: ParentVendor[];
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSave: (patch: TransactionEditPatch) => Promise<string | null>;
}) {
  const [date, setDate] = useState(txn.date);
  const [type, setType] = useState<TxnType>(txn.type);
  const [amount, setAmount] = useState(txn.amount.toFixed(2));
  const [reimbursed, setReimbursed] = useState(txn.reimbursedAmount != null ? txn.reimbursedAmount.toFixed(2) : "");
  const [excludeFromDashboard, setExcludeFromDashboard] = useState(!!txn.excludeFromDashboard);
  const [conversionNote, setConversionNote] = useState(txn.conversionNote ?? "");
  const [vendorMode, setVendorMode] = useState<"existing" | "new">("existing");
  const [selectedParentId, setSelectedParentId] = useState(currentParentId ?? "");
  const [newVendorName, setNewVendorName] = useState(currentVendorName || cleanVendorName(txn.rawDescription));
  const [newVendorCategory, setNewVendorCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const selectedParentCategoryName = useMemo(() => {
    const parent = parents.find((p) => p.id === selectedParentId);
    return parent ? categoryById.get(parent.category)?.name ?? null : null;
  }, [parents, selectedParentId, categoryById]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const parsedReimbursed = reimbursed.trim() === "" ? null : Number(reimbursed);
  const reimbursedValid = parsedReimbursed === null || (Number.isFinite(parsedReimbursed) && parsedReimbursed >= 0 && parsedReimbursed <= parsedAmount);
  const vendorValid = vendorMode === "existing" || (newVendorName.trim() !== "" && newVendorCategory !== "");
  const canSave = !!date && amountValid && reimbursedValid && vendorValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const patch: TransactionEditPatch = {
      date,
      amount: parsedAmount,
      type,
      reimbursedAmount: parsedReimbursed,
      excludeFromDashboard,
      conversionNote,
    };
    if (vendorMode === "new") {
      patch.newParentName = newVendorName.trim();
      patch.category = newVendorCategory;
    } else if (selectedParentId) {
      patch.parentId = selectedParentId;
    }
    const errMsg = await onSave(patch);
    setSaving(false);
    if (errMsg) {
      setError(errMsg);
    } else {
      onClose();
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit transaction"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 460,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "18px 22px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Edit Transaction</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {card ? card.name : "—"} · {fmtDateShort(txn.date)} · {txn.rawDescription.trim() || "(no description)"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: 18, color: "var(--muted)", lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Type</div>
              <select value={type} onChange={(e) => setType(e.target.value as TxnType)} style={{ ...inputStyle, width: "100%" }}>
                {(Object.keys(TYPE_META) as TxnType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Amount</div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Reimbursed (optional)</div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={reimbursed}
                onChange={(e) => setReimbursed(e.target.value)}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
            </div>
          </div>
          {!reimbursedValid && (
            <div style={{ fontSize: 11.5, color: "var(--attention)", marginTop: -10 }}>Reimbursed amount can&apos;t exceed the amount.</div>
          )}

          <div>
            <div style={labelStyle}>Parent</div>
            {vendorMode === "existing" ? (
              <>
                <select
                  value={selectedParentId}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setVendorMode("new");
                    } else {
                      setSelectedParentId(e.target.value);
                    }
                  }}
                  style={{ ...inputStyle, width: "100%" }}
                >
                  <option value="">— Unassigned —</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__new__">+ Create new vendor…</option>
                </select>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>
                  Category: {selectedParentCategoryName || "—"}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="Vendor name"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                />
                <select value={newVendorCategory} onChange={(e) => setNewVendorCategory(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">— Choose a category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setVendorMode("existing")}
                  style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 12.5, textAlign: "left", padding: 0 }}
                >
                  ← Choose an existing vendor instead
                </button>
              </div>
            )}
          </div>

          <div>
            <div style={labelStyle}>Conversion Notes (optional)</div>
            <textarea
              value={conversionNote}
              onChange={(e) => setConversionNote(e.target.value)}
              placeholder="e.g. original amount and exchange rate for a foreign-currency purchase"
              rows={2}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={excludeFromDashboard} onChange={(e) => setExcludeFromDashboard(e.target.checked)} />
            Exclude this transaction from Dashboard &amp; Averages
          </label>

          {error && <div style={{ fontSize: 12.5, color: "var(--attention)" }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 22px", borderTop: "1px solid var(--border)" }}>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
