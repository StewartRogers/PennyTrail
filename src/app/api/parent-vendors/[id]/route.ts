import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { findParentByName } from "@/lib/vendors";

export async function PATCH(request: Request, ctx: RouteContext<"/api/parent-vendors/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const hasName = typeof body.name === "string" && !!body.name.trim();
  const hasCategory = typeof body.category === "string" && !!body.category;
  if (!hasName && !hasCategory) {
    return NextResponse.json({ error: "name or category is required" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    const parent = state.parentVendors.find((p) => p.id === id);
    if (!parent) return { error: "not_found" as const };
    if (hasCategory && !state.categories.some((c) => c.id === body.category)) return { error: "invalid_category" as const };
    if (hasName && findParentByName(state.parentVendors, body.name.trim(), id)) return { error: "duplicate_name" as const };

    if (hasName) parent.name = body.name.trim();
    // Changing the category here is instant and complete for every
    // transaction under this parent — category is derived live via
    // childVendorId -> parentId -> category, so there's no separate
    // propagation step that could apply inconsistently or go stale.
    if (hasCategory) parent.category = body.category;

    return { parent };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    if (result.error === "duplicate_name") return NextResponse.json({ error: "A parent with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  return NextResponse.json(result.parent);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/parent-vendors/[id]">) {
  const { id } = await ctx.params;

  const { result } = await updateState((state) => {
    const before = state.parentVendors.length;
    state.parentVendors = state.parentVendors.filter((p) => p.id !== id);
    if (state.parentVendors.length === before) return { error: "not_found" as const };

    // A parent never exists without at least one vendor (they're created
    // together — see transactions/[id]/route.ts) — so removing a parent
    // removes every vendor linked to it, and any transaction that pointed
    // at one of those vendors goes back to needing review.
    const removedChildIds = new Set(state.childVendors.filter((c) => c.parentId === id).map((c) => c.id));
    state.childVendors = state.childVendors.filter((c) => c.parentId !== id);

    let affectedCount = 0;
    for (const txn of state.transactions) {
      if (txn.childVendorId && removedChildIds.has(txn.childVendorId)) {
        txn.childVendorId = null;
        txn.needsReview = true;
        affectedCount++;
      }
    }

    return { removedChildren: removedChildIds.size, affectedCount };
  });

  if ("error" in result) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  return NextResponse.json(result);
}
