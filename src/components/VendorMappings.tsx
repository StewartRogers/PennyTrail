"use client";

import { useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { deleteChildVendor, deleteParentVendor, mergeParentVendors, moveChildVendor, updateParentVendor } from "@/lib/api";
import { sortCategoriesByName } from "@/lib/categories";
import { parentIdForTransaction } from "@/lib/vendors";
import { PageTitle, ColorDot, inputStyle, SegmentedControl } from "./ui";
import { useToast } from "./ToastContext";

type View = "parents" | "vendors";

export function VendorMappings({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();
  const [view, setView] = useState<View>("parents");
  const [search, setSearch] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const sortedCategories = useMemo(() => sortCategoriesByName(appState.categories), [appState.categories]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);
  const sortedParents = useMemo(
    () => [...appState.parentVendors].sort((a, b) => a.name.localeCompare(b.name)),
    [appState.parentVendors]
  );

  const txnCountByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of appState.transactions) {
      const parentId = parentIdForTransaction(t, childById);
      if (!parentId) continue;
      counts.set(parentId, (counts.get(parentId) || 0) + 1);
    }
    return counts;
  }, [appState.transactions, childById]);

  const childCountByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of appState.childVendors) {
      counts.set(c.parentId, (counts.get(c.parentId) || 0) + 1);
    }
    return counts;
  }, [appState.childVendors]);

  const txnCountByChild = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of appState.transactions) {
      if (!t.childVendorId) continue;
      counts.set(t.childVendorId, (counts.get(t.childVendorId) || 0) + 1);
    }
    return counts;
  }, [appState.transactions]);

  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedParents;
    return sortedParents.filter((p) => p.name.toLowerCase().includes(q));
  }, [sortedParents, search]);

  const sortedChildren = useMemo(
    () => [...appState.childVendors].sort((a, b) => a.rawName.localeCompare(b.rawName)),
    [appState.childVendors]
  );

  const filteredChildren = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedChildren;
    return sortedChildren.filter((c) => {
      if (c.rawName.toLowerCase().includes(q)) return true;
      const parentName = parentById.get(c.parentId)?.name ?? "";
      return parentName.toLowerCase().includes(q);
    });
  }, [sortedChildren, search, parentById]);

  async function handleRename(parentId: string, name: string, revert: () => void) {
    try {
      await updateParentVendor(parentId, { name });
      await onReload();
    } catch (err) {
      revert();
      pushToast(err instanceof Error ? err.message : "Failed to rename vendor");
    }
  }

  async function handleCategoryChange(parentId: string, category: string) {
    try {
      await updateParentVendor(parentId, { category });
      await onReload();
      pushToast(`Category updated to "${categoryById.get(category)?.name ?? category}"`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to update category");
    }
  }

  async function handleDelete(parentId: string, name: string) {
    try {
      const { removedChildren, affectedCount } = await deleteParentVendor(parentId);
      await onReload();
      setConfirmingDeleteId(null);
      const parts = [`Removed "${name}"`];
      if (removedChildren > 0) parts.push(`${removedChildren} vendor name${removedChildren === 1 ? "" : "s"} with it`);
      if (affectedCount > 0) parts.push(`${affectedCount} transaction${affectedCount === 1 ? "" : "s"} now need review`);
      pushToast(parts.join(" — "));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to remove vendor");
    }
  }

  async function handleMerge(fromId: string, fromName: string, intoId: string) {
    try {
      const { movedCount } = await mergeParentVendors(fromId, intoId);
      await onReload();
      setMergingId(null);
      pushToast(`Merged "${fromName}" — moved ${movedCount} vendor name${movedCount === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to merge vendors");
    }
  }

  async function handleMoveChild(childId: string, parentId: string) {
    try {
      await moveChildVendor(childId, parentId);
      await onReload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to move vendor");
    }
  }

  async function handleDeleteChild(childId: string, rawName: string) {
    try {
      const { affectedCount, parentRemoved } = await deleteChildVendor(childId);
      await onReload();
      const parts = [`Removed "${rawName}"`];
      if (parentRemoved) parts.push("it was the last vendor for its parent, so that parent was removed too");
      if (affectedCount > 0) parts.push(`${affectedCount} transaction${affectedCount === 1 ? "" : "s"} now need review`);
      pushToast(parts.join(" — "));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to remove vendor name");
    }
  }

  return (
    <div>
      <PageTitle>Vendor Mappings</PageTitle>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18, maxWidth: 680 }}>
        Every vendor has a name and a category. Every raw description PennyTrail has matched to a vendor is
        listed on the Vendors tab, with a dropdown to move it to a different vendor. Changing a vendor&apos;s
        category instantly applies to everything linked to it — category always comes from the vendor, never
        a copy stored on the transaction.
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <SegmentedControl
          options={[
            { value: "parents", label: "Parents" },
            { value: "vendors", label: "Vendors" },
          ]}
          value={view}
          onChange={setView}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={view === "parents" ? "Search parents…" : "Search vendors…"}
          style={{ ...inputStyle, maxWidth: 320, flex: "0 1 320px" }}
        />
      </div>

      {view === "parents" && (
        <>
          {filteredParents.length === 0 ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "18px 20px", maxWidth: 640, color: "var(--muted)", fontSize: 13.5 }}>
              {appState.parentVendors.length === 0
                ? <>No parents yet — the first transaction you categorize for a new vendor creates its parent and vendor together.</>
                : <>No parents match &quot;{search}&quot;.</>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
              {filteredParents.map((parent) => {
                const category = categoryById.get(parent.category);
                const count = txnCountByParent.get(parent.id) ?? 0;
                return (
                  <div
                    key={parent.id}
                    style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}
                  >
                    <ColorDot color={category?.color ?? "var(--muted)"} size={14} />
                    <input
                      key={parent.id + parent.name}
                      defaultValue={parent.name}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        const target = e.target;
                        if (value && value !== parent.name) {
                          handleRename(parent.id, value, () => {
                            target.value = parent.name;
                          });
                        } else {
                          e.target.value = parent.name;
                        }
                      }}
                      className="inline-editable"
                      title="Rename this parent"
                      style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, background: "transparent", padding: "3px 5px", borderRadius: 5 }}
                    />
                    <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {count} txn{count === 1 ? "" : "s"}
                    </div>
                    <select value={parent.category} onChange={(e) => handleCategoryChange(parent.id, e.target.value)} style={{ ...inputStyle, minWidth: 160 }}>
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    {mergingId === parent.id ? (
                      <select
                        autoFocus
                        value=""
                        onChange={(e) => {
                          if (e.target.value) handleMerge(parent.id, parent.name, e.target.value);
                        }}
                        style={{ ...inputStyle, minWidth: 160 }}
                      >
                        <option value="">Merge into…</option>
                        {sortedParents
                          .filter((p) => p.id !== parent.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setMergingId(parent.id)}
                        title="Merge this parent's vendors into another parent"
                        style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}
                      >
                        Merge…
                      </button>
                    )}

                    {confirmingDeleteId === parent.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {(childCountByParent.get(parent.id) ?? 0) > 0 && (
                          <span style={{ fontSize: 11.5, color: "var(--attention)", whiteSpace: "nowrap" }}>
                            + {childCountByParent.get(parent.id)} vendor{childCountByParent.get(parent.id) === 1 ? "" : "s"}
                          </span>
                        )}
                        <button
                          onClick={() => handleDelete(parent.id, parent.name)}
                          style={{ border: "1px solid var(--attention)", background: "transparent", color: "var(--attention)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}
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
                        onClick={() => setConfirmingDeleteId(parent.id)}
                        title="Delete this parent and every vendor linked to it (their transactions go back to needing review)"
                        style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600 }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === "vendors" && (
        <>
          {filteredChildren.length === 0 ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "18px 20px", maxWidth: 640, color: "var(--muted)", fontSize: 13.5 }}>
              {appState.childVendors.length === 0
                ? <>No vendors yet — they&apos;re created the first time a transaction is matched or categorized.</>
                : <>No vendors match &quot;{search}&quot;.</>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
              {filteredChildren.map((child) => {
                const parent = parentById.get(child.parentId);
                const category = parent ? categoryById.get(parent.category) : undefined;
                const count = txnCountByChild.get(child.id) ?? 0;
                return (
                  <div
                    key={child.id}
                    style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}
                  >
                    <ColorDot color={category?.color ?? "var(--muted)"} size={14} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={child.rawName}>
                      {child.rawName}
                    </span>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {count} txn{count === 1 ? "" : "s"}
                    </div>
                    <select
                      value={child.parentId}
                      onChange={(e) => handleMoveChild(child.id, e.target.value)}
                      title="Parent vendor"
                      style={{ ...inputStyle, minWidth: 180 }}
                    >
                      {sortedParents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDeleteChild(child.id, child.rawName)}
                      title="Remove this vendor name (its transactions go back to needing review)"
                      style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
