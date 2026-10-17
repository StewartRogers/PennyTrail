// Backend-independent pieces of the data store, shared by the file store
// (store.ts) and the Postgres store (storePostgres.ts).
import type { AppState } from "./types";
import { defaultCategories } from "./categories";

export function emptyState(): AppState {
  return {
    cards: [],
    categories: defaultCategories(),
    templates: [],
    parentVendors: [],
    childVendors: [],
    transactions: [],
  };
}

// `source` names where the document came from (a file path, a table) so a
// corrupt store says where to look.
export function normalizeState(parsed: unknown, source: string): AppState {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} does not contain a store object — fix or restore it from a backup before retrying`);
  }
  // A hand-edited store missing one of the collections made every route
  // throw a TypeError on first access; fill the gap with its empty default.
  const state = parsed as Record<string, unknown>;
  const defaults = emptyState();
  for (const key of Object.keys(defaults) as (keyof AppState)[]) {
    if (!Array.isArray(state[key])) state[key] = defaults[key];
  }
  return state as unknown as AppState;
}

// Every route signals rejection by returning a discriminated `{ error }`
// object from its mutator and mapping that to a status code. A mutator that
// bails out partway can already have mutated `state` before it hit the
// failing check, so writing unconditionally would persist the changes made by
// a request the caller was told had failed (e.g. PATCH /api/transactions/[id]
// sets txn.type before it validates parentId, so a 400 response still left
// the type change on disk). Treat an `error` key as "abort": drop the mutated
// state without writing, and let the next read re-parse from storage.
export function isAbort(result: unknown): boolean {
  return typeof result === "object" && result !== null && "error" in result;
}
