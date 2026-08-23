/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Transactions } from "@/components/Transactions";
import { ToastProvider } from "@/components/ToastContext";
import { deleteTransactions } from "@/lib/api";
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

describe("Transactions delete filtered", () => {
  it("does not offer 'Delete filtered…' when no filter is narrowing the list", () => {
    const card = makeCard();
    const txn = makeTransaction({ id: "txn_1" });
    const appState = makeAppState({ cards: [card], categories: [makeCategory()], transactions: [txn] });

    renderTransactions(appState);

    expect(screen.queryByText("Delete filtered…")).not.toBeInTheDocument();
  });

  it("deletes only the transactions matching the active filter, not the whole set", async () => {
    const cardA = makeCard({ id: "card_a", name: "Card A" });
    const cardB = makeCard({ id: "card_b", name: "Card B" });
    const txnA1 = makeTransaction({ id: "txn_a1", cardId: "card_a" });
    const txnA2 = makeTransaction({ id: "txn_a2", cardId: "card_a" });
    const txnB1 = makeTransaction({ id: "txn_b1", cardId: "card_b" });
    const appState = makeAppState({
      cards: [cardA, cardB],
      categories: [makeCategory()],
      transactions: [txnA1, txnA2, txnB1],
    });
    vi.mocked(deleteTransactions).mockResolvedValue({ deletedCount: 2 });

    renderTransactions(appState);

    fireEvent.change(screen.getByDisplayValue("All Cards"), { target: { value: "card_a" } });
    expect(screen.getByText("2 transactions")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Delete filtered…"));
    expect(screen.getByText("Delete all 2 filtered transactions?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm"));

    await screen.findByText((text) => text.startsWith("Deleted 2 transaction"));
    expect(deleteTransactions).toHaveBeenCalledWith(["txn_a1", "txn_a2"]);
  });

  it("cancels the pending 'delete filtered' confirmation when the filter changes underneath it", () => {
    const cardA = makeCard({ id: "card_a", name: "Card A" });
    const cardB = makeCard({ id: "card_b", name: "Card B" });
    const txnA = makeTransaction({ id: "txn_a", cardId: "card_a" });
    const txnB = makeTransaction({ id: "txn_b", cardId: "card_b" });
    const appState = makeAppState({ cards: [cardA, cardB], categories: [makeCategory()], transactions: [txnA, txnB] });

    renderTransactions(appState);

    fireEvent.change(screen.getByDisplayValue("All Cards"), { target: { value: "card_a" } });
    fireEvent.click(screen.getByText("Delete filtered…"));
    expect(screen.getByText("Delete all 1 filtered transaction?")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Card A"), { target: { value: "card_b" } });
    expect(screen.queryByText("Delete all 1 filtered transaction?")).not.toBeInTheDocument();
  });
});

describe("Transactions date filter", () => {
  function buildDatedState() {
    const card = makeCard();
    return makeAppState({
      cards: [card],
      categories: [makeCategory()],
      transactions: [
        makeTransaction({ id: "before", date: "2026-01-10" }),
        makeTransaction({ id: "inside", date: "2026-02-15" }),
        makeTransaction({ id: "after", date: "2026-03-20" }),
      ],
    });
  }

  it("keeps only transactions on or after the From date", () => {
    renderTransactions(buildDatedState());

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });

    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    expect(screen.queryByText("Jan 10, 2026")).not.toBeInTheDocument();
    expect(screen.getByText("Feb 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Mar 20, 2026")).toBeInTheDocument();
  });

  it("keeps only transactions on or before the To date", () => {
    renderTransactions(buildDatedState());

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-28" } });

    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    expect(screen.getByText("Jan 10, 2026")).toBeInTheDocument();
    expect(screen.getByText("Feb 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Mar 20, 2026")).not.toBeInTheDocument();
  });

  it("combines From and To into an inclusive range", () => {
    renderTransactions(buildDatedState());

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-15" } });

    expect(screen.getByText("1 transaction")).toBeInTheDocument();
    expect(screen.getByText("Feb 15, 2026")).toBeInTheDocument();
  });
});

describe("Transactions amount filter", () => {
  function buildAmountState() {
    const card = makeCard();
    return makeAppState({
      cards: [card],
      categories: [makeCategory()],
      transactions: [
        makeTransaction({ id: "cheap", date: "2026-01-10", amount: 10 }),
        makeTransaction({ id: "mid", date: "2026-01-11", amount: 50 }),
        makeTransaction({ id: "pricey", date: "2026-01-12", amount: 500 }),
      ],
    });
  }

  it("keeps only transactions with a gross amount at or above Min $", () => {
    renderTransactions(buildAmountState());

    fireEvent.change(screen.getByLabelText("Min $"), { target: { value: "40" } });

    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    expect(screen.queryByText("Jan 10, 2026")).not.toBeInTheDocument();
    expect(screen.getByText("Jan 11, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 12, 2026")).toBeInTheDocument();
  });

  it("keeps only transactions with a gross amount at or below Max $", () => {
    renderTransactions(buildAmountState());

    fireEvent.change(screen.getByLabelText("Max $"), { target: { value: "60" } });

    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    expect(screen.getByText("Jan 10, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 11, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Jan 12, 2026")).not.toBeInTheDocument();
  });

  it("combines Min $ and Max $ into an inclusive range", () => {
    renderTransactions(buildAmountState());

    fireEvent.change(screen.getByLabelText("Min $"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Max $"), { target: { value: "50" } });

    expect(screen.getByText("1 transaction")).toBeInTheDocument();
    expect(screen.getByText("Jan 11, 2026")).toBeInTheDocument();
  });
});

describe("Transactions reset filters", () => {
  it("only appears once a filter narrows the list", () => {
    const appState = makeAppState({ cards: [makeCard()], categories: [makeCategory()], transactions: [makeTransaction()] });
    renderTransactions(appState);

    expect(screen.queryByText("Reset filters")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search vendor or description…"), { target: { value: "something" } });
    expect(screen.getByText("Reset filters")).toBeInTheDocument();
  });

  it("clears every active filter back to its default in one click", () => {
    const cardA = makeCard({ id: "card_a", name: "Card A" });
    const txnA = makeTransaction({ id: "txn_a", cardId: "card_a", date: "2026-01-10" });
    const txnB = makeTransaction({ id: "txn_b", cardId: "card_a", date: "2026-06-10" });
    const appState = makeAppState({ cards: [cardA], categories: [makeCategory()], transactions: [txnA, txnB] });

    renderTransactions(appState);

    fireEvent.change(screen.getByPlaceholderText("Search vendor or description…"), { target: { value: "something" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    expect(screen.getByText("0 transactions")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reset filters"));

    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search vendor or description…")).toHaveValue("");
    expect(screen.getByLabelText("From")).toHaveValue("");
    expect(screen.queryByText("Reset filters")).not.toBeInTheDocument();
  });
});
