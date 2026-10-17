import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/templates/[id]">) {
  const { id } = await ctx.params;

  const { result } = await updateState((state) => {
    if (!state.templates.some((t) => t.id === id)) return { error: "not_found" as const };
    state.templates = state.templates.filter((t) => t.id !== id);
    return { ok: true as const };
  });

  if ("error" in result) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
