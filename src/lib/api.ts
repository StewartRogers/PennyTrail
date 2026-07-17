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

export function addCard(input: { name: string; bank: string; last4: string; network: Network }): Promise<Card> {
  return request("/api/cards", { method: "POST", body: JSON.stringify(input) });
}

export function updateCard(id: string, patch: Partial<Pick<Card, "name" | "bank" | "network">>): Promise<Card> {
  return request(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function addCategory(input: { name: string; color: string }): Promise<Category> {
  return request("/api/categories", { method: "POST", body: JSON.stringify(input) });
}

export function updateCategory(id: string, patch: { name?: string; excludeFromDashboard?: boolean }): Promise<Category> {
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
  // Optional overrides sourced from mapped Vendor/Category/Type columns.
  // When present, these take precedence over auto-classification.
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
}

export function importTransactions(
  cardId: string,
  rows: ImportRow[]
): Promise<{ transactions: Transaction[]; counts: { total: number; auto: number; review: number; skipped: number } }> {
  return request("/api/transactions/import", { method: "POST", body: JSON.stringify({ cardId, rows }) });
}

export function updateTransaction(
  id: string,
  patch: Partial<Pick<Transaction, "type" | "needsReview" | "childVendorId">> & {
    parentId?: string;
    newParentName?: string;
    category?: string;
    // null clears any existing reimbursement
    reimbursedAmount?: number | null;
  }
): Promise<Transaction> {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAllTransactions(): Promise<{ deletedCount: number }> {
  return request("/api/transactions", { method: "DELETE" });
}

export function deleteTransactions(ids: string[]): Promise<{ deletedCount: number }> {
  return request("/api/transactions", { method: "DELETE", body: JSON.stringify({ ids }) });
}

// There is no standalone "create a parent" — a parent is only ever created
// together with its first vendor, either during import review (see
// updateTransaction's newParentName/category) or automatically via fuzzy
// matching. A parent with zero vendors can't exist.

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
