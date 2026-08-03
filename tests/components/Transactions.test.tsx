/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Transactions } from "@/components/Transactions";
import { ToastProvider } from "@/components/ToastContext";
import type { AppState } from "@/lib/types";
import { makeAppState, makeCard, makeCategory, makeTransaction } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  deleteAllTransactions: vi.fn(),
  deleteTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

function renderTransactions(appState: AppState, onReload = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <ToastProvider>
      <Transactions appState={appState} onReload={onReload} seed={{}} seedKey={0} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Transactions bulk-selection", () => {
  it("clears the selection when a filter changes, instead of letting it silently refer to now-hidden rows", () => {
    const cardA = makeCard({ id: "card_a", name: "Card A" });
    const cardB = makeCard({ id: "card_b", name: "Card B" });
    const txn = makeTransaction({ id: "txn_1", cardId: "card_a" });
    const appState = makeAppState({ cards: [cardA, cardB], categories: [makeCategory()], transactions: [txn] });

    renderTransactions(appState);

    const table = screen.getByRole("table");
    const rowCheckboxes = within(table).getAllByRole("checkbox");
    // rowCheckboxes[0] is the "select all visible" header checkbox.
    fireEvent.click(rowCheckboxes[1]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    // Switching the card filter should drop the selection, since the
    // previously-selected row may no longer be visible under the new filter.
    const cardFilter = screen.getByDisplayValue("All Cards");
    fireEvent.change(cardFilter, { target: { value: "card_b" } });

    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("clears the selection when the search text changes", () => {
    const card = makeCard();
    const txn = makeTransaction({ id: "txn_1" });
    const appState = makeAppState({ cards: [card], categories: [makeCategory()], transactions: [txn] });

    renderTransactions(appState);

    const table = screen.getByRole("table");
    const rowCheckboxes = within(table).getAllByRole("checkbox");
    fireEvent.click(rowCheckboxes[1]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search vendor or description…"), { target: { value: "something" } });

    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("keeps the selection when nothing else has changed", () => {
    const card = makeCard();
    const txn = makeTransaction({ id: "txn_1" });
    const appState = makeAppState({ cards: [card], categories: [makeCategory()], transactions: [txn] });

    renderTransactions(appState);

    const table = screen.getByRole("table");
    const rowCheckboxes = within(table).getAllByRole("checkbox");
    fireEvent.click(rowCheckboxes[1]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});
