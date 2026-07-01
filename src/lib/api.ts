import type { AppState, Card, Category, Network, Template, Transaction } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchState(): Promise<AppState> {
  return request("/api/state");
}

export function addCard(input: { name: string; bank: string; last4: string; network: Network }): Promise<Card> {
  return request("/api/cards", { method: "POST", body: JSON.stringify(input) });
}

export function updateCard(id: string, patch: Partial<Pick<Card, "name" | "bank" | "network">>): Promise<Card> {
  return request(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function addCategory(input: { name: string; color: string }): Promise<Category> {
  return request("/api/categories", { method: "POST", body: JSON.stringify(input) });
}

export function updateCategory(id: string, patch: { name: string }): Promise<Category> {
  return request(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function addTemplate(input: Omit<Template, "id">): Promise<Template> {
  return request("/api/templates", { method: "POST", body: JSON.stringify(input) });
}

export function deleteTemplate(id: string): Promise<{ ok: true }> {
  return request(`/api/templates/${id}`, { method: "DELETE" });
}

export interface ImportRow {
  date: string;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
}

export function importTransactions(
  cardId: string,
  rows: ImportRow[]
): Promise<{ transactions: Transaction[]; counts: { total: number; auto: number; review: number } }> {
  return request("/api/transactions/import", { method: "POST", body: JSON.stringify({ cardId, rows }) });
}

export function updateTransaction(
  id: string,
  patch: Partial<Pick<Transaction, "vendor" | "category" | "needsReview">> & { rememberVendor?: boolean }
): Promise<Transaction> {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
