/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportWizard } from "@/components/ImportWizard";
import { ToastProvider } from "@/components/ToastContext";
import type { AppState, Template } from "@/lib/types";
import { makeAppState, makeCard } from "../helpers/fixtures";

const { importTransactionsMock } = vi.hoisted(() => ({
  importTransactionsMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  updateCard: vi.fn(),
  addTemplate: vi.fn(),
  fetchState: vi.fn().mockResolvedValue({
    cards: [],
    categories: [],
    templates: [],
    parentVendors: [],
    childVendors: [],
    transactions: [],
  }),
  importTransactions: importTransactionsMock,
  updateTransaction: vi.fn(),
}));

function renderWizard(appState: AppState, onReload = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <ToastProvider>
      <ImportWizard appState={appState} onReload={onReload} onGoDashboard={vi.fn()} />
    </ToastProvider>
  );
}

function makeCsvFile(contents: string, name = "statement.csv") {
  return new File([contents], name, { type: "text/csv" });
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tpl_1",
    name: "Test Bank",
    bank: "Test Bank",
    network: "Mastercard",
    dateCol: 0,
    descCol: 1,
    dateFormat: "YYYY-MM-DD",
    amountMode: "single",
    amountCol: 2,
    amountConvention: "positive_is_purchase",
    debitCol: -1,
    creditCol: -1,
    vendorCol: -1,
    categoryCol: -1,
    typeCol: -1,
    skipRows: 0,
    headerSnapshot: ["Date", "Description", "Amount"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ImportWizard", () => {
  it("disables the Import button when the uploaded file has headers but no data rows", async () => {
    const card = makeCard({ name: "My Card" });
    renderWizard(makeAppState({ cards: [card] }));

    // Step 1: select the card and continue.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: card.id } });
    fireEvent.click(screen.getByText("Continue →"));

    // Step 2: upload a header-only CSV (recognizable headers so guessMapping
    // auto-completes the mapping without needing manual column selection).
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeCsvFile("Date,Description,Amount\n");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/rows detected/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("Continue →"));

    // Step 3: the Import button should be disabled at 0 rows rather than
    // clickable and hitting the server's "No rows to import" error.
    const importButton = await screen.findByText("Import 0 Transactions");
    expect(importButton.closest("button")).toBeDisabled();
  });

  it("merges data rows from multiple files that share the same header layout", async () => {
    const card = makeCard({ name: "My Card" });
    renderWizard(makeAppState({ cards: [card] }));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: card.id } });
    fireEvent.click(screen.getByText("Continue →"));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const jan = makeCsvFile("Date,Description,Amount\n2026-01-01,Coffee Shop,5\n2026-01-15,Grocery Store,40\n", "january.csv");
    const feb = makeCsvFile("Date,Description,Amount\n2026-02-02,Coffee Shop,6\n", "february.csv");
    fireEvent.change(fileInput, { target: { files: [jan, feb] } });

    // 3 data rows total across the two files, not just the first file's 2.
    expect(await screen.findByText(/3 rows detected across 2 files/)).toBeInTheDocument();
  });

  it("doesn't false-flag a header mismatch when an unrelated, stale template for the same bank sorts first", async () => {
    // Regression test: a bank can have more than one saved template (e.g.
    // re-saved after the statement export changed). The old code always used
    // templates[0] for that bank to guess skipRows, so a stale template with
    // a different skipRows/headerSnapshot — sorted first purely by array
    // order — made the header-consistency check compare the wrong row (a
    // data row, not the header) and report matching files as mismatched.
    const card = makeCard({ name: "My Card", bank: "Rogers" });
    const staleTemplate = makeTemplate({
      id: "tpl_stale",
      name: "Rogers",
      bank: "Rogers",
      skipRows: 3,
      headerSnapshot: ["REF", "TRANSACTION DATE", "POSTED DATE", "TYPE", "DESCRIPTION", "Category", "AMOUNT"],
    });
    const currentTemplate = makeTemplate({
      id: "tpl_current",
      name: "Rogers",
      bank: "Rogers",
      skipRows: 0,
      headerSnapshot: ["Date", "Description", "Amount"],
    });
    renderWizard(makeAppState({ cards: [card], templates: [staleTemplate, currentTemplate] }));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: card.id } });
    fireEvent.click(screen.getByText("Continue →"));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mar = makeCsvFile("Date,Description,Amount\n2026-03-14,Shaw Cablesystems,114.24\n", "mar.csv");
    const june = makeCsvFile("Date,Description,Amount\n2026-06-14,Shaw Cablesystems,114.24\n", "june.csv");
    fireEvent.change(fileInput, { target: { files: [mar, june] } });

    expect(await screen.findByText(/2 rows detected across 2 files/)).toBeInTheDocument();
    expect(screen.queryByText(/different columns/)).not.toBeInTheDocument();
  });

  it("rejects a multi-file selection whose files don't share the same header row, without loading any of them", async () => {
    const card = makeCard({ name: "My Card" });
    renderWizard(makeAppState({ cards: [card] }));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: card.id } });
    fireEvent.click(screen.getByText("Continue →"));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const jan = makeCsvFile("Date,Description,Amount\n2026-01-01,Coffee Shop,5\n", "january.csv");
    const differentLayout = makeCsvFile("Transaction Date,Merchant,Debit,Credit\n2026-02-02,Coffee Shop,6,\n", "february.csv");
    fireEvent.change(fileInput, { target: { files: [jan, differentLayout] } });

    expect(await screen.findByText(/different columns than "january\.csv"/)).toBeInTheDocument();
    expect(screen.queryByText(/rows detected/)).not.toBeInTheDocument();
  });

  it("falls back to the mapped vendor column for rawDescription when the mapped Description is blank", async () => {
    // Regression test: some banks (e.g. Rogers) leave the mapped Description
    // column blank on payment/cashback/fee lines but still populate a
    // separately-mapped Vendor column for them. Storing an empty
    // rawDescription left the review screen with nothing to show or suggest
    // as a vendor name for these rows.
    importTransactionsMock.mockResolvedValue({
      transactions: [],
      counts: { total: 1, auto: 1, review: 0, skipped: 0, duplicates: 0 },
      duplicates: [],
    });
    const card = makeCard({ name: "My Card", bank: "Rogers" });
    const template = makeTemplate({
      bank: "Rogers",
      dateCol: 0,
      descCol: 1,
      vendorCol: 2,
      amountCol: 3,
      headerSnapshot: ["Date", "Description", "Vendor", "Amount"],
    });
    renderWizard(makeAppState({ cards: [card], templates: [template] }));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: card.id } });
    fireEvent.click(screen.getByText("Continue →"));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeCsvFile("Date,Description,Vendor,Amount\n2026-06-26,,CashBack / Remises,-17.74\n");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/rows detected/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Continue →"));
    fireEvent.click(await screen.findByText("Import 1 Transactions"));

    await waitFor(() => expect(importTransactionsMock).toHaveBeenCalled());
    const rows = importTransactionsMock.mock.calls[0][1];
    expect(rows[0].rawDescription).toBe("CashBack / Remises");
  });
});
