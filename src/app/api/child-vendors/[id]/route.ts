import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/child-vendors/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const parentId = String(body.parentId || "");
  if (!parentId) return NextResponse.json({ error: "parentId is required" }, { status: 400 });

  const { result } = await updateState((state) => {
    const child = state.childVendors.find((c) => c.id === id);
    if (!child) return { error: "not_found" as const };
    if (!state.parentVendors.some((p) => p.id === parentId)) return { error: "invalid_parent" as const };
    // Reassigning is a plain id change — an explicit user correction, which
    // is authoritative from here on (see resolveVendor's contract).
    child.parentId = parentId;
    return { child };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Child vendor not found" }, { status: 404 });
    return NextResponse.json({ error: "Unknown parent vendor" }, { status: 400 });
  }
  return NextResponse.json(result.child);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/child-vendors/[id]">) {
  const { id } = await ctx.params;

  const { result } = await updateState((state) => {
    const child = state.childVendors.find((c) => c.id === id);
    if (!child) return { error: "not_found" as const };
    const parentId = child.parentId;

    state.childVendors = state.childVendors.filter((c) => c.id !== id);

    let affectedCount = 0;
    for (const txn of state.transactions) {
      if (txn.childVendorId === id) {
        txn.childVendorId = null;
        txn.needsReview = true;
        affectedCount++;
      }
    }

    // A parent never exists without at least one vendor (they're created
    // together) — if that was its last one, the parent goes with it.
    const parentRemoved = !state.childVendors.some((c) => c.parentId === parentId);
    if (parentRemoved) state.parentVendors = state.parentVendors.filter((p) => p.id !== parentId);

    return { affectedCount, parentRemoved };
  });

  if ("error" in result) return NextResponse.json({ error: "Child vendor not found" }, { status: 404 });
  return NextResponse.json(result);
}
