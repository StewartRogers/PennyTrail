import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { detachBankLines } from "@/lib/cashflowState";

// Same rules as DELETE /api/transactions: a wipe must be asked for with
// `{ all: true }` (optionally narrowed to one accountId); a missing,
// unparseable, or unrecognized body is a 400, never "delete everything".
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
  const hasIds = isObject && "ids" in body;
  const wantsAll = isObject && (body as { all?: unknown }).all === true;
  if (hasIds && wantsAll) return NextResponse.json({ error: "Pass either ids or all, not both" }, { status: 400 });
  if (hasIds && !(Array.isArray(body.ids) && (body.ids as unknown[]).every((id): id is string => typeof id === "string"))) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }
  if (!hasIds && !wantsAll) return NextResponse.json({ error: "Pass ids (an array of bank transaction ids) or all: true" }, { status: 400 });
  if (wantsAll && body.accountId !== undefined && typeof body.accountId !== "string") {
    return NextResponse.json({ error: "accountId must be an id" }, { status: 400 });
  }

  const { result: deletedCount } = await updateState((state) => {
    const doomed = new Set(
      state.bankTransactions
        .filter((t) => (hasIds ? (body.ids as string[]).includes(t.id) : body.accountId === undefined || t.accountId === body.accountId))
        .map((t) => t.id)
    );
    state.bankTransactions = state.bankTransactions.filter((t) => !doomed.has(t.id));
    detachBankLines(state, doomed);
    return doomed.size;
  });
  return NextResponse.json({ deletedCount });
}
