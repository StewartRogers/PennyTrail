import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  // Wiping the entire transaction history has to be asked for explicitly, via
  // `{ all: true }`. It used to be the *fallback* for any body that didn't
  // parse as an object with an "ids" key, which meant a truncated or aborted
  // request, a key typo, or a bare JSON array all destroyed every transaction
  // and returned 200 — an unrecoverable data loss reported as success. Now
  // anything that isn't a recognized shape is rejected instead.
  const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
  const hasIds = isObject && "ids" in body;
  const wantsAll = isObject && (body as { all?: unknown }).all === true;

  if (hasIds && wantsAll) {
    return NextResponse.json({ error: "Pass either ids or all, not both" }, { status: 400 });
  }
  if (hasIds && !(Array.isArray(body.ids) && (body.ids as unknown[]).every((id): id is string => typeof id === "string"))) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }
  if (!hasIds && !wantsAll) {
    return NextResponse.json({ error: "Pass ids (an array of transaction ids) or all: true" }, { status: 400 });
  }
  const ids: string[] | null = hasIds ? (body.ids as string[]) : null;

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
