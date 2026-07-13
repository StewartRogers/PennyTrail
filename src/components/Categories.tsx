"use client";

import { useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { addCategory, updateCategory } from "@/lib/api";
import { CATEGORY_PALETTE, sortCategoriesByName } from "@/lib/categories";
import { categoryIdForTransaction } from "@/lib/vendors";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "./ToastContext";
import { PageTitle, PrimaryButton, inputStyle } from "./ui";

export function Categories({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);

  const totals = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of appState.transactions) {
      const category = categoryIdForTransaction(t, childById, parentById);
      if (!category) continue;
      const entry = map.get(category) || { total: 0, count: 0 };
      entry.total += t.amount;
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
    await addCategory({ name, color: swatchColor });
    setNewName("");
    setSelectedColor(null);
    await onReload();
    pushToast(`Added category "${name}"`);
  }

  async function handleRename(id: string, name: string) {
    await updateCategory(id, { name });
    await onReload();
  }

  async function handleToggleExclude(id: string, excludeFromDashboard: boolean) {
    await updateCategory(id, { excludeFromDashboard });
    await onReload();
  }

  return (
    <div>
      <PageTitle>Categories</PageTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640, marginBottom: 22 }}>
        {sortedCategories.map((c) => {
          const stats = totals.get(c.id) || { total: 0, count: 0 };
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
              <input
                defaultValue={c.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== c.name) handleRename(c.id, e.target.value.trim());
                }}
                className="inline-editable"
                title="Click to rename"
                style={{
                  flex: 1,
                  background: "transparent",
                  fontSize: 14,
                  padding: "5px 6px",
                  borderRadius: 6,
                }}
              />
              <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {fmtCurrency(stats.total)} · {stats.count} txns
              </div>
              <label
                title="Leave this category's transactions out of every Dashboard total, trend, and breakdown"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={!!c.excludeFromDashboard}
                  onChange={(e) => handleToggleExclude(c.id, e.target.checked)}
                />
                Exclude from Dashboards
              </label>
            </div>
          );
        })}
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
