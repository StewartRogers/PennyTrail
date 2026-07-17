"use client";

import type { Card, ChildVendor, Transaction } from "@/lib/types";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { netAmountForTransaction, vendorNameForTransaction } from "@/lib/vendors";
import type { TxnFilterSeed } from "./Transactions";

export interface DrillDown {
  title: string;
  subtitle: string;
  transactions: Transaction[];
  viewAllFilter?: TxnFilterSeed;
}

export function DrillDownModal({
  drillDown,
  cards,
  childVendors,
  onClose,
  onViewAll,
}: {
  drillDown: DrillDown;
  cards: Card[];
  childVendors: ChildVendor[];
  onClose: () => void;
  onViewAll: () => void;
}) {
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const childById = new Map(childVendors.map((c) => [c.id, c]));

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
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 640,
          maxHeight: "80vh",
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
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{drillDown.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{drillDown.subtitle}</div>
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: 18, color: "var(--muted)", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "6px 22px" }}>
          {drillDown.transactions.map((t) => {
            const card = cardById.get(t.cardId);
            return (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {vendorNameForTransaction(t, childById) || "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {fmtDateShort(t.date)} · {card ? card.name : "—"}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13.5, flexShrink: 0 }}>
                  {fmtCurrency(netAmountForTransaction(t))}
                </div>
              </div>
            );
          })}
          {drillDown.transactions.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "20px 0" }}>No transactions found.</div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onViewAll}
            style={{
              width: "100%",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--accent)",
            }}
          >
            View all in Transactions →
          </button>
        </div>
      </div>
    </div>
  );
}
