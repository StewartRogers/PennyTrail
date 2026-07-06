"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppState } from "@/lib/types";
import { fetchState } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { DrillDownModal, type DrillDown } from "./DrillDownModal";
import { ToastProvider } from "./ToastContext";
import { Dashboard } from "./Dashboard";
import { ImportWizard } from "./ImportWizard";
import { Transactions, type TxnFilterSeed } from "./Transactions";
import { Categories } from "./Categories";
import { Cards } from "./Cards";
import { Templates } from "./Templates";
import { VendorMappings } from "./VendorMappings";

export type Screen = "dashboard" | "import" | "transactions" | "categories" | "vendors" | "cards" | "templates";

function AppInner() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [appState, setAppState] = useState<AppState | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const [txnSeed, setTxnSeed] = useState<{ n: number; filter: TxnFilterSeed }>({ n: 0, filter: {} });

  const reload = useCallback(async () => {
    const state = await fetchState();
    setAppState(state);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((state) => {
      if (!cancelled) setAppState(state);
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

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      <Sidebar
        screen={screen}
        onNavigate={setScreen}
        pendingReviewCount={pendingReviewCount}
        cardCount={appState.cards.length}
        txnCount={appState.transactions.length}
      />

      <div style={{ flex: 1, minWidth: 0, padding: "32px 44px 100px", boxSizing: "border-box" }}>
        {screen === "dashboard" && <Dashboard appState={appState} onDrillDown={setDrillDown} />}
        {screen === "import" && <ImportWizard appState={appState} onReload={reload} onGoDashboard={() => setScreen("dashboard")} />}
        {screen === "transactions" && (
          <Transactions appState={appState} onReload={reload} seed={txnSeed.filter} seedKey={txnSeed.n} />
        )}
        {screen === "categories" && <Categories appState={appState} onReload={reload} />}
        {screen === "vendors" && <VendorMappings appState={appState} onReload={reload} />}
        {screen === "cards" && <Cards appState={appState} onReload={reload} />}
        {screen === "templates" && <Templates appState={appState} onReload={reload} />}
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

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
