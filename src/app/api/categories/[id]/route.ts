import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";

export async function PATCH(request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  if (typeof body.name === "string" && body.name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Category name is too long" }, { status: 400 });
  }

  const { result: category } = await updateState((state) => {
    const category = state.categories.find((c) => c.id === id);
    if (!category) return null;
    if (typeof body.name === "string") category.name = body.name;
    if (typeof body.excludeFromDashboard === "boolean") category.excludeFromDashboard = body.excludeFromDashboard;
    return category;
  });

  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  return NextResponse.json(category);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  const { id } = await ctx.params;

  const { result } = await updateState((state) => {
    if (!state.categories.some((c) => c.id === id)) return { error: "not_found" as const };
    // Category is never stored on a Transaction — it's always derived via
    // childVendorId -> ChildVendor.parentId -> ParentVendor.category (see
    // categoryIdForTransaction in vendors.ts) — so checking parents already
    // guarantees no transaction can be linked to this category either;
    // there's no separate transaction-level reference to check.
    const inUseCount = state.parentVendors.filter((p) => p.category === id).length;
    if (inUseCount > 0) return { error: "in_use" as const, inUseCount };

    state.categories = state.categories.filter((c) => c.id !== id);
    return { ok: true as const };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Category not found" }, { status: 404 });
    return NextResponse.json(
      { error: `Category is used by ${result.inUseCount} vendor${result.inUseCount === 1 ? "" : "s"} — reassign or remove them first` },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
