import type { AppState, Card, Category, ChildVendor, ParentVendor, Transaction } from "@/lib/types";

export function makeCard(overrides: Partial<Card> = {}): Card {
  return { id: "card_1", name: "Test Card", bank: "Test Bank", network: "Visa", last4: "1234", color: "oklch(0.5 0.1 250)", ...overrides };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "cat_1", name: "Groceries", color: "oklch(0.5 0.1 145)", ...overrides };
}

export function makeParentVendor(overrides: Partial<ParentVendor> = {}): ParentVendor {
  return { id: "parent_1", name: "Costco", category: "cat_1", ...overrides };
}

export function makeChildVendor(overrides: Partial<ChildVendor> = {}): ChildVendor {
  return { id: "child_1", parentId: "parent_1", rawName: "Costco Wholesale", ...overrides };
}

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_1",
    cardId: "card_1",
    date: "2026-03-05",
    rawDescription: "COSTCO WHOLESALE #123",
    amount: 100,
    type: "purchase",
    childVendorId: null,
    needsReview: true,
    ...overrides,
  };
}

export function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    cards: [],
    categories: [],
    templates: [],
    parentVendors: [],
    childVendors: [],
    transactions: [],
    ...overrides,
  };
}
