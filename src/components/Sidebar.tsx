"use client";

import type { CSSProperties } from "react";
import type { Screen } from "./App";

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: "dashboard", label: "Dashboard" },
  { screen: "import", label: "Import CSV" },
  { screen: "transactions", label: "Transactions" },
  { screen: "categories", label: "Categories" },
  { screen: "cards", label: "Cards" },
  { screen: "templates", label: "Import Templates" },
];

export function Sidebar({
  screen,
  onNavigate,
  pendingReviewCount,
  cardCount,
  txnCount,
}: {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  pendingReviewCount: number;
  cardCount: number;
  txnCount: number;
}) {
  const navStyle = (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    textAlign: "left",
    border: "none",
    background: active ? "oklch(0.55 0.15 250 / 0.1)" : "transparent",
    color: active ? "var(--accent)" : "var(--text)",
    fontWeight: active ? 600 : 500,
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
  });

  return (
    <div
      style={{
        width: 232,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        padding: "24px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", padding: "2px 10px 22px" }}>
        PennyTrail
      </div>

      {NAV_ITEMS.map((item) => (
        <button key={item.screen} onClick={() => onNavigate(item.screen)} style={navStyle(screen === item.screen)}>
          <span>{item.label}</span>
          {item.screen === "transactions" && pendingReviewCount > 0 && (
            <span
              style={{
                background: "var(--attention)",
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 20,
                padding: "1px 7px",
                fontFamily: "var(--mono)",
              }}
            >
              {pendingReviewCount}
            </span>
          )}
        </button>
      ))}

      <div
        style={{
          marginTop: "auto",
          padding: "12px 10px 0",
          fontSize: 11.5,
          color: "var(--muted)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ paddingTop: 12 }}>
          {cardCount} card{cardCount === 1 ? "" : "s"} · {txnCount} txn{txnCount === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}
