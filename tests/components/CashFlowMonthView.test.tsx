/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CashFlowMonthView } from "@/components/cashflow/CashFlowMonthView";
import { ToastProvider } from "@/components/ToastContext";
import { startCashFlowMonth, updateCashFlowEntry, updateCashFlowMonth } from "@/lib/api";
import type { AppState, BankAccount, CashFlowEntry, CashFlowMonth } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  addCashFlowEntry: vi.fn(),
  deleteCashFlowEntry: vi.fn(),
  deleteCashFlowMonth: vi.fn(),
  startCashFlowMonth: vi.fn().mockResolvedValue({}),
  updateCashFlowEntry: vi.fn().mockResolvedValue({}),
  updateCashFlowMonth: vi.fn().mockResolvedValue({}),
}));

const account: BankAccount = { id: "acct", name: "Chequing", institution: "Bank", last4: "0000", color: "red", dailySpendRate: 50, bankHolidays: [] };

function october(): { month: CashFlowMonth; entries: CashFlowEntry[] } {
  const month: CashFlowMonth = {
    id: "m_oct",
    accountId: "acct",
    month: "2026-10",
    openingBalance: 10000,
    openingSource: "manual",
    dailySpendRate: 50,
    periods: [
      { id: "p1", endDate: "2026-10-02", label: "End of week", actualBalance: 11150.01 },
      { id: "p2", endDate: "2026-10-09", label: "End of week" },
      { id: "p3", endDate: "2026-10-31", label: "End of month" },
    ],
    closed: false,
  };
  const e = (o: Partial<CashFlowEntry>): CashFlowEntry => ({ id: o.name!, monthId: "m_oct", itemId: "item", name: "", kind: "bill", dueDate: o.postingDate!, postingDate: "2026-10-01", expectedAmount: 0, status: "planned", ...o });
  const entries = [
    e({ name: "Rent", expectedAmount: 1500, postingDate: "2026-10-01", dueDate: "2026-09-30", status: "posted", postedDate: "2026-10-01" }),
    e({ name: "SR pay", kind: "deposit", expectedAmount: 3000.5, postingDate: "2026-10-01", status: "posted", settlement: "auto" }),
    e({ name: "CIBC", expectedAmount: 200, actualAmount: 222.47, postingDate: "2026-10-01", status: "posted" }),
    e({ name: "Insurance", expectedAmount: 28.92, postingDate: "2026-10-09", status: "posted" }),
    e({ name: "Simplii", expectedAmount: 754.3, postingDate: "2026-10-09", status: "scheduled", confirmationCode: "104238" }),
    e({ name: "Hydro", expectedAmount: 188.77, postingDate: "2026-10-23" }),
  ];
  return { month, entries };
}

function renderView(appState: AppState, monthKey = "2026-10", onMonthKeyChange = vi.fn()) {
  const onReload = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <CashFlowMonthView appState={appState} onReload={onReload} accountId="acct" monthKey={monthKey} onMonthKeyChange={onMonthKeyChange} onGoHistory={vi.fn()} />
    </ToastProvider>
  );
  return { onReload, onMonthKeyChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CashFlowMonthView", () => {
  it("shows each period with its Weekly Spend, rows, and checkpoint", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getAllByText("Weekly Spend")).toHaveLength(3);
    expect(screen.getByText("$50.00/day × 2")).toBeInTheDocument();
    expect(screen.getByText("$50.00/day × 22")).toBeInTheDocument();
    expect(screen.getAllByText("END OF WEEK")).toHaveLength(2);
    expect(screen.getByText("END OF MONTH")).toBeInTheDocument();
    // P1: 10,000 − 100 − 1,500 + 3,000.50 − 222.47 = 11,178.03 projected; actual 11,150.01.
    expect(screen.getByText("$11,178.03", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("-$28.02")).toBeInTheDocument();
  });

  it("shows the month's totals: projected end, lowest point ahead, and unpaid bills", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    // P2 from 11,150.01: −350 −28.92 −754.30 = 10,016.79; P3: −1,100 = 8,916.79, then
    // Hydro −188.77 on Fri Oct 23 = 8,728.02 — the low point, and the month end.
    expect(screen.getByText("Projected month end").parentElement).toHaveTextContent("$8,728.02");
    expect(screen.getByText("Lowest balance ahead").parentElement).toHaveTextContent("$8,728.02Fri, Oct 23");
    expect(screen.getByText("Unpaid bills").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Unpaid bills").parentElement).toHaveTextContent("$943.07");
  });

  it("warns when the low point is below the account's threshold", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [{ ...account, lowBalanceThreshold: 9000 }], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.getByText("Lowest balance ahead").parentElement).toHaveTextContent("below $9,000.00");
  });

  it("shows the nominal due date when a payment rolled", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.getByText("due Sep 30")).toBeInTheDocument();
  });

  it("records a checkpoint balance", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Actual balance at 2026-10-09");
    fireEvent.change(input, { target: { value: "$10,000.50" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { periods: [{ id: "p2", actualBalance: 10000.5 }] }));
  });

  it("clears a checkpoint when its field is emptied", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Actual balance at 2026-10-02");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { periods: [{ id: "p1", actualBalance: null }] }));
  });

  it("doesn't save an unchanged or unreadable amount", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Actual balance at 2026-10-02");
    fireEvent.change(input, { target: { value: "11150.01" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "lots" } });
    fireEvent.blur(input);
    await Promise.resolve();
    expect(updateCashFlowMonth).not.toHaveBeenCalled();
  });

  it("changes an entry's status", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.change(screen.getByLabelText("Status of Hydro"), { target: { value: "posted" } });
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { status: "posted" }));
  });

  it("entering a confirmation number on a planned bill schedules it", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Confirmation number of Hydro");
    fireEvent.change(input, { target: { value: "136266" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { confirmationCode: "136266", status: "scheduled" }));
  });

  it("marks an overdue entry", () => {
    const { month, entries } = october();
    entries.push({ id: "late", monthId: "m_oct", itemId: null, name: "Late bill", kind: "bill", dueDate: "2026-10-12", postingDate: "2026-10-12", expectedAmount: 10, status: "planned" });
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const status = screen.getByLabelText("Status of Late bill") as HTMLSelectElement;
    expect(within(status).getByText("Planned — overdue")).toBeInTheDocument();
    // Simplii, scheduled for Oct 9 but not posted, is overdue too: done means posted.
    expect(screen.getByText("Unpaid bills").parentElement).toHaveTextContent("2 overdue");
  });

  it("offers to start a month that doesn't exist, carrying the previous close", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }), "2026-11");
    expect(screen.getByText(/November 2026 hasn.t been started/)).toBeInTheDocument();
    expect(screen.getByText(/Leave blank to carry \$8,728\.02/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start November 2026" }));
    await waitFor(() => expect(startCashFlowMonth).toHaveBeenCalledWith({ accountId: "acct", month: "2026-11" }));
  });

  it("requires an opening balance for the first month", async () => {
    renderView(makeAppState({ bankAccounts: [account] }), "2026-10");
    const start = screen.getByRole("button", { name: "Start October 2026" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Opening balance"), { target: { value: "41,053.36" } });
    fireEvent.click(start);
    await waitFor(() => expect(startCashFlowMonth).toHaveBeenCalledWith({ accountId: "acct", month: "2026-10", openingBalance: 41053.36 }));
  });

  it("moves between months", () => {
    const { month, entries } = october();
    const { onMonthKeyChange } = renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByTitle("Next month"));
    expect(onMonthKeyChange).toHaveBeenCalledWith("2026-11");
    fireEvent.click(screen.getByTitle("Previous month"));
    expect(onMonthKeyChange).toHaveBeenCalledWith("2026-09");
  });
});
