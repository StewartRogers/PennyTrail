import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/templates/[id]">) {
  const { id } = await ctx.params;

  const { result: deleted } = await updateState((state) => {
    const before = state.templates.length;
    state.templates = state.templates.filter((t) => t.id !== id);
    return state.templates.length < before;
  });

  if (!deleted) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
