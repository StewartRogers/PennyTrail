/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsonRequest } from "./testStore";

// Thin wrappers over the Cash Flow route handlers for API tests. Each loads
// the route module fresh (see testStore.ts for why a dynamic import is
// required after vi.resetModules()).

const params = (id: string) => ({ params: Promise.resolve({ id }) });

export async function call<T = any>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

export async function createAccount(overrides: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/bank-accounts/route");
  return call(POST(jsonRequest("http://test/api/bank-accounts", "POST", { name: "Chequing", institution: "Bank", last4: "0000", ...overrides })));
}

export async function patchAccount(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/bank-accounts/[id]/route");
  return call(PATCH(jsonRequest(`http://test/api/bank-accounts/${id}`, "PATCH", body), params(id)));
}

export async function deleteAccount(id: string) {
  const { DELETE } = await import("@/app/api/bank-accounts/[id]/route");
  return call(DELETE(jsonRequest(`http://test/api/bank-accounts/${id}`, "DELETE"), params(id)));
}

export async function createItem(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/cashflow/items/route");
  return call(POST(jsonRequest("http://test/api/cashflow/items", "POST", body)));
}

export async function patchItem(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/cashflow/items/[id]/route");
  return call(PATCH(jsonRequest(`http://test/api/cashflow/items/${id}`, "PATCH", body), params(id)));
}

export async function deleteItem(id: string) {
  const { DELETE } = await import("@/app/api/cashflow/items/[id]/route");
  return call(DELETE(jsonRequest(`http://test/api/cashflow/items/${id}`, "DELETE"), params(id)));
}

export async function startMonth(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/cashflow/months/route");
  return call(POST(jsonRequest("http://test/api/cashflow/months", "POST", body)));
}

export async function patchMonth(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/cashflow/months/[id]/route");
  return call(PATCH(jsonRequest(`http://test/api/cashflow/months/${id}`, "PATCH", body), params(id)));
}

export async function deleteMonth(id: string, body?: unknown) {
  const { DELETE } = await import("@/app/api/cashflow/months/[id]/route");
  return call(DELETE(jsonRequest(`http://test/api/cashflow/months/${id}`, "DELETE", body), params(id)));
}

export async function addEntry(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/cashflow/entries/route");
  return call(POST(jsonRequest("http://test/api/cashflow/entries", "POST", body)));
}

export async function patchEntry(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/cashflow/entries/[id]/route");
  return call(PATCH(jsonRequest(`http://test/api/cashflow/entries/${id}`, "PATCH", body), params(id)));
}

export async function deleteEntry(id: string) {
  const { DELETE } = await import("@/app/api/cashflow/entries/[id]/route");
  return call(DELETE(jsonRequest(`http://test/api/cashflow/entries/${id}`, "DELETE"), params(id)));
}

export async function importHistory(body: unknown) {
  const { POST } = await import("@/app/api/cashflow/history-import/route");
  return call(POST(jsonRequest("http://test/api/cashflow/history-import", "POST", body)));
}

export async function importBank(body: unknown) {
  const { POST } = await import("@/app/api/bank-transactions/import/route");
  return call(POST(jsonRequest("http://test/api/bank-transactions/import", "POST", body)));
}

export async function patchBankTxn(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/bank-transactions/[id]/route");
  return call(PATCH(jsonRequest(`http://test/api/bank-transactions/${id}`, "PATCH", body), params(id)));
}

export async function deleteBankTxns(body?: unknown) {
  const { DELETE } = await import("@/app/api/bank-transactions/route");
  return call(DELETE(jsonRequest("http://test/api/bank-transactions", "DELETE", body)));
}

export async function confirmMatches(body: unknown) {
  const { POST } = await import("@/app/api/cashflow/matches/route");
  return call(POST(jsonRequest("http://test/api/cashflow/matches", "POST", body)));
}

export async function unlinkMatch(body: unknown) {
  const { DELETE } = await import("@/app/api/cashflow/matches/route");
  return call(DELETE(jsonRequest("http://test/api/cashflow/matches", "DELETE", body)));
}

export async function readStore() {
  const { readState } = await import("@/lib/store");
  return readState();
}
