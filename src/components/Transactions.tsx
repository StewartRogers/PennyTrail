"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction, TxnType } from "@/lib/types";
import { deleteAllTransactions, deleteTransactions, updateTransaction } from "@/lib/api";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { TYPE_META, sortCategoriesByName } from "@/lib/categories";
import { categoryIdForTransaction, netAmountForTransaction, parentIdForTransaction, vendorNameForTransaction } from "@/lib/vendors";
import { PageTitle, ColorDot, inputStyle, SecondaryButton } from "./ui";
import { useToast } from "./ToastContext";
import { TransactionEditModal, type TransactionEditPatch } from "./TransactionEditModal";

export interface TxnFilterSeed {
  search?: string;
  categoryFilter?: string;
  cardFilter?: string;
  typeFilter?: TxnType | "all";
  vendorFilter?: string; // a ParentVendor id
  childVendorFilter?: string; // a ChildVendor id — narrower than vendorFilter, for a single raw vendor name
  dateFrom?: string; // ISO yyyy-mm-dd, inclusive
  dateTo?: string; // ISO yyyy-mm-dd, inclusive
  amountMin?: string; // gross amount (Transaction.amount, before reimbursement), inclusive
  amountMax?: string; // gross amount (Transaction.amount, before reimbursement), inclusive
}

const PAGE_SIZE = 40;

export function Transactions({
  appState,
  onReload,
  seed,
  seedKey,
}: {
  appState: AppState;
  onReload: () => Promise<void>;
  seed: TxnFilterSeed;
  seedKey: number;
}) {
  const pushToast = useToast();
  // Seeded from `seed` directly (not a plain "" / "all" / null default): the
  // Transactions screen is conditionally rendered in App.tsx, so navigating
  // here from a Dashboard/Averages/VendorMappings drill-down always mounts a
  // fresh instance — the seedKey-change effect below never fires on that
  // first render, since `appliedSeedKey` starts out equal to the very
  // seedKey it would be comparing against.
  const [search, setSearch] = useState(seed.search ?? "");
  const [cardFilter, setCardFilter] = useState(seed.cardFilter ?? "all");
  const [categoryFilter, setCategoryFilter] = useState(seed.categoryFilter ?? "all");
  const [typeFilter, setTypeFilter] = useState<TxnType | "all">(seed.typeFilter ?? "all");
  const [vendorFilter, setVendorFilter] = useState<string | null>(seed.vendorFilter ?? null);
  const [childVendorFilter, setChildVendorFilter] = useState<string | null>(seed.childVendorFilter ?? null);
  const [dateFrom, setDateFrom] = useState(seed.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(seed.dateTo ?? "");
  const [amountMin, setAmountMin] = useState(seed.amountMin ?? "");
  const [amountMax, setAmountMax] = useState(seed.amountMax ?? "");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDeleteSelected, setConfirmingDeleteSelected] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [confirmingDeleteFiltered, setConfirmingDeleteFiltered] = useState(false);
  const [deletingFiltered, setDeletingFiltered] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);

  // Re-applies a new seed if this instance ever receives one without
  // unmounting first (it doesn't today — every current caller navigates in
  // from a different screen, which remounts fresh and picks up the seed via
  // the useState initializers above instead). Kept as a safety net, done
  // during render rather than in an effect since it's adjusting state in
  // response to a prop change rather than syncing with an external system.
  const [appliedSeedKey, setAppliedSeedKey] = useState(seedKey);
  if (seedKey !== appliedSeedKey) {
    setAppliedSeedKey(seedKey);
    setSearch(seed.search ?? "");
    setCardFilter(seed.cardFilter ?? "all");
    setCategoryFilter(seed.categoryFilter ?? "all");
    setTypeFilter(seed.typeFilter ?? "all");
    setVendorFilter(seed.vendorFilter ?? null);
    setChildVendorFilter(seed.childVendorFilter ?? null);
    setDateFrom(seed.dateFrom ?? "");
    setDateTo(seed.dateTo ?? "");
    setAmountMin(seed.amountMin ?? "");
    setAmountMax(seed.amountMax ?? "");
    setVisibleCount(PAGE_SIZE);
    setSelectedIds(new Set());
    setConfirmingDeleteSelected(false);
    setConfirmingDeleteFiltered(false);
  }

  const cardById = useMemo(() => new Map(appState.cards.map((c) => [c.id, c])), [appState.cards]);
  const sortedCards = useMemo(() => [...appState.cards].sort((a, b) => a.name.localeCompare(b.name)), [appState.cards]);
  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const sortedCategories = useMemo(() => sortCategoriesByName(appState.categories), [appState.categories]);
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);
  const sortedParents = useMemo(
    () => [...appState.parentVendors].sort((a, b) => a.name.localeCompare(b.name)),
    [appState.parentVendors]
  );
  const sortedChildren = useMemo(
    () => [...appState.childVendors].sort((a, b) => a.rawName.localeCompare(b.rawName)),
    [appState.childVendors]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appState.transactions.filter((t) => {
      const vendorName = vendorNameForTransaction(t, childById) || "";
      if (q && !vendorName.toLowerCase().includes(q) && !t.rawDescription.toLowerCase().includes(q)) return false;
      if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
      if (categoryFilter === "needs_review" && !t.needsReview) return false;
      else if (categoryFilter !== "all" && categoryFilter !== "needs_review" && categoryIdForTransaction(t, childById, parentById) !== categoryFilter)
        return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (vendorFilter && parentIdForTransaction(t, childById) !== vendorFilter) return false;
      if (childVendorFilter && t.childVendorId !== childVendorFilter) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (amountMin && t.amount < Number(amountMin)) return false;
      if (amountMax && t.amount > Number(amountMax)) return false;
      return true;
    });
  }, [
    appState.transactions,
    search,
    cardFilter,
    categoryFilter,
    typeFilter,
    vendorFilter,
    childVendorFilter,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    childById,
    parentById,
  ]);

  const visible = filtered.slice(0, visibleCount);

  // "Delete filtered" is only offered once a filter actually narrows the
  // list — with no filter active, filtered === every transaction, which is
  // exactly what "Delete all transactions…" below already does.
  const isFiltered =
    search.trim() !== "" ||
    cardFilter !== "all" ||
    categoryFilter !== "all" ||
    typeFilter !== "all" ||
    !!vendorFilter ||
    !!childVendorFilter ||
    !!dateFrom ||
    !!dateTo ||
    !!amountMin ||
    !!amountMax;

  // Changing a filter can take previously-selected rows out of view — clear
  // the selection along with resetting pagination so "N selected" can never
  // silently refer to rows the user can no longer see and didn't intend to
  // act on (e.g. selecting rows under one card filter, switching to another
  // card, and deleting what looks like a fresh selection). A pending
  // "delete filtered" confirmation is also for a set that just changed
  // under it, so it's cleared the same way.
  function resetForFilterChange() {
    setVisibleCount(PAGE_SIZE);
    setSelectedIds(new Set());
    setConfirmingDeleteSelected(false);
    setConfirmingDeleteFiltered(false);
  }

  function resetAllFilters() {
    setSearch("");
    setCardFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setVendorFilter(null);
    setChildVendorFilter(null);
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
    resetForFilterChange();
  }

  async function handleSaveEdit(t: Transaction, patch: TransactionEditPatch): Promise<string | null> {
    try {
      await updateTransaction(t.id, patch);
      await onReload();
      pushToast("Transaction updated");
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Failed to update transaction";
    }
  }

  async function handleDeleteAll() {
    setDeletingAll(true);
    try {
      const { deletedCount } = await deleteAllTransactions();
      await onReload();
      setConfirmingDeleteAll(false);
      pushToast(`Deleted ${deletedCount} transaction${deletedCount === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to delete transactions");
    } finally {
      setDeletingAll(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const allSelected = visible.length > 0 && visible.every((t) => prev.has(t.id));
      const next = new Set(prev);
      for (const t of visible) {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    setDeletingSelected(true);
    try {
      const { deletedCount } = await deleteTransactions(Array.from(selectedIds));
      await onReload();
      setSelectedIds(new Set());
      setConfirmingDeleteSelected(false);
      pushToast(`Deleted ${deletedCount} transaction${deletedCount === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to delete selected transactions");
    } finally {
      setDeletingSelected(false);
    }
  }

  // Deletes every transaction matching the current filters, not just the
  // ones paginated into `visible` — so this reaches rows beyond "Load more"
  // without the user having to click through every page to select them.
  async function handleDeleteFiltered() {
    setDeletingFiltered(true);
    try {
      const { deletedCount } = await deleteTransactions(filtered.map((t) => t.id));
      await onReload();
      setSelectedIds(new Set());
      setConfirmingDeleteFiltered(false);
      pushToast(`Deleted ${deletedCount} transaction${deletedCount === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to delete filtered transactions");
    } finally {
      setDeletingFiltered(false);
    }
  }

  return (
    <div>
      <PageTitle>Transactions</PageTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetForFilterChange();
          }}
          placeholder="Search vendor or description…"
          style={{ ...inputStyle, flex: 1, minWidth: 200, padding: "9px 12px", fontSize: 13.5 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetForFilterChange();
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetForFilterChange();
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          Min $
          <input
            type="number"
            step="0.01"
            min="0"
            value={amountMin}
            onChange={(e) => {
              setAmountMin(e.target.value);
              resetForFilterChange();
            }}
            style={{ ...inputStyle, width: 90 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          Max $
          <input
            type="number"
            step="0.01"
            min="0"
            value={amountMax}
            onChange={(e) => {
              setAmountMax(e.target.value);
              resetForFilterChange();
            }}
            style={{ ...inputStyle, width: 90 }}
          />
        </label>
        <select
          value={cardFilter}
          onChange={(e) => {
            setCardFilter(e.target.value);
            resetForFilterChange();
          }}
          style={inputStyle}
        >
          <option value="all">All Cards</option>
          {sortedCards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={vendorFilter ?? "all"}
          onChange={(e) => {
            setVendorFilter(e.target.value === "all" ? null : e.target.value);
            resetForFilterChange();
          }}
          style={inputStyle}
        >
          <option value="all">All Parents</option>
          {sortedParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={childVendorFilter ?? "all"}
          onChange={(e) => {
            setChildVendorFilter(e.target.value === "all" ? null : e.target.value);
            resetForFilterChange();
          }}
          style={inputStyle}
        >
          <option value="all">All Vendors</option>
          {sortedChildren.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rawName.trim() || "(no description)"}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            resetForFilterChange();
          }}
          style={inputStyle}
        >
          <option value="all">All Categories</option>
          <option value="needs_review">⚠ Needs Review</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as TxnType | "all");
            resetForFilterChange();
          }}
          style={inputStyle}
        >
          <option value="all">All Types</option>
          <option value="purchase">Purchase</option>
          <option value="payment">Payment</option>
          <option value="credit">Credit</option>
          <option value="cashback">Cashback</option>
          <option value="fee">Fee / Interest</option>
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {filtered.length} transaction{filtered.length === 1 ? "" : "s"}
        </div>
        {isFiltered && (
          <button
            onClick={resetAllFilters}
            style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
          >
            Reset filters
          </button>
        )}
        {isFiltered && filtered.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {confirmingDeleteFiltered ? (
              <>
                <span style={{ fontSize: 12.5, color: "var(--attention)" }}>
                  Delete all {filtered.length} filtered transaction{filtered.length === 1 ? "" : "s"}?
                </span>
                <button
                  onClick={handleDeleteFiltered}
                  disabled={deletingFiltered}
                  style={{
                    border: "1px solid var(--attention)",
                    background: "var(--attention)",
                    color: "white",
                    borderRadius: 8,
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: deletingFiltered ? "not-allowed" : "pointer",
                    opacity: deletingFiltered ? 0.7 : 1,
                  }}
                >
                  {deletingFiltered ? "Deleting…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmingDeleteFiltered(false)}
                  disabled={deletingFiltered}
                  style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmingDeleteFiltered(true)}
                title="Delete every transaction matching the current filters, not just what's loaded on this page"
                style={{ border: "1px solid var(--attention)", background: "transparent", color: "var(--attention)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
              >
                Delete filtered…
              </button>
            )}
          </div>
        )}
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{selectedIds.size} selected</span>
            {confirmingDeleteSelected ? (
              <>
                <span style={{ fontSize: 12.5, color: "var(--attention)" }}>Delete {selectedIds.size} transaction{selectedIds.size === 1 ? "" : "s"}?</span>
                <button
                  onClick={handleDeleteSelected}
                  disabled={deletingSelected}
                  style={{
                    border: "1px solid var(--attention)",
                    background: "var(--attention)",
                    color: "white",
                    borderRadius: 8,
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: deletingSelected ? "not-allowed" : "pointer",
                    opacity: deletingSelected ? 0.7 : 1,
                  }}
                >
                  {deletingSelected ? "Deleting…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmingDeleteSelected(false)}
                  disabled={deletingSelected}
                  style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmingDeleteSelected(true)}
                  style={{ border: "1px solid var(--attention)", background: "transparent", color: "var(--attention)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
                >
                  Delete selected…
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", width: 1 }}>
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((t) => selectedIds.has(t.id))}
                  ref={(el) => {
                    if (el) el.indeterminate = visible.some((t) => selectedIds.has(t.id)) && !visible.every((t) => selectedIds.has(t.id));
                  }}
                  onChange={toggleSelectAllVisible}
                  title="Select all loaded transactions"
                />
              </th>
              {["Date", "Card", "Parent", "Vendor", "Category", "Type", "Net Amount"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 6 ? "right" : "left",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--muted)",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const card = cardById.get(t.cardId);
              const categoryId = categoryIdForTransaction(t, childById, parentById);
              const category = categoryId ? categoryById.get(categoryId) : null;
              const typeMeta = TYPE_META[t.type];
              const vendorName = vendorNameForTransaction(t, childById);
              const parentId = parentIdForTransaction(t, childById);
              const parentName = parentId ? parentById.get(parentId)?.name : null;
              return (
                <tr
                  key={t.id}
                  onClick={() => setEditingTxn(t)}
                  title="Edit this transaction"
                  style={{ background: t.needsReview ? "oklch(0.58 0.13 35 / 0.06)" : undefined, cursor: "pointer" }}
                >
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleSelected(t.id)}
                      aria-label={`Select transaction ${fmtDateShort(t.date)} ${t.rawDescription} ${fmtCurrency(t.amount)}`}
                    />
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>
                    {fmtDateShort(t.date)}
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    {card && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <ColorDot color={card.color} size={7} />
                        {card.name}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "9px 12px",
                      borderBottom: "1px solid var(--border)",
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={parentName || "— Unassigned —"}
                  >
                    <span style={{ fontSize: 13, color: parentName ? undefined : "var(--muted)" }}>{parentName || "— Unassigned —"}</span>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span
                      style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: vendorName?.trim() ? undefined : "italic" }}
                      title={vendorName?.trim() || "(no description)"}
                    >
                      {vendorName?.trim() || "(no description)"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{category?.name || "—"}</span>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <span
                      style={{
                        display: "inline-block",
                        borderRadius: 20,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        background: typeMeta.color,
                        color: "white",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {typeMeta.label}
                    </span>
                    {t.excludeFromDashboard && (
                      <span title="Excluded from Dashboard & Averages" style={{ marginLeft: 6, fontSize: 12, color: "var(--muted)" }}>
                        ⊘
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                    <AmountCell txn={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibleCount < filtered.length && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <SecondaryButton onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>Load more</SecondaryButton>
        </div>
      )}

      {appState.transactions.length > 0 && (
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          {!confirmingDeleteAll ? (
            <button
              onClick={() => setConfirmingDeleteAll(true)}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12.5,
                color: "var(--attention)",
              }}
            >
              Delete all transactions…
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                border: "1px solid var(--attention)",
                borderRadius: 8,
                padding: "12px 14px",
                background: "oklch(0.58 0.13 35 / 0.06)",
              }}
            >
              <div style={{ fontSize: 13, flex: 1, minWidth: 220 }}>
                Delete all {appState.transactions.length} transaction{appState.transactions.length === 1 ? "" : "s"}? Cards,
                categories, and templates are kept — this cannot be undone.
              </div>
              <SecondaryButton onClick={() => setConfirmingDeleteAll(false)}>Cancel</SecondaryButton>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll}
                style={{
                  background: "var(--attention)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: deletingAll ? "not-allowed" : "pointer",
                  opacity: deletingAll ? 0.7 : 1,
                }}
              >
                {deletingAll ? "Deleting…" : "Yes, delete all"}
              </button>
            </div>
          )}
        </div>
      )}

      {editingTxn && (
        <TransactionEditModal
          txn={editingTxn}
          card={cardById.get(editingTxn.cardId)}
          currentParentId={parentIdForTransaction(editingTxn, childById)}
          currentVendorName={vendorNameForTransaction(editingTxn, childById)}
          parents={sortedParents}
          categories={sortedCategories}
          onClose={() => setEditingTxn(null)}
          onSave={(patch) => handleSaveEdit(editingTxn, patch)}
        />
      )}
    </div>
  );
}

function AmountCell({ txn }: { txn: Transaction }) {
  const hasReimbursement = !!txn.reimbursedAmount;
  const net = netAmountForTransaction(txn);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <div style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>
        {fmtCurrency(hasReimbursement ? net : txn.amount)}
      </div>
      {hasReimbursement && (
        <div style={{ fontSize: 11, color: "var(--muted)", textDecoration: "line-through" }}>{fmtCurrency(txn.amount)}</div>
      )}
    </div>
  );
}
