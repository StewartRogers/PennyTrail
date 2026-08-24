import type { AppState, Card, Category, ChildVendor, Network, ParentVendor, Template, Transaction } from "./types";

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

export function addCard(input: { name: string; bank: string; last4: string; network: Network; currency?: string }): Promise<Card> {
  return request("/api/cards", { method: "POST", body: JSON.stringify(input) });
}

export function updateCard(id: string, patch: Partial<Pick<Card, "name" | "bank" | "network" | "currency">>): Promise<Card> {
  return request(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// CAD per 1 unit of `currency`, resolved for every date in [start, end] —
// see src/app/api/fx-rates/route.ts and src/lib/fx.ts.
export function fetchFxRates(currency: string, start: string, end: string): Promise<{ rates: Record<string, number> }> {
  return request(`/api/fx-rates?currency=${encodeURIComponent(currency)}&start=${start}&end=${end}`);
}

export function addCategory(input: { name: string; color: string }): Promise<Category> {
  return request("/api/categories", { method: "POST", body: JSON.stringify(input) });
}

export function updateCategory(id: string, patch: { name?: string; excludeFromDashboard?: boolean }): Promise<Category> {
  return request(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteCategory(id: string): Promise<{ ok: true }> {
  return request(`/api/categories/${id}`, { method: "DELETE" });
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
  // Optional overrides sourced from mapped Vendor/Category/Type columns.
  // When present, these take precedence over auto-classification.
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
  // Resubmit a DuplicateRow with this set to add it despite colliding with
  // an existing transaction (or another row in the same batch).
  forceImport?: boolean;
  // See Transaction.conversionNote.
  conversionNote?: string;
}

export interface DuplicateRow {
  date: string;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
  conversionNote?: string;
}

export function importTransactions(
  cardId: string,
  rows: ImportRow[]
): Promise<{
  transactions: Transaction[];
  counts: { total: number; auto: number; review: number; skipped: number; duplicates: number };
  duplicates: DuplicateRow[];
}> {
  return request("/api/transactions/import", { method: "POST", body: JSON.stringify({ cardId, rows }) });
}

export function updateTransaction(
  id: string,
  patch: Partial<Pick<Transaction, "type" | "needsReview" | "childVendorId" | "date" | "amount" | "excludeFromDashboard" | "conversionNote">> & {
    parentId?: string;
    newParentName?: string;
    category?: string;
    // null clears any existing reimbursement
    reimbursedAmount?: number | null;
  }
): Promise<Transaction> {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// The full wipe must be requested explicitly — the route rejects a DELETE
// whose body is missing or unrecognized rather than treating it as "delete
// everything", so a dropped/truncated body can't destroy the history.
export function deleteAllTransactions(): Promise<{ deletedCount: number }> {
  return request("/api/transactions", { method: "DELETE", body: JSON.stringify({ all: true }) });
}

export function deleteTransactions(ids: string[]): Promise<{ deletedCount: number }> {
  return request("/api/transactions", { method: "DELETE", body: JSON.stringify({ ids }) });
}

// A parent can also come from naming a transaction's vendor directly (see
// updateTransaction's newParentName/category) or from fuzzy-match
// auto-attach — this is the standalone path, e.g. to pre-create a grouping
// before moving existing vendors into it from the Vendors tab.
export function addParentVendor(input: { name: string; category: string }): Promise<ParentVendor> {
  return request("/api/parent-vendors", { method: "POST", body: JSON.stringify(input) });
}

export function updateParentVendor(id: string, patch: { name?: string; category?: string }): Promise<ParentVendor> {
  return request(`/api/parent-vendors/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteParentVendor(id: string): Promise<{ removedChildren: number; affectedCount: number }> {
  return request(`/api/parent-vendors/${id}`, { method: "DELETE" });
}

export function mergeParentVendors(fromId: string, intoId: string): Promise<{ parent: ParentVendor; movedCount: number }> {
  return request("/api/parent-vendors/merge", { method: "POST", body: JSON.stringify({ fromId, intoId }) });
}

export function moveChildVendor(id: string, parentId: string): Promise<ChildVendor> {
  return request(`/api/child-vendors/${id}`, { method: "PATCH", body: JSON.stringify({ parentId }) });
}

// If this was the parent's last vendor, the (now-empty) parent is removed
// too — see child-vendors/[id]/route.ts.
export function deleteChildVendor(id: string): Promise<{ affectedCount: number; parentRemoved: boolean }> {
  return request(`/api/child-vendors/${id}`, { method: "DELETE" });
}
