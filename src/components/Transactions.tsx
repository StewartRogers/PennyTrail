"use client";

import { useMemo, useState } from "react";
import type { AppState, Transaction, TxnType } from "@/lib/types";
import { deleteAllTransactions, updateTransaction } from "@/lib/api";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { TYPE_META, SYSTEM_CATEGORY_FOR_TYPE } from "@/lib/categories";
import { PageTitle, ColorDot, inputStyle, SecondaryButton } from "./ui";
import { useToast } from "./ToastContext";

export interface TxnFilterSeed {
  search?: string;
  categoryFilter?: string;
  cardFilter?: string;
  typeFilter?: TxnType | "all";
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

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
    setVisibleCount(PAGE_SIZE);
  }

  const cardById = useMemo(() => new Map(appState.cards.map((c) => [c.id, c])), [appState.cards]);
  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const spendCategories = useMemo(() => appState.categories.filter((c) => !c.system), [appState.categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appState.transactions.filter((t) => {
      if (q && !t.vendor.toLowerCase().includes(q) && !t.rawDescription.toLowerCase().includes(q)) return false;
      if (cardFilter !== "all" && t.cardId !== cardFilter) return false;
      if (categoryFilter === "needs_review" && !t.needsReview) return false;
      else if (categoryFilter !== "all" && categoryFilter !== "needs_review" && t.category !== categoryFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return true;
    });
  }, [appState.transactions, search, cardFilter, categoryFilter, typeFilter]);

  const visible = filtered.slice(0, visibleCount);

  async function commitVendor(t: Transaction, vendor: string) {
    if (vendor === t.vendor) return;
    await updateTransaction(t.id, { vendor });
    await onReload();
  }

  async function commitCategory(t: Transaction, category: string) {
    await updateTransaction(t.id, { category: category || null, needsReview: false });
    await onReload();
  }

  async function commitType(t: Transaction, type: TxnType) {
    if (type === t.type) return;
    // Non-purchase types always carry their fixed system category; switching
    // back to purchase clears it so the row asks for a real spend category.
    const category = type === "purchase" ? null : SYSTEM_CATEGORY_FOR_TYPE[type] ?? null;
    await updateTransaction(t.id, { type, category, needsReview: type === "purchase" });
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

  return (
    <div>
      <PageTitle>Transactions</PageTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
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
          {appState.categories.map((c) => (
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
      </div>

      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
        {filtered.length} transaction{filtered.length === 1 ? "" : "s"}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
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
              const category = t.category ? categoryById.get(t.category) : null;
              const typeMeta = TYPE_META[t.type];
              return (
                <tr key={t.id} style={{ background: t.needsReview ? "oklch(0.58 0.13 35 / 0.06)" : undefined }}>
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
                    <VendorInput vendor={t.vendor} onCommit={(v) => commitVendor(t, v)} />
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    {t.type === "purchase" ? (
                      <select
                        value={t.category || ""}
                        onChange={(e) => commitCategory(t, e.target.value)}
                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 12.5 }}
                      >
                        <option value="">Uncategorized</option>
                        {spendCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{category?.name || "—"}</span>
                    )}
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

function VendorInput({ vendor, onCommit }: { vendor: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(vendor);
  const [prevVendor, setPrevVendor] = useState(vendor);
  if (vendor !== prevVendor) {
    setPrevVendor(vendor);
    setValue(vendor);
  }
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="inline-editable"
      title="Click to edit vendor"
      style={{
        background: "transparent",
        fontSize: 13,
        padding: "4px 6px",
        borderRadius: 6,
        width: 150,
        fontFamily: "var(--font-sans), sans-serif",
      }}
    />
  );
}
