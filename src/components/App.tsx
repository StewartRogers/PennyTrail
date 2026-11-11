"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/types";
import { fetchState } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { CashFlowMonthView } from "./cashflow/CashFlowMonthView";
import { RecurringItems } from "./cashflow/RecurringItems";
import { BankAccounts } from "./cashflow/BankAccounts";
import { BankImport } from "./cashflow/BankImport";
import { BankTransactions } from "./cashflow/BankTransactions";
import { AccountPicker, NoAccount, currentMonthKey } from "./cashflow/shared";
import { DrillDownModal, type DrillDown } from "./DrillDownModal";
import { ToastProvider } from "./ToastContext";
import { Dashboard } from "./Dashboard";
import { Averages } from "./Averages";
import { ImportWizard } from "./ImportWizard";
import { Transactions, type TxnFilterSeed } from "./Transactions";
import { Categories } from "./Categories";
import { Cards } from "./Cards";
import { Templates } from "./Templates";
import { VendorMappings } from "./VendorMappings";

export type Workspace = "cards" | "cashflow";

export type Screen =
  | "dashboard"
  | "averages"
  | "import"
  | "transactions"
  | "categories"
  | "vendors"
  | "cards"
  | "templates"
  | "cf-month"
  | "cf-bank"
  | "cf-import"
  | "cf-items"
  | "cf-accounts";

const HOME: Record<Workspace, Screen> = { cards: "dashboard", cashflow: "cf-month" };
const WORKSPACE_KEY = "pennytrail.workspace";

// The side last used is a per-browser convenience, so storage failing
// (private window, blocked site data) just means starting on Credit Cards.
function storedWorkspace(): Workspace {
  try {
    return window.localStorage.getItem(WORKSPACE_KEY) === "cashflow" ? "cashflow" : "cards";
  } catch {
    return "cards";
  }
}

function AppInner({ signOutEnabled }: { signOutEnabled: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace>("cards");
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [cfAccountId, setCfAccountId] = useState<string | null>(null);
  const [cfMonthKey, setCfMonthKey] = useState<string>(currentMonthKey);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const [txnSeed, setTxnSeed] = useState<{ n: number; filter: TxnFilterSeed }>({ n: 0, filter: {} });

  // Every screen shares this one reload, and mutations can fire in quick
  // succession, so responses can land out of order — a slow earlier fetch
  // resolving after a newer one used to overwrite fresh data with a stale
  // snapshot (change row A's type, then row B's, and B visibly snaps back).
  // Only the most recently issued reload is allowed to write.
  const reloadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++reloadToken.current;
    try {
      const state = await fetchState();
      if (token !== reloadToken.current) return;
      setAppState(state);
      setLoadError(null);
    } catch (err) {
      if (token !== reloadToken.current) return;
      setLoadError(err instanceof Error ? err.message : "Failed to load data");
    }
  }, []);

  const changeWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    setScreen(HOME[next]);
    try {
      window.localStorage.setItem(WORKSPACE_KEY, next);
    } catch {
      // Storage unavailable — the choice just isn't remembered.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((state) => {
        if (cancelled) return;
        setAppState(state);
        // Applied with the first data, while the loading screen still hides
        // the sidebar — the server render can't know what this browser stored.
        const stored = storedWorkspace();
        if (stored !== "cards") {
          setWorkspace(stored);
          setScreen(HOME[stored]);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load data");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const navigateToTransactions = useCallback((filter: TxnFilterSeed) => {
    setDrillDown(null);
    setTxnSeed((prev) => ({ n: prev.n + 1, filter }));
    setScreen("transactions");
  }, []);

  if (loadError && !appState) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        <div>Couldn&apos;t load your data: {loadError}</div>
        <button
          onClick={() => reload()}
          style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: 13 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!appState) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        Loading your data…
      </div>
    );
  }

  const pendingReviewCount = appState.transactions.filter((t) => t.needsReview).length;
  // The selected bank account, falling back to the first one (or none yet).
  const accountId = appState.bankAccounts.some((a) => a.id === cfAccountId) ? cfAccountId! : (appState.bankAccounts[0]?.id ?? null);
  const accountMonthIds = new Set(appState.cashFlowMonths.filter((m) => m.accountId === accountId).map((m) => m.id));
  const bankReview = appState.bankTransactions.filter((t) => t.accountId === accountId && t.needsReview).length;
  const footer =
    workspace === "cards"
      ? `${appState.cards.length} card${appState.cards.length === 1 ? "" : "s"} · ${appState.transactions.length} txn${appState.transactions.length === 1 ? "" : "s"}`
      : `${accountMonthIds.size} month${accountMonthIds.size === 1 ? "" : "s"} · ${appState.bankTransactions.length} bank line${appState.bankTransactions.length === 1 ? "" : "s"}`;
  const needsAccount = screen.startsWith("cf-") && screen !== "cf-accounts" && !accountId;

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      <Sidebar
        workspace={workspace}
        onWorkspaceChange={changeWorkspace}
        screen={screen}
        onNavigate={setScreen}
        badges={{ transactions: pendingReviewCount, "cf-bank": bankReview }}
        footer={footer}
        signOutEnabled={signOutEnabled}
      />

      <div style={{ flex: 1, minWidth: 0, padding: "32px 44px 100px", boxSizing: "border-box" }}>
        {/* A reload that fails *after* data has loaded once used to be
            invisible: the mutation's own success toast appeared over a table
            still showing the pre-change rows, so the change looked like it
            hadn't happened and users repeated it. Say so instead. */}
        {loadError && (
          <div
            role="alert"
            style={{
              marginBottom: 20,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface-2, transparent)",
              color: "var(--text)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>Showing data from before your last change — couldn&apos;t refresh: {loadError}</span>
            <button
              onClick={() => reload()}
              style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}
        {screen === "dashboard" && <Dashboard appState={appState} onDrillDown={setDrillDown} />}
        {screen === "averages" && <Averages appState={appState} onDrillDown={setDrillDown} />}
        {screen === "import" && <ImportWizard appState={appState} onReload={reload} onGoDashboard={() => setScreen("dashboard")} />}
        {screen === "transactions" && (
          <Transactions appState={appState} onReload={reload} seed={txnSeed.filter} seedKey={txnSeed.n} />
        )}
        {screen === "categories" && <Categories appState={appState} onReload={reload} />}
        {screen === "vendors" && (
          <VendorMappings appState={appState} onReload={reload} onNavigateToTransactions={navigateToTransactions} />
        )}
        {screen === "cards" && <Cards appState={appState} onReload={reload} />}
        {screen === "templates" && <Templates appState={appState} onReload={reload} />}

        {needsAccount && <NoAccount onGoAccounts={() => setScreen("cf-accounts")} />}
        {accountId && appState.bankAccounts.length > 1 && screen.startsWith("cf-") && screen !== "cf-accounts" && (
          <div style={{ marginBottom: 12 }}>
            <AccountPicker accounts={appState.bankAccounts} value={accountId} onChange={setCfAccountId} />
          </div>
        )}
        {accountId && screen === "cf-month" && (
          <CashFlowMonthView appState={appState} onReload={reload} accountId={accountId} monthKey={cfMonthKey} onMonthKeyChange={setCfMonthKey} />
        )}
        {accountId && screen === "cf-bank" && <BankTransactions appState={appState} onReload={reload} accountId={accountId} />}
        {accountId && screen === "cf-import" && <BankImport appState={appState} onReload={reload} accountId={accountId} onGoTransactions={() => setScreen("cf-bank")} />}
        {accountId && screen === "cf-items" && <RecurringItems appState={appState} onReload={reload} accountId={accountId} />}
        {screen === "cf-accounts" && <BankAccounts appState={appState} onReload={reload} />}
      </div>

      {drillDown && (
        <DrillDownModal
          drillDown={drillDown}
          cards={appState.cards}
          childVendors={appState.childVendors}
          onClose={() => setDrillDown(null)}
          onViewAll={() => navigateToTransactions(drillDown.viewAllFilter ?? {})}
        />
      )}
    </div>
  );
}

export default function App({ signOutEnabled = false }: { signOutEnabled?: boolean }) {
  return (
    <ToastProvider>
      <AppInner signOutEnabled={signOutEnabled} />
    </ToastProvider>
  );
}
