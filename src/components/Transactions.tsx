"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction, TxnType } from "@/lib/types";
import { deleteAllTransactions, deleteTransactions, updateTransaction } from "@/lib/api";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { TYPE_META, sortCategoriesByName } from "@/lib/categories";
import { categoryIdForTransaction, parentIdForTransaction, vendorNameForTransaction } from "@/lib/vendors";
import { PageTitle, ColorDot, inputStyle, SecondaryButton } from "./ui";
import { useToast } from "./ToastContext";

export interface TxnFilterSeed {
  search?: string;
  categoryFilter?: string;
  cardFilter?: string;
  typeFilter?: TxnType | "all";
  vendorFilter?: string; // a ParentVendor id
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
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TxnType | "all">("all");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDeleteSelected, setConfirmingDeleteSelected] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  // Apply an incoming filter seed (e.g. from a dashboard drill-down "View all")
  // during render rather than in an effect, since it's adjusting state in
  // response to a prop change rather than syncing with an external system.
  const [appliedSeedKey, setAppliedSeedKey] = useState(seedKey);
  if (seedKey !== appliedSeedKey) {
    setAppliedSeedKey(seedKey);
    setSearch(seed.search ?? "");
    setCardFilter(seed.cardFilter ?? "all");
    setCategoryFilter(seed.categoryFilter ?? "all");
    setTypeFilter(seed.typeFilter ?? "all");
    setVendorFilter(seed.vendorFilter ?? null);
    setVisibleCount(PAGE_SIZE);
    setSelectedIds(new Set());
    setConfirmingDeleteSelected(false);
  }

  const cardById = useMemo(() => new Map(appState.cards.map((c) => [c.id, c])), [appState.cards]);
  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const sortedCategories = useMemo(() => sortCategoriesByName(appState.categories), [appState.categories]);
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);
  const sortedParents = useMemo(
    () => [...appState.parentVendors].sort((a, b) => a.name.localeCompare(b.name)),
    [appState.parentVendors]
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
      return true;
    });
  }, [appState.transactions, search, cardFilter, categoryFilter, typeFilter, vendorFilter, childById, parentById]);

  const visible = filtered.slice(0, visibleCount);

  async function commitVendorReassign(t: Transaction, parentId: string) {
    if (parentId === parentIdForTransaction(t, childById)) return;
    await updateTransaction(t.id, { parentId });
    await onReload();
  }

  async function commitNewVendor(t: Transaction, name: string, category: string): Promise<boolean> {
    try {
      await updateTransaction(t.id, { newParentName: name, category });
      await onReload();
      pushToast(`Created vendor "${name}"`);
      return true;
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to create vendor");
      return false;
    }
  }

  async function commitType(t: Transaction, type: TxnType) {
    if (type === t.type) return;
    await updateTransaction(t.id, { type });
    await onReload();
  }

  async function handleDeleteAll() {
    setDeletingAll(true);
    try {
      const { deletedCount } = await deleteAllTransactions();
      await onReload();
      setConfirmingDeleteAll(false);
      pushToast(`Deleted ${deletedCount} transaction${deletedCount === 1 ? "" : "s"}`);
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
    } finally {
      setDeletingSelected(false);
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
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Search vendor or description…"
          style={{ ...inputStyle, flex: 1, minWidth: 200, padding: "9px 12px", fontSize: 13.5 }}
        />
        <select
          value={cardFilter}
          onChange={(e) => {
            setCardFilter(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          style={inputStyle}
        >
          <option value="all">All Cards</option>
          {appState.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setVisibleCount(PAGE_SIZE);
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
            setVisibleCount(PAGE_SIZE);
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
        {vendorFilter && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: "5px 10px",
              fontSize: 12.5,
            }}
          >
            Vendor: {parentById.get(vendorFilter)?.name || vendorFilter}
            <button
              onClick={() => {
                setVendorFilter(null);
                setVisibleCount(PAGE_SIZE);
              }}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
            >
              ×
            </button>
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {filtered.length} transaction{filtered.length === 1 ? "" : "s"}
        </div>
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
              {["Date", "Card", "Vendor", "Category", "Type", "Amount"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 5 ? "right" : "left",
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
              return (
                <tr key={t.id} style={{ background: t.needsReview ? "oklch(0.58 0.13 35 / 0.06)" : undefined }}>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelected(t.id)} />
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
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <VendorCell
                      txn={t}
                      currentParentId={parentIdForTransaction(t, childById)}
                      currentVendorName={vendorNameForTransaction(t, childById)}
                      parents={sortedParents}
                      categories={sortedCategories}
                      onReassign={(parentId) => commitVendorReassign(t, parentId)}
                      onCreateNew={(name, category) => commitNewVendor(t, name, category)}
                    />
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{category?.name || "—"}</span>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <select
                      value={t.type}
                      onChange={(e) => commitType(t, e.target.value as TxnType)}
                      style={{
                        border: "none",
                        borderRadius: 20,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        background: typeMeta.color,
                        color: "white",
                      }}
                    >
                      {(Object.keys(TYPE_META) as TxnType[]).map((type) => (
                        <option key={type} value={type} style={{ color: "var(--text)", background: "var(--panel)" }}>
                          {TYPE_META[type].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 500 }}>
                    {fmtCurrency(t.amount)}
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
    </div>
  );
}

function VendorCell({
  txn,
  currentParentId,
  currentVendorName,
  parents,
  categories,
  onReassign,
  onCreateNew,
}: {
  txn: Transaction;
  currentParentId: string | null;
  currentVendorName: string | null;
  parents: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  onReassign: (parentId: string) => void;
  onCreateNew: (name: string, category: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(currentVendorName || "");
  const [newCategory, setNewCategory] = useState(categories[0]?.id || "");

  if (creating) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Vendor name"
          style={{ ...inputStyle, fontSize: 12.5, padding: "5px 6px" }}
        />
        <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ ...inputStyle, fontSize: 12.5, padding: "5px 6px" }}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={async () => {
              if (!newName.trim() || !newCategory) return;
              const ok = await onCreateNew(newName.trim(), newCategory);
              if (ok) setCreating(false);
            }}
            style={{ border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}
          >
            Save
          </button>
          <button
            onClick={() => setCreating(false)}
            style={{ border: "1px solid var(--border)", background: "transparent", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      value={currentParentId ?? ""}
      onChange={(e) => {
        if (e.target.value === "__new__") {
          setNewName(currentVendorName || txn.rawDescription);
          setCreating(true);
        } else {
          onReassign(e.target.value);
        }
      }}
      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 12.5, maxWidth: 200 }}
    >
      {!currentParentId && <option value="">— Unassigned —</option>}
      {parents.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__new__">+ Create new vendor…</option>
    </select>
  );
}
