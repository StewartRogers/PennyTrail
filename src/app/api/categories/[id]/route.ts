import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();

  const { result: category } = await updateState((state) => {
    const category = state.categories.find((c) => c.id === id);
    if (!category) return null;
    if (typeof body.name === "string") category.name = body.name;
    return category;
  });

  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  return NextResponse.json(category);
}
