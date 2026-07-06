import type { Category, TxnType } from "./types";

export const CATEGORY_PALETTE = [
  "oklch(0.62 0.10 250)",
  "oklch(0.62 0.10 25)",
  "oklch(0.62 0.10 145)",
  "oklch(0.62 0.10 300)",
  "oklch(0.62 0.10 70)",
  "oklch(0.62 0.10 190)",
  "oklch(0.62 0.10 330)",
  "oklch(0.62 0.10 100)",
  "oklch(0.62 0.10 210)",
  "oklch(0.62 0.10 50)",
  "oklch(0.62 0.10 270)",
  "oklch(0.62 0.10 130)",
];

export function sortCategoriesByName<T extends { name: string }>(categories: T[]): T[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name));
}

export function defaultCategories(): Category[] {
  return [
    { id: "groceries", name: "Groceries", color: "oklch(0.62 0.10 145)" },
    { id: "dining", name: "Dining", color: "oklch(0.62 0.10 50)" },
    { id: "travel", name: "Travel", color: "oklch(0.62 0.10 250)" },
    { id: "transportation", name: "Transportation", color: "oklch(0.62 0.10 210)" },
    { id: "utilities", name: "Utilities", color: "oklch(0.62 0.10 190)" },
    { id: "entertainment", name: "Entertainment", color: "oklch(0.62 0.10 300)" },
    { id: "shopping", name: "Shopping", color: "oklch(0.62 0.10 330)" },
    { id: "health", name: "Health", color: "oklch(0.62 0.10 25)" },
    { id: "subscriptions", name: "Subscriptions", color: "oklch(0.62 0.10 270)" },
    { id: "payment", name: "Payment", color: "oklch(0.75 0.02 260)" },
    { id: "credit_refund", name: "Credit / Refund", color: "oklch(0.65 0.09 165)" },
    { id: "cashback", name: "Cashback & Rewards", color: "oklch(0.60 0.12 145)" },
    { id: "fees_interest", name: "Fees & Interest", color: "oklch(0.58 0.13 35)" },
  ];
}

export const TYPE_META: Record<TxnType, { label: string; color: string }> = {
  purchase: { label: "Purchase", color: "oklch(0.45 0.02 260)" },
  payment: { label: "Payment", color: "oklch(0.55 0.10 155)" },
  credit: { label: "Credit", color: "oklch(0.55 0.10 200)" },
  cashback: { label: "Cashback", color: "oklch(0.55 0.12 145)" },
  fee: { label: "Fee / Interest", color: "oklch(0.55 0.13 35)" },
};
