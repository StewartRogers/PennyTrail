/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankImport } from "@/components/cashflow/BankImport";
import { CashFlowHistory } from "@/components/cashflow/CashFlowHistory";
import { ToastProvider } from "@/components/ToastContext";
import { readXlsx } from "@/lib/xlsx";
import type { BankAccount } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  importBankTransactions: vi.fn(),
  updateBankAccount: vi.fn(),
  importCashFlowHistory: vi.fn(),
}));
vi.mock("@/lib/xlsx", () => ({ readXlsx: vi.fn().mockResolvedValue([]) }));

const account: BankAccount = { id: "acct", name: "Chequing", institution: "Bank", last4: "0000", color: "red", dailySpendRate: 50, bankHolidays: [] };
const appState = makeAppState({ bankAccounts: [account] });
const CSV = "Date,Transaction Details,Funds Out,Funds In\n10/01/2026,PAYROLL,,3000.00\n";

function pick(label: string, file: File) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

beforeEach(() => vi.clearAllMocks());

describe("Bank CSV file picker", () => {
  function renderImport() {
    render(
      <ToastProvider>
        <BankImport appState={appState} onReload={vi.fn()} accountId="acct" onGoTransactions={vi.fn()} />
      </ToastProvider>
    );
  }

  it("shows a button and 'No file chosen' instead of the browser's control", () => {
    renderImport();
    expect(screen.getByRole("button", { name: "Choose .csv file" })).toBeInTheDocument();
    expect(screen.getByText("No file chosen")).toBeInTheDocument();
    expect(screen.getByLabelText("Bank CSV file")).not.toBeVisible();
  });

  it("opens the file dialog from the button", () => {
    renderImport();
    const input = screen.getByLabelText("Bank CSV file") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose .csv file" }));
    expect(click).toHaveBeenCalled();
  });

  it("shows the chosen file's name and offers a different one", async () => {
    renderImport();
    const input = pick("Bank CSV file", new File([CSV], "october.csv", { type: "text/csv" }));
    expect(await screen.findByText("october.csv", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
    // Cleared, so choosing the same file again still fires a change.
    expect(input.value).toBe("");
  });
});

describe("Workbook file picker on History", () => {
  function renderHistory() {
    render(
      <ToastProvider>
        <CashFlowHistory appState={appState} onReload={vi.fn()} accountId="acct" onOpenMonth={vi.fn()} />
      </ToastProvider>
    );
  }

  it("shows a button and 'No file chosen' instead of the browser's control", () => {
    renderHistory();
    expect(screen.getByRole("button", { name: "Choose .xlsx file" })).toBeInTheDocument();
    expect(screen.getByText("No file chosen")).toBeInTheDocument();
    expect(screen.getByLabelText("Workbook file")).not.toBeVisible();
  });

  it("shows the file's name while reading and after", async () => {
    let finish: (v: []) => void = () => {};
    vi.mocked(readXlsx).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderHistory();
    const input = pick("Workbook file", new File(["x"], "budget.xlsx"));
    expect(await screen.findByText("Reading budget.xlsx…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeDisabled();
    finish([]);
    await waitFor(() => expect(screen.getByText("budget.xlsx", { selector: "span" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeEnabled();
    expect(input.value).toBe("");
  });
});
