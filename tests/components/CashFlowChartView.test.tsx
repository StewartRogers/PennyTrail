/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CashFlowChartView } from "@/components/cashflow/CashFlowChartView";
import type { AppState, BankAccount, CashFlowEntry, CashFlowMonth } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

const account: BankAccount = { id: "acct", name: "Chequing", institution: "Bank", last4: "0000", color: "red", dailySpendRate: 50, bankHolidays: [] };

// The same October as the This Month tests: P1 recorded at 11,150.01
// against 11,178.03 projected, so its Weekly Spend implies 128.02.
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
  const e = (o: Partial<CashFlowEntry>): CashFlowEntry => ({ id: o.name!, monthId: "m_oct", itemId: "item", name: "", kind: "bill", dueDate: o.postingDate!, postingDate: "2026-10-01", expectedAmount: 0, status: "projected", ...o });
  const entries = [
    e({ name: "Rent (first)", expectedAmount: 750, status: "actual" }),
    e({ name: "Rent (second)", expectedAmount: 750, status: "actual" }),
    e({ name: "SR pay", kind: "deposit", expectedAmount: 3000.5, status: "actual" }),
    e({ name: "CIBC", expectedAmount: 200, actualAmount: 222.47, status: "actual" }),
    e({ name: "Insurance", expectedAmount: 28.92, postingDate: "2026-10-09", status: "actual" }),
    e({ name: "Simplii", expectedAmount: 754.3, postingDate: "2026-10-09" }),
    e({ name: "Hydro", expectedAmount: 188.77, postingDate: "2026-10-23" }),
    e({ name: "Netflix", expectedAmount: 20, postingDate: "2026-10-23", status: "skipped" }),
  ];
  return { month, entries };
}

function renderView(appState: AppState, monthKey = "2026-10") {
  const onMonthKeyChange = vi.fn();
  const onGoMonth = vi.fn();
  render(<CashFlowChartView appState={appState} accountId="acct" monthKey={monthKey} onMonthKeyChange={onMonthKeyChange} onGoMonth={onGoMonth} />);
  return { onMonthKeyChange, onGoMonth };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CashFlowChartView", () => {
  it("shows opening, deposits, withdrawals, and closing as tiles that add up", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.getByTestId("tile-Opening balance")).toHaveTextContent("$10,000.00");
    expect(screen.getByTestId("tile-Deposits")).toHaveTextContent("$3,000.50");
    // 1,578.02 Weekly Spend + 1,500 rent + 754.30 + 222.47 + 188.77 + 28.92.
    expect(screen.getByTestId("tile-Withdrawals")).toHaveTextContent("$4,272.48");
    expect(screen.getByTestId("tile-Closing balance")).toHaveTextContent("$8,728.02");
    expect(screen.getByTestId("tile-Closing balance").parentElement).toHaveTextContent(/projected$/);
    expect(screen.getByText(/Chequing · as of Sun, Oct 18/)).toBeInTheDocument();
  });

  it("charts deposits first, then withdrawals, merging the parts of one bill", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const chart = screen.getByRole("region", { name: "Deposits and withdrawals" });
    const columns = Array.from(chart.querySelectorAll("[data-column]")).map((el) => el.getAttribute("data-column"));
    expect(columns).toEqual(["SR pay", "Weekly Spend", "Rent", "Simplii", "CIBC", "Hydro", "Insurance"]);
  });

  it("labels every column with its amount", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const chart = screen.getByRole("region", { name: "Deposits and withdrawals" });
    const labels = Array.from(chart.querySelectorAll("[data-value]")).map((el) => `${el.getAttribute("data-value")} ${el.textContent}`);
    expect(labels).toEqual(["SR pay $3,001", "Weekly Spend $1,578", "Rent $1,500", "Simplii $754", "CIBC $222", "Hydro $189", "Insurance $29"]);
  });

  it("shows a column's split on hover", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const chart = screen.getByRole("region", { name: "Deposits and withdrawals" });
    fireEvent.mouseEnter(chart.querySelector('[data-column="Weekly Spend"]')!);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("−$1,578.02");
    expect(tip).toHaveTextContent("From recorded balances$128.02");
    expect(tip).toHaveTextContent("Estimated$1,450.00");
    expect(tip).toHaveTextContent("3 periods");
  });

  it("lists the columns with their amounts, for reading on paper", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const withdrawals = screen.getByRole("region", { name: "Withdrawals" });
    const rows = within(withdrawals).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual([
      "Weekly Spendincl. $1,450.00 estimated$1,578.02",
      "Rent×2$1,500.00",
      "Simpliiprojected$754.30",
      "CIBC$222.47",
      "Hydroprojected$188.77",
      "Insurance$28.92",
      "Total$4,272.48",
    ]);
    expect(within(screen.getByRole("region", { name: "Deposits" })).getAllByRole("row").map((r) => r.textContent)).toEqual(["SR pay$3,000.50", "Total$3,000.50"]);
  });

  it("prints the page", () => {
    const { month, entries } = october();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalled();
  });

  it("moves between months with the shared picker", () => {
    const { month, entries } = october();
    const { onMonthKeyChange } = renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByTitle("Next month"));
    expect(onMonthKeyChange).toHaveBeenCalledWith("2026-11");
  });

  it("sends a month that isn't started to This Month", () => {
    const { month, entries } = october();
    const { onGoMonth } = renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }), "2026-11");
    expect(screen.getByText("November 2026 hasn't been started")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to This Month" }));
    expect(onGoMonth).toHaveBeenCalled();
  });
});
