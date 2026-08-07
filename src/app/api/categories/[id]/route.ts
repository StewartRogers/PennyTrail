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
