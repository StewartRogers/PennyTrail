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
  const e = (o: Partial<CashFlowEntry>): CashFlowEntry => ({ id: o.name!, monthId: "m_oct", itemId: "item", name: "", kind: "bill", dueDate: o.postingDate!, postingDate: "2026-10-01", expectedAmount: 0, status: "projected", ...o });
  const entries = [
    e({ name: "Rent", expectedAmount: 1500, postingDate: "2026-10-01", dueDate: "2026-09-30", status: "actual", postedDate: "2026-10-01" }),
    e({ name: "SR pay", kind: "deposit", expectedAmount: 3000.5, postingDate: "2026-10-01", status: "actual", settlement: "auto" }),
    e({ name: "CIBC", expectedAmount: 200, actualAmount: 222.47, postingDate: "2026-10-01", status: "actual" }),
    e({ name: "Insurance", expectedAmount: 28.92, postingDate: "2026-10-09", status: "actual" }),
    e({ name: "Simplii", expectedAmount: 754.3, postingDate: "2026-10-09", confirmationCode: "104238" }),
    e({ name: "Hydro", expectedAmount: 188.77, postingDate: "2026-10-23" }),
  ];
  return { month, entries };
}

function renderView(appState: AppState, monthKey = "2026-10", onMonthKeyChange = vi.fn()) {
  const onReload = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <CashFlowMonthView appState={appState} onReload={onReload} accountId="acct" monthKey={monthKey} onMonthKeyChange={onMonthKeyChange} />
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
    // The rate sits in the item name, not in the Status column.
    const names = screen.getAllByText(/^Weekly Spend/).map((el) => el.textContent);
    expect(names).toEqual(["Weekly Spend [$50.00/day × 2]", "Weekly Spend [$50.00/day × 7]", "Weekly Spend [$50.00/day × 22]"]);
    expect(screen.getAllByText("END OF WEEK")).toHaveLength(2);
    expect(screen.getByText("END OF MONTH")).toBeInTheDocument();
    // P1: 10,000 − 100 − 1,500 + 3,000.50 − 222.47 = 11,178.03 projected; actual 11,150.01.
    // The checkpoint shows the recorded balance only — no projected or variance line.
    expect((screen.getByLabelText("Actual balance at 2026-10-02") as HTMLInputElement).value).toBe("$11,150.01");
    // An unrecorded checkpoint shows its projection greyed in the same field, and no date.
    const next = screen.getByLabelText("Actual balance at 2026-10-09") as HTMLInputElement;
    expect([next.value, next.placeholder]).toEqual(["", "$10,016.79"]);
    expect(screen.queryByLabelText(/Checkpoint date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vs projected/)).not.toBeInTheDocument();
  });

  it("keeps the table to item, date, withdrawals, deposits, status, confirmation, and balance", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const headers = within(screen.getAllByRole("table")[0])
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Item", "Date", "Withdrawals (−)", "Deposits (+)", "Status", "Confirmation #", "Balance", ""]);
  });

  it("puts bills and Weekly Spend under Withdrawals and deposits under Deposits", () => {
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

  it("saves a date when the field is left, not on every keystroke", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const date = screen.getByLabelText("Date of Hydro");
    fireEvent.change(date, { target: { value: "2026-01-23" } }); // "1" on the way to "10"
    fireEvent.change(date, { target: { value: "2026-10-26" } });
    expect(updateCashFlowEntry).not.toHaveBeenCalled();
    fireEvent.blur(date);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { postingDate: "2026-10-26" }));
    expect(updateCashFlowEntry).toHaveBeenCalledTimes(1);
  });

  it("keeps the end-of-month checkpoint, and only closes a month that has it recorded", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    // The two end-of-week checkpoints can be removed; the month-end one can't.
    expect(screen.getAllByTitle("Remove this checkpoint")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Mark month closed" })).toBeDisabled();
  });

  it("shows no low-balance warning while the balance ahead stays above zero", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the low point when it is below the warning level", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [{ ...account, lowBalanceThreshold: 9000 }], cashFlowMonths: [month], cashFlowEntries: entries }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Lowest balance ahead: \$8,728\.02 .* below your \$9,000\.00 warning level/);
  });

  it("changes an entry's status", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.change(screen.getByLabelText("Status of Hydro"), { target: { value: "actual" } });
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { status: "actual" }));
  });

  it("sets every entry back to Projected after a second click", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByRole("button", { name: "Set all to Projected" }));
    expect(updateCashFlowMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set 4 entries back to Projected" }));
    await waitFor(() => expect(updateCashFlowMonth).toHaveBeenCalledWith("m_oct", { resetStatuses: true }));
  });

  it("hides Set all to Projected when everything already is, and shows AD only in the Confirmation # cell", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries.map((e) => ({ ...e, status: "projected" as const })) }));
    expect(screen.queryByRole("button", { name: "Set all to Projected" })).not.toBeInTheDocument();
    expect(screen.getAllByText("AD")).toEqual([screen.getByTestId("confirmation-of-SR pay")]);
  });

  it("adds an item as a withdrawal (money out) or a deposit (money in)", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add an item to this period" })[2]);
    expect((screen.getByLabelText("New item kind") as HTMLSelectElement).value).toBe("bill");
    expect(within(screen.getByLabelText("New item kind")).getByText("Withdrawal (−)")).toHaveValue("bill");
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

  it("corrects only the actual amount of a bank-matched entry, keeping its projection", async () => {
    const { month, entries } = october();
    const matched = entries.map((x) => (x.name === "CIBC" ? { ...x, bankTransactionId: "t1" } : x));
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: matched }));
    const cibc = screen.getByLabelText("Amount of CIBC");
    fireEvent.change(cibc, { target: { value: "222.50" } });
    fireEvent.blur(cibc);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("CIBC", { actualAmount: 222.5 }));
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
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { settlement: "manual", confirmationCode: "136266" }));
  });

  it("marks an item automatic by typing AD where the confirmation number goes", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const input = screen.getByLabelText("Confirmation number of Hydro");
    fireEvent.change(input, { target: { value: "ad" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { settlement: "auto", confirmationCode: "" }));
  });

  it("shows AD or X read-only, and removing it (after asking) makes the item manual", async () => {
    const { month, entries } = october();
    const marked = entries.map((x) => (x.name === "Hydro" ? { ...x, settlement: "external" as const } : x));
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: marked }));
    expect(screen.getByTestId("confirmation-of-SR pay")).toHaveTextContent("AD");
    expect(screen.getByTestId("confirmation-of-Hydro")).toHaveTextContent("X");
    expect(screen.queryByLabelText("Confirmation number of Hydro")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit confirmation number of Hydro" }));
    const field = screen.getByLabelText("Confirmation number of Hydro");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Remove the confirmation number?" })).toBeInTheDocument();
    expect(updateCashFlowEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { settlement: "manual", confirmationCode: "" }));
  });

  it("saves a pasted confirmation number straight away", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.paste(screen.getByLabelText("Confirmation number of Hydro"), { clipboardData: { getData: () => " 136266 " } });
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Hydro", { settlement: "manual", confirmationCode: "136266" }));
    expect(updateCashFlowEntry).toHaveBeenCalledTimes(1);
  });

  it("shows a recorded confirmation number as text, with when it was entered", () => {
    const { month, entries } = october();
    const stamped = entries.map((x) => (x.name === "Simplii" ? { ...x, confirmationRecordedAt: "2026-10-08T19:42:00.000Z" } : x));
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: stamped }));
    expect(screen.queryByLabelText("Confirmation number of Simplii")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirmation-of-Simplii")).toHaveTextContent("104238");
    const expected = "Oct 8, 2026, 12:42 p.m. PCT"; // BC time, whatever zone the test machine is in
    expect(screen.getByRole("img", { name: `Entered ${expected}` })).toHaveAttribute("title", `Entered ${expected}`);
    // Only Simplii has a time: no ⓘ for AD, or for a number with no time recorded.
    expect(screen.getAllByRole("img", { name: /^Entered/ })).toHaveLength(1);
  });

  it("shows no ⓘ for a confirmation number with no entry time", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const cell = screen.getByTestId("confirmation-of-Simplii").parentElement!;
    expect(within(cell).queryByRole("img")).not.toBeInTheDocument();
    // The ✎ is still there, last in the cell.
    expect(cell.lastElementChild).toBe(screen.getByRole("button", { name: "Edit confirmation number of Simplii" }));
  });

  it("asks before replacing a confirmation number, and Cancel keeps the old one", async () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const edit = () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit confirmation number of Simplii" }));
      const field = screen.getByLabelText("Confirmation number of Simplii") as HTMLInputElement;
      expect(field.value).toBe("104238");
      fireEvent.change(field, { target: { value: "104999" } });
      fireEvent.keyDown(field, { key: "Enter" });
    };
    edit();
    expect(screen.getByRole("dialog", { name: "Replace the confirmation number?" })).toHaveTextContent("104238 will be replaced with 104999");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirmation-of-Simplii")).toHaveTextContent("104238");
    expect(updateCashFlowEntry).not.toHaveBeenCalled();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Simplii", { settlement: "manual", confirmationCode: "104999" }));
  });

  it("leaves the number alone when an edit doesn't change it", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    fireEvent.click(screen.getByRole("button", { name: "Edit confirmation number of Simplii" }));
    fireEvent.keyDown(screen.getByLabelText("Confirmation number of Simplii"), { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirmation-of-Simplii")).toBeInTheDocument();
    expect(updateCashFlowEntry).not.toHaveBeenCalled();
  });

  it("shades a row light red when it still needs a confirmation number", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const row = (name: string) => screen.getByLabelText(`Name of ${name}`).closest("tr")!;
    expect(row("Hydro").style.background).toBe("var(--row-missing)"); // manual, no number
    expect(row("Simplii").style.background).toBe(""); // has its number
    expect(row("SR pay").style.background).toBe(""); // automatic
  });

  it("shades a checkpoint yellow while projected and green once the actual is in", () => {
    const { month, entries } = october();
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const row = (date: string) => screen.getByLabelText(`Actual balance at ${date}`).closest("tr")!;
    expect(row("2026-10-02").style.background).toBe("var(--row-actual)");
    expect(row("2026-10-09").style.background).toBe("var(--row-projected)");
  });

  it("offers just Projected, Actual, and Skipped, even for an entry past its date", () => {
    const { month, entries } = october();
    entries.push({ id: "late", monthId: "m_oct", itemId: null, name: "Late bill", kind: "bill", dueDate: "2026-10-12", postingDate: "2026-10-12", expectedAmount: 10, status: "projected" });
    renderView(makeAppState({ bankAccounts: [account], cashFlowMonths: [month], cashFlowEntries: entries }));
    const status = screen.getByLabelText("Status of Late bill") as HTMLSelectElement;
    expect(Array.from(status.options).map((o) => o.textContent)).toEqual(["Projected", "Actual", "Skipped"]);
    expect(status.style.color).toBe("var(--muted)");
    expect((screen.getByLabelText("Date of Late bill") as HTMLInputElement).style.color).toBe("var(--text)");
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
