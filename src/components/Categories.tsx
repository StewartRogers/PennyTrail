"use client";

import { useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { addCategory, updateCategory } from "@/lib/api";
import { CATEGORY_PALETTE } from "@/lib/categories";
import { fmtCurrency } from "@/lib/format";
import { useToast } from "./ToastContext";
import { PageTitle, PrimaryButton, inputStyle } from "./ui";

export function Categories({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const totals = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of appState.transactions) {
      if (!t.category) continue;
      const entry = map.get(t.category) || { total: 0, count: 0 };
      entry.total += t.amount;
      entry.count += 1;
      map.set(t.category, entry);
    }
    return map;
  }, [appState.transactions]);

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

  return (
    <div>
      <PageTitle>Categories</PageTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640, marginBottom: 22 }}>
        {appState.categories.map((c) => {
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
              {c.system ? (
                <div style={{ flex: 1, fontSize: 14, color: "var(--muted)" }}>
                  {c.name} <span style={{ fontSize: 11 }}>(automatic)</span>
                </div>
              ) : (
                <input
                  defaultValue={c.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== c.name) handleRename(c.id, e.target.value.trim());
                  }}
                  style={{
                    flex: 1,
                    border: "1px solid transparent",
                    background: "transparent",
                    fontSize: 14,
                    padding: "5px 6px",
                    borderRadius: 6,
                  }}
                />
              )}
              <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {fmtCurrency(stats.total)} · {stats.count} txns
              </div>
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
