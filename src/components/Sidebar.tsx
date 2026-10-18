"use client";

import type { CSSProperties } from "react";
import type { Screen, Workspace } from "./App";

const NAV_ITEMS: Record<Workspace, { screen: Screen; label: string }[]> = {
  cards: [
    { screen: "dashboard", label: "Dashboard" },
    { screen: "averages", label: "Averages" },
    { screen: "import", label: "Import CSV" },
    { screen: "transactions", label: "Transactions" },
    { screen: "cards", label: "Cards" },
    { screen: "templates", label: "Import Templates" },
  ],
  cashflow: [
    { screen: "cf-month", label: "This Month" },
    { screen: "cf-upcoming", label: "Upcoming" },
    { screen: "cf-spending", label: "Spending" },
    { screen: "cf-bank", label: "Bank Transactions" },
    { screen: "cf-import", label: "Import Bank CSV" },
    { screen: "cf-items", label: "Recurring Items" },
    { screen: "cf-history", label: "History" },
    { screen: "cf-accounts", label: "Accounts" },
  ],
};

// Vendors and categories are one system: debit purchases file under the same
// ones as card purchases, so these sit outside either side.
const SHARED_ITEMS: { screen: Screen; label: string }[] = [
  { screen: "categories", label: "Categories" },
  { screen: "vendors", label: "Vendor Mappings" },
];

export function Sidebar({
  workspace,
  onWorkspaceChange,
  screen,
  onNavigate,
  badges,
  footer,
  signOutEnabled = false,
}: {
  workspace: Workspace;
  onWorkspaceChange: (w: Workspace) => void;
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  badges: Partial<Record<Screen, number>>;
  footer: string;
  signOutEnabled?: boolean;
}) {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // A full page load rather than a client-side route change, so none of the
    // financial data the app had loaded survives in memory after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

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

  const switchStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    border: "none",
    background: active ? "var(--accent)" : "transparent",
    color: active ? "white" : "var(--text)",
    padding: "7px 6px",
    fontSize: 12.5,
    fontWeight: 600,
  });

  const navButton = (item: { screen: Screen; label: string }) => {
    const badge = badges[item.screen] ?? 0;
    return (
      <button key={item.screen} onClick={() => onNavigate(item.screen)} style={navStyle(screen === item.screen)}>
        <span>{item.label}</span>
        {badge > 0 && (
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
            {badge}
          </span>
        )}
      </button>
    );
  };

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
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", padding: "2px 10px 16px" }}>PennyTrail</div>

      <div role="tablist" aria-label="Workspace" style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", margin: "0 4px 14px" }}>
        <button role="tab" aria-selected={workspace === "cards"} onClick={() => onWorkspaceChange("cards")} style={switchStyle(workspace === "cards")}>
          Credit Cards
        </button>
        <button role="tab" aria-selected={workspace === "cashflow"} onClick={() => onWorkspaceChange("cashflow")} style={switchStyle(workspace === "cashflow")}>
          Cash Flow
        </button>
      </div>

      {NAV_ITEMS[workspace].map(navButton)}

      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "16px 10px 4px" }}>Shared</div>
      {SHARED_ITEMS.map(navButton)}

      <div
        style={{
          marginTop: "auto",
          padding: "12px 10px 0",
          fontSize: 11.5,
          color: "var(--muted)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ paddingTop: 12 }}>{footer}</div>
        {signOutEnabled && (
          <button
            onClick={signOut}
            style={{ border: "none", background: "transparent", color: "var(--muted)", padding: "8px 0 0", fontSize: 11.5, textDecoration: "underline" }}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
