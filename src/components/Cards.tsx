"use client";

import { useMemo, useState } from "react";
import type { AppState, Network } from "@/lib/types";
import { addCard, updateCard } from "@/lib/api";
import { fmtCurrency } from "@/lib/format";
import { netAmountForTransaction } from "@/lib/vendors";
import { useToast } from "./ToastContext";
import { PageTitle, PrimaryButton, inputStyle } from "./ui";

function NetworkToggle({ value, onChange }: { value: Network; onChange: (n: Network) => void }) {
  const btn = (active: boolean) => ({
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 600,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "white" : "var(--text)",
  });
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button style={btn(value === "Visa")} onClick={() => onChange("Visa")}>
        Visa
      </button>
      <button style={btn(value === "Mastercard")} onClick={() => onChange("Mastercard")}>
        Mastercard
      </button>
    </div>
  );
}

export function Cards({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [last4, setLast4] = useState("");
  const [network, setNetwork] = useState<Network>("Visa");
  const [currency, setCurrency] = useState("");

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of appState.transactions) {
      if (t.type !== "purchase") continue;
      map.set(t.cardId, (map.get(t.cardId) || 0) + netAmountForTransaction(t));
    }
    return map;
  }, [appState.transactions]);

  async function handleAdd() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      await addCard({ name: trimmedName, bank: bank.trim(), last4: last4.trim(), network, currency: currency.trim() });
      setName("");
      setBank("");
      setLast4("");
      setNetwork("Visa");
      setCurrency("");
      await onReload();
      pushToast(`Added card "${trimmedName}"`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to add card");
    }
  }

  // Uncontrolled inputs: without `revert`, a rejected edit left the typed
  // value displayed indefinitely even though nothing was saved.
  async function commitCardField(id: string, patch: Parameters<typeof updateCard>[1], revert: () => void) {
    try {
      await updateCard(id, patch);
      await onReload();
    } catch (err) {
      revert();
      pushToast(err instanceof Error ? err.message : "Failed to update card");
    }
  }

  return (
    <div>
      <PageTitle>Cards</PageTitle>

      <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px", maxWidth: 480, marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>+ Add a card</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Card nickname" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Bank" style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
          <input value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="Last 4" style={{ ...inputStyle, width: 70 }} />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="CAD"
            maxLength={3}
            title="Statement currency — leave as CAD unless this card bills in something else"
            style={{ ...inputStyle, width: 60, textTransform: "uppercase" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <NetworkToggle value={network} onChange={setNetwork} />
          <div style={{ marginLeft: "auto" }}>
            <PrimaryButton onClick={handleAdd}>Add Card</PrimaryButton>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680, marginBottom: 22 }}>
        {appState.cards.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "12px 16px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
            <input
              key={"name:" + c.id + c.name}
              defaultValue={c.name}
              onBlur={(e) => {
                const target = e.target;
                const value = target.value.trim();
                if (value && value !== c.name) {
                  commitCardField(c.id, { name: value }, () => {
                    target.value = c.name;
                  });
                } else {
                  target.value = c.name;
                }
              }}
              className="inline-editable"
              title="Click to rename"
              style={{
                flex: "2 1 210px",
                minWidth: 210,
                background: "transparent",
                fontSize: 14,
                fontWeight: 500,
                padding: "5px 6px",
                borderRadius: 6,
              }}
            />
            <input
              key={"bank:" + c.id + c.bank}
              defaultValue={c.bank}
              onBlur={(e) => {
                const target = e.target;
                const value = target.value.trim();
                if (value !== c.bank) {
                  commitCardField(c.id, { bank: value }, () => {
                    target.value = c.bank;
                  });
                }
              }}
              className="inline-editable"
              title="Click to edit bank name"
              style={{
                flex: "1 1 120px",
                minWidth: 110,
                background: "transparent",
                fontSize: 13,
                color: "var(--muted)",
                padding: "5px 6px",
                borderRadius: 6,
              }}
            />
            <input
              key={"currency:" + c.id + (c.currency || "CAD")}
              defaultValue={c.currency || "CAD"}
              onBlur={(e) => {
                const target = e.target;
                const value = target.value.trim().toUpperCase();
                if (value && value !== (c.currency || "CAD")) {
                  commitCardField(c.id, { currency: value }, () => {
                    target.value = c.currency || "CAD";
                  });
                } else {
                  target.value = c.currency || "CAD";
                }
              }}
              maxLength={3}
              className="inline-editable"
              title="Statement currency — transactions imported for this card are converted to CAD using the Bank of Canada's daily rate"
              style={{
                width: 40,
                background: "transparent",
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                padding: "5px 6px",
                borderRadius: 6,
                textAlign: "center",
                textTransform: "uppercase",
              }}
            />
            {/* The network toggle is driven by props, so a failed save
                re-renders back to the stored value on its own. */}
            <NetworkToggle value={c.network} onChange={(n) => commitCardField(c.id, { network: n }, () => {})} />
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)" }}>····{c.last4}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, marginLeft: "auto" }}>
              {fmtCurrency(totals.get(c.id) || 0)} spent
            </div>
          </div>
        ))}
        {appState.cards.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13.5 }}>No cards yet — add one above.</div>}
      </div>
    </div>
  );
}
