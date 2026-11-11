import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { readJsonObject } from "@/lib/request";
import { isOutstanding } from "@/lib/cashflow";
import { linkEntry, unlinkEntry } from "@/lib/cashflowState";

const MAX_MATCHES = 5000;

// Confirms matches between bank lines and cash-flow entries — all or
// nothing, so a stale suggestion (a line or entry linked elsewhere since the
// page loaded) rejects the whole batch instead of applying half of it.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const matches = body.matches;
  if (
    !Array.isArray(matches) ||
    matches.length === 0 ||
    matches.length > MAX_MATCHES ||
    !matches.every((m) => m && typeof m.bankTransactionId === "string" && typeof m.entryId === "string")
  ) {
    return NextResponse.json({ error: "matches must be a list of { bankTransactionId, entryId }" }, { status: 400 });
  }
  const txnIds = new Set(matches.map((m) => m.bankTransactionId));
  const entryIds = new Set(matches.map((m) => m.entryId));
  if (txnIds.size !== matches.length || entryIds.size !== matches.length) {
    return NextResponse.json({ error: "Each bank line and each entry can only be matched once" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    for (const m of matches as { bankTransactionId: string; entryId: string }[]) {
      const txn = state.bankTransactions.find((t) => t.id === m.bankTransactionId);
      const entry = state.cashFlowEntries.find((e) => e.id === m.entryId);
      if (!txn || !entry) return { error: "A bank line or entry no longer exists — refresh and try again" };
      if (txn.entryId || entry.bankTransactionId || !isOutstanding(entry)) return { error: `"${entry.name}" or its bank line is already matched or done — refresh and try again` };
      if ((entry.kind === "deposit") !== (txn.direction === "in")) return { error: `"${entry.name}" and that bank line go in opposite directions` };
      const failure = linkEntry(state, entry, txn);
      if (failure) {
        return {
          error:
            failure.error === "no_month"
              ? `The bank line for "${entry.name}" is dated in a month that hasn't been started yet`
              : `"${entry.name}" belongs to a different account than its bank line`,
        };
      }
    }
    return { matched: matches.length };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

// Unlinks one bank line from its entry; the entry keeps its status.
export async function DELETE(request: Request) {
  const body = await readJsonObject(request);
  if (typeof body.bankTransactionId !== "string") return NextResponse.json({ error: "bankTransactionId is required" }, { status: 400 });
  const { result } = await updateState((state) => {
    const txn = state.bankTransactions.find((t) => t.id === body.bankTransactionId);
    if (!txn) return { error: "not_found" as const };
    if (!txn.entryId) return { error: "not_linked" as const };
    unlinkEntry(state, txn);
    return { ok: true as const };
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error === "not_found" ? "Bank transaction not found" : "That bank line isn't matched" }, { status: result.error === "not_found" ? 404 : 400 });
  }
  return NextResponse.json({ ok: true });
}
