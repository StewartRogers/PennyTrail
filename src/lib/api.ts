import type {
  AppState,
  BankAccount,
  BankImportMapping,
  BankTransaction,
  BankTxnType,
  Card,
  CashFlowEntry,
  CashFlowItem,
  CashFlowMonth,
  Category,
  ChildVendor,
  Network,
  ParentVendor,
  Template,
  Transaction,
} from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  // The session expired (or was signed out elsewhere): go sign in again and
  // come back to this page, rather than showing a "Sign in required" error.
  if (res.status === 401 && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    window.location.assign(here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
    throw new Error("Signed out — redirecting to sign in");
  }
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

// ---------------------------------------------------------------------------
// Cash Flow
// ---------------------------------------------------------------------------

export function addBankAccount(input: { name: string; institution?: string; last4?: string; dailySpendRate?: number; lowBalanceThreshold?: number }): Promise<BankAccount> {
  return request("/api/bank-accounts", { method: "POST", body: JSON.stringify(input) });
}

export function updateBankAccount(
  id: string,
  patch: Partial<Pick<BankAccount, "name" | "institution" | "last4" | "dailySpendRate" | "bankHolidays">> & {
    lowBalanceThreshold?: number | null;
    importMapping?: BankImportMapping;
  }
): Promise<BankAccount> {
  return request(`/api/bank-accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteBankAccount(id: string): Promise<{ ok: true }> {
  return request(`/api/bank-accounts/${id}`, { method: "DELETE" });
}

export type CashFlowItemInput = Omit<CashFlowItem, "id">;

export function addCashFlowItem(input: CashFlowItemInput): Promise<CashFlowItem> {
  return request("/api/cashflow/items", { method: "POST", body: JSON.stringify(input) });
}

export function updateCashFlowItem(
  id: string,
  patch: Partial<Omit<CashFlowItem, "id" | "accountId" | "owner" | "matchText" | "notes">> & {
    owner?: string;
    matchText?: string;
    notes?: string;
    applyToOutstanding?: boolean;
  }
): Promise<{ item: CashFlowItem; updatedEntries: number }> {
  return request(`/api/cashflow/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteCashFlowItem(id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
  return request(`/api/cashflow/items/${id}`, { method: "DELETE" });
}

export function startCashFlowMonth(input: { accountId: string; month: string; openingBalance?: number }): Promise<{ month: CashFlowMonth; entries: CashFlowEntry[] }> {
  return request("/api/cashflow/months", { method: "POST", body: JSON.stringify(input) });
}

export interface PeriodPatch {
  id: string;
  endDate?: string;
  label?: string;
  spendOverride?: number | null;
  actualBalance?: number | null;
}

export function updateCashFlowMonth(
  id: string,
  patch: {
    openingBalance?: number;
    openingSource?: "carried";
    dailySpendRate?: number;
    closed?: boolean;
    periods?: PeriodPatch[];
    addPeriod?: { endDate: string };
    removePeriodId?: string;
    regenerate?: boolean;
    resetStatuses?: boolean;
  }
): Promise<{ month: CashFlowMonth; generated: number; reset: number }> {
  return request(`/api/cashflow/months/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// Removes the month and every entry in it, so the route insists on an
// explicit confirmation in the body.
export function deleteCashFlowMonth(id: string): Promise<{ deletedEntries: number }> {
  return request(`/api/cashflow/months/${id}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
}

export function addCashFlowEntry(input: { monthId: string; name: string; kind: "bill" | "deposit"; postingDate: string; expectedAmount: number; notes?: string }): Promise<CashFlowEntry> {
  return request("/api/cashflow/entries", { method: "POST", body: JSON.stringify(input) });
}

export function updateCashFlowEntry(
  id: string,
  patch: Partial<Pick<CashFlowEntry, "name" | "kind" | "status" | "settlement" | "expectedAmount" | "postingDate" | "dateUncertain">> & {
    actualAmount?: number | null;
    postedDate?: string | null;
    scheduledDate?: string | null;
    confirmationCode?: string;
    notes?: string;
  }
): Promise<CashFlowEntry> {
  return request(`/api/cashflow/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteCashFlowEntry(id: string): Promise<{ ok: true }> {
  return request(`/api/cashflow/entries/${id}`, { method: "DELETE" });
}

export function importCashFlowHistory(input: {
  accountId: string;
  sheets: { name: string; rows: (string | number | boolean | null)[][] }[];
  oneOffKeys: string[];
  keyMap: Record<string, string>;
  today: string;
}): Promise<{ importedMonths: number; entries: number; items: number; skippedMonths: string[]; sheetErrors: { sheetName: string; error: string }[] }> {
  return request("/api/cashflow/history-import", { method: "POST", body: JSON.stringify(input) });
}

export interface BankImportRow {
  date: string;
  rawDescription: string;
  amount: number;
  direction: "in" | "out";
  forceImport?: boolean;
}

export function importBankTransactions(
  accountId: string,
  rows: BankImportRow[]
): Promise<{ transactions: BankTransaction[]; counts: { total: number; review: number; skipped: number; duplicates: number }; duplicates: BankImportRow[] }> {
  return request("/api/bank-transactions/import", { method: "POST", body: JSON.stringify({ accountId, rows }) });
}

export function updateBankTransaction(
  id: string,
  patch: { type?: BankTxnType; needsReview?: boolean; parentId?: string; newParentName?: string; category?: string }
): Promise<BankTransaction> {
  return request(`/api/bank-transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteBankTransactions(ids: string[]): Promise<{ deletedCount: number }> {
  return request("/api/bank-transactions", { method: "DELETE", body: JSON.stringify({ ids }) });
}

export function confirmBankMatches(matches: { bankTransactionId: string; entryId: string }[]): Promise<{ matched: number }> {
  return request("/api/cashflow/matches", { method: "POST", body: JSON.stringify({ matches }) });
}

export function unlinkBankMatch(bankTransactionId: string): Promise<{ ok: true }> {
  return request("/api/cashflow/matches", { method: "DELETE", body: JSON.stringify({ bankTransactionId }) });
}
