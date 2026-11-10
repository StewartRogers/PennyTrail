/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CashFlowMonthView } from "@/components/cashflow/CashFlowMonthView";
import { ToastProvider } from "@/components/ToastContext";
import { addCashFlowEntry, startCashFlowMonth, updateCashFlowEntry, updateCashFlowMonth } from "@/lib/api";
import type { AppState, BankAccount, CashFlowEntry, CashFlowMonth } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  addCashFlowEntry: vi.fn().mockResolvedValue({}),
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
    // The checkpoint shows the recorded balance only — no projected or variance line.
    expect((screen.getByLabelText("Actual balance at 2026-10-02") as HTMLInputElement).value).toBe("11150.01");
    expect(screen.queryByText(/Projected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vs projected/)).not.toBeInTheDocument();
  });

  it("keeps the table to item, date, credit, debit, status, confirmation, and balance", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const headers = within(screen.getAllByRole("table")[0])
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Item", "Date", "Credit", "Debit", "Status", "Confirmation #", "Balance", ""]);
  });

  it("puts bills under CREDIT and deposits under DEBIT, as the spreadsheet does", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const cellIndex = (label: string) => {
      const cell = screen.getByLabelText(label).closest("td")!;
      return Array.from(cell.parentElement!.children).indexOf(cell);
    };
    expect(cellIndex("Amount of Hydro")).toBe(2);
    expect(cellIndex("Weekly Spend for the period ending 2026-10-02")).toBe(2);
    expect(cellIndex("Amount of SR pay")).toBe(3);
  });

  it("shows one amount per entry, the actual once there is one", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect((screen.getByLabelText("Amount of Hydro") as HTMLInputElement).value).toBe("188.77");
    expect((screen.getByLabelText("Amount of CIBC") as HTMLInputElement).value).toBe("222.47");
    expect(screen.queryByLabelText(/Projected amount/)).not.toBeInTheDocument();
  });

  it("saves a pasted amount as the entry's amount", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const cibc = screen.getByLabelText("Amount of CIBC");
    fireEvent.change(cibc, { target: { value: "$201.10" } });
    fireEvent.blur(cibc);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("CIBC", { expectedAmount: 201.1, actualAmount: null }));
  });

  it("has no summary tiles above the periods", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    for (const label of ["Projected month end", "Closing balance", "Lowest balance ahead", "Unpaid bills"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("edits the first month's opening balance and the daily spend rate", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const opening = screen.getByLabelText("Opening balance");
    fireEvent.change(opening, { target: { value: "10,250" } });
    fireEvent.blur(opening);
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { openingBalance: 10250 }));
    const rate = screen.getByLabelText("Daily spend rate");
    fireEvent.change(rate, { target: { value: "60" } });
    fireEvent.blur(rate);
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { dailySpendRate: 60 }));
  });

  it("shows a carried opening as last month's close, not as a field", () => {
    const { month, entries } = october();
    const september: CashFlowMonth = { ...month, id: "m_sep", month: "2026-09", periods: [{ id: "s1", endDate: "2026-09-30", label: "End of month" }] };
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [september, { ...month, openingSource: "carried" }], cashFlowEntries: entries }));
    expect(screen.queryByLabelText("Opening balance")).not.toBeInTheDocument();
    expect(screen.getByText("September 2026's close")).toBeInTheDocument();
  });

  it("switches a hand-entered opening to last month's close", async () => {
    const { month, entries } = october();
    const september: CashFlowMonth = { ...month, id: "m_sep", month: "2026-09", periods: [{ id: "s1", endDate: "2026-09-30", label: "End of month" }] };
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [september, month], cashFlowEntries: entries }));
    expect(screen.queryByLabelText("Opening balance")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "use September 2026's close" }));
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { openingSource: "carried" }));
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

  it("sets every entry back to Planned after a second click", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByRole("button", { name: "Set all to Planned" }));
    expect(updateCashFlowMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set 5 entries back to Planned" }));
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { resetStatuses: true }));
  });

  it("hides Set all to Planned when everything already is, and shows no AD/X tags", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries.map((e) => ({ ...e, status: "planned" as const })) }));
    expect(screen.queryByRole("button", { name: "Set all to Planned" })).not.toBeInTheDocument();
    expect(screen.queryByText("AD")).not.toBeInTheDocument();
  });

  it("adds an item as Credit (money out) or Debit (money in)", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add an item to this period" })[2]);
    expect((screen.getByLabelText("New item kind") as HTMLSelectElement).value).toBe("bill");
    expect(within(screen.getByLabelText("New item kind")).getByText("Credit (out)")).toHaveValue("bill");
    fireEvent.change(screen.getByLabelText("New item name"), { target: { value: "Refund" } });
    fireEvent.change(screen.getByLabelText("New item kind"), { target: { value: "deposit" } });
    fireEvent.change(screen.getByLabelText("New item amount"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addCashFlowEntry).toHaveBeenCalledWith({ monthId: "m_oct", name: "Refund", kind: "deposit", postingDate: "2026-10-31", expectedAmount: 40 }));
  });

  it("draws the empty Confirmation # field so it can be seen", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const field = screen.getByLabelText("Confirmation number of Hydro") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.style.boxShadow).toContain("var(--border)");
  });

  it("doesn't save an unchanged amount", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const hydro = screen.getByLabelText("Amount of Hydro");
    fireEvent.change(hydro, { target: { value: "188.77" } });
    fireEvent.blur(hydro);
    await Promise.resolve();
    expect(updateCashFlowEntry).not.toHaveBeenCalled();
  });

  it("entering a confirmation number leaves the status alone", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Confirmation number of Hydro");
    fireEvent.change(input, { target: { value: "136266" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { confirmationCode: "136266" }));
  });

  it("marks an overdue entry", () => {
    const { month, entries } = october();
    entries.push({ id: "late", monthId: "m_oct", itemId: null, name: "Late bill", kind: "bill", dueDate: "2026-10-12", postingDate: "2026-10-12", expectedAmount: 10, status: "planned" });
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const status = screen.getByLabelText("Status of Late bill") as HTMLSelectElement;
    expect(within(status).getByText("Planned — overdue")).toBeInTheDocument();
  });

  it("offers to start a month that doesn't exist, carrying the previous close", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }), "2026-11");
    expect(screen.getByText(/November 2026 hasn.t been started/)).toBeInTheDocument();
    expect(screen.getByText("$8,728.02")).toBeInTheDocument();
    expect(screen.queryByLabelText("Opening balance")).not.toBeInTheDocument();
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
