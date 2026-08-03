/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportWizard } from "@/components/ImportWizard";
import { ToastProvider } from "@/components/ToastContext";
import type { AppState } from "@/lib/types";
import { makeAppState, makeCard } from "../helpers/fixtures";

const { addCardMock, importTransactionsMock } = vi.hoisted(() => ({
  addCardMock: vi.fn(),
  importTransactionsMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  addCard: addCardMock,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ImportWizard", () => {
  it("disables the Import button when the uploaded file has headers but no data rows", async () => {
    const card = makeCard({ name: "My Card" });
    renderWizard(makeAppState({ cards: [card] }));

    // Step 1: select the card and continue.
    fireEvent.click(screen.getByText("My Card"));
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

  it("shows a toast instead of an unhandled rejection when adding a card fails", async () => {
    addCardMock.mockRejectedValue(new Error("A card with this name already exists"));
    renderWizard(makeAppState({ cards: [] }));

    fireEvent.change(screen.getByPlaceholderText("Card nickname"), { target: { value: "Duplicate Card" } });
    fireEvent.click(screen.getByText("Add Card"));

    expect(await screen.findByText("A card with this name already exists")).toBeInTheDocument();
  });
});
