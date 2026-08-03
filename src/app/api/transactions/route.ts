import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  // No body (or no "ids" key) at all means "delete everything" — the
  // contract deleteAllTransactions() relies on. But if "ids" IS present,
  // it must be a valid string array; a malformed value (wrong type, e.g. a
  // client bug) is rejected rather than silently falling through to a
  // full wipe.
  const hasIdsKey = body !== null && typeof body === "object" && "ids" in body;
  if (hasIdsKey && !(Array.isArray(body.ids) && (body.ids as unknown[]).every((id): id is string => typeof id === "string"))) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }
  const ids: string[] | null = hasIdsKey ? (body.ids as string[]) : null;

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
