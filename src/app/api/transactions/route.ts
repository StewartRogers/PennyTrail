import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string") : null;

  const { result: deletedCount } = await updateState((state) => {
    if (ids) {
      const idSet = new Set(ids);
      const before = state.transactions.length;
      state.transactions = state.transactions.filter((t) => !idSet.has(t.id));
      return before - state.transactions.length;
    }
    const count = state.transactions.length;
    state.transactions = [];
    return count;
  });

  return NextResponse.json({ deletedCount });
}
