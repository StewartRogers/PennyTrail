"use client";

import { useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { addCategory, deleteCategory, updateCategory } from "@/lib/api";
import { CATEGORY_PALETTE, sortCategoriesByName } from "@/lib/categories";
import { categoryIdForTransaction, categorySpendForTransaction } from "@/lib/vendors";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "./ToastContext";
import { PageTitle, PrimaryButton, inputStyle } from "./ui";

export function Categories({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);

  // A category is never stored on a Transaction — it's always derived via
  // childVendorId -> ChildVendor.parentId -> ParentVendor.category — so a
  // category with zero parents pointing at it can't have any transaction
  // linked to it either. This count alone is the full "in use" check.
  const parentCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of appState.parentVendors) {
      map.set(p.category, (map.get(p.category) || 0) + 1);
    }
    return map;
  }, [appState.parentVendors]);

  const totals = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of appState.transactions) {
      const category = categoryIdForTransaction(t, childById, parentById);
      if (!category) continue;
      const entry = map.get(category) || { total: 0, count: 0 };
      entry.total += categorySpendForTransaction(t);
      entry.count += 1;
      map.set(category, entry);
    }
    return map;
  }, [appState.transactions, childById, parentById]);

  const sortedCategories = useMemo(() => sortCategoriesByName(appState.categories), [appState.categories]);

  const usedColors = new Set(appState.categories.map((c) => c.color));
  const defaultColor = CATEGORY_PALETTE.find((c) => !usedColors.has(c)) || CATEGORY_PALETTE[0];
  const swatchColor = selectedColor || defaultColor;

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    try {
      await addCategory({ name, color: swatchColor });
      setNewName("");
      setSelectedColor(null);
      await onReload();
      pushToast(`Added category "${name}"`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to add category");
    }
  }

  // These inputs are uncontrolled, so a rejected rename used to leave the
  // typed-but-unsaved name on screen for the rest of the session while the
  // dashboard and every vendor dropdown still showed the old one. `revert`
  // puts the DOM value back; the key below re-mounts on a successful rename.
  async function handleRename(id: string, name: string, revert: () => void) {
    try {
      await updateCategory(id, { name });
      await onReload();
    } catch (err) {
      revert();
      pushToast(err instanceof Error ? err.message : "Failed to rename category");
    }
  }

  async function handleToggleExclude(id: string, excludeFromDashboard: boolean) {
    try {
      await updateCategory(id, { excludeFromDashboard });
      await onReload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to update category");
    }
  }

  async function handleDelete(id: string, name: string) {
    try {
      await deleteCategory(id);
      await onReload();
      setConfirmingDeleteId(null);
      pushToast(`Removed "${name}"`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to remove category");
    }
  }

  return (
    <div>
      <PageTitle>Categories</PageTitle>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel)", marginBottom: 22, maxWidth: 760 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 600 }}>
                Category
              </th>
              <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 600 }}>
                Total
              </th>
              <th
                style={{ textAlign: "center", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}
                title="Leave this category's transactions out of every Dashboard total, trend, and breakdown"
              >
                Exclude
              </th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map((c) => {
              const stats = totals.get(c.id) || { total: 0, count: 0 };
              const parentCount = parentCountByCategory.get(c.id) ?? 0;
              return (
                <tr key={c.id}>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                      <input
                        key={c.id + c.name}
                        defaultValue={c.name}
                        onBlur={(e) => {
                          const target = e.target;
                          const value = target.value.trim();
                          if (value && value !== c.name) {
                            handleRename(c.id, value, () => {
                              target.value = c.name;
                            });
                          } else {
                            target.value = c.name;
                          }
                        }}
                        className="inline-editable"
                        title="Click to rename"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: "transparent",
                          fontSize: 14,
                          padding: "5px 6px",
                          borderRadius: 6,
                        }}
                      />
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "9px 12px",
                      borderBottom: "1px solid var(--border)",
                      textAlign: "right",
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtCurrency(stats.total)} · {stats.count} txns
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!c.excludeFromDashboard}
                      onChange={(e) => handleToggleExclude(c.id, e.target.checked)}
                      title="Leave this category's transactions out of every Dashboard total, trend, and breakdown"
                    />
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {confirmingDeleteId === c.id ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => handleDelete(c.id, c.name)}
                          style={{
                            border: "1px solid var(--attention)",
                            background: "transparent",
                            color: "var(--attention)",
                            borderRadius: 8,
                            padding: "7px 10px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600 }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingDeleteId(c.id)}
                        disabled={parentCount > 0}
                        title={
                          parentCount > 0
                            ? `${parentCount} vendor${parentCount === 1 ? "" : "s"} use this category — reassign or remove them first`
                            : "Delete this category"
                        }
                        style={{
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: parentCount > 0 ? "var(--border)" : "var(--muted)",
                          borderRadius: 8,
                          padding: "7px 10px",
                          fontSize: 12.5,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          cursor: parentCount > 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px", maxWidth: 480 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>+ Add a category</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            style={{ ...inputStyle, flex: 1 }}
          />
          <PrimaryButton onClick={handleAdd}>Add</PrimaryButton>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CATEGORY_PALETTE.map((color) => (
            <div
              key={color}
              onClick={() => setSelectedColor(color)}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: color,
                cursor: "pointer",
                border: swatchColor === color ? "2px solid var(--text)" : "2px solid transparent",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
