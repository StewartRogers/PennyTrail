import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { classifyTransactionType, cleanVendorName, resolveVendor } from "@/lib/classify";
import { findChildByRawName, findParentByName } from "@/lib/vendors";
import type { ChildVendor, ParentVendor, Transaction } from "@/lib/types";

interface ImportRow {
  date: string;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const cardId = String(body.cardId || "");
  const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    if (!state.cards.some((c) => c.id === cardId)) {
      return { error: "Unknown card" as const };
    }

    const created: Transaction[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (typeof row.amount !== "number" || !Number.isFinite(row.amount)) {
        // A bad/missing amount (e.g. an unparseable CSV cell) would otherwise
        // serialize as `null` and permanently corrupt this transaction —
        // drop the row instead and surface the count to the caller.
        skipped++;
        continue;
      }
      const type = classifyTransactionType(row.rawDescription, row.isCharge, row.typeText, row.vendorOverride);
      const cleanedName = cleanVendorName(row.vendorOverride || row.rawDescription);

      let childVendorId: string | null = null;
      let needsReview = true;

      const match = resolveVendor(cleanedName, state.childVendors, state.parentVendors);
      if (match.kind === "exact") {
        childVendorId = match.childVendorId;
        needsReview = false;
      } else if (match.kind === "fuzzy") {
        const child: ChildVendor = { id: uid("child"), parentId: match.parentId, rawName: cleanedName };
        state.childVendors.push(child);
        childVendorId = child.id;
        needsReview = false;
      } else if (row.categoryText?.trim()) {
        // A mapped Category column names a category this bank already
        // assigns — trust it to create a brand-new vendor immediately
        // rather than asking the user to categorize something the bank
        // itself already told us how to classify. Parent and vendor names
        // are unique, so reuse an existing same-named one if present
        // (there's no user in the loop here to resolve a conflict) instead
        // of forking a duplicate.
        const category = state.categories.find((c) => c.name.toLowerCase() === row.categoryText!.trim().toLowerCase());
        if (category) {
          let parent: ParentVendor | undefined = findParentByName(state.parentVendors, cleanedName);
          if (!parent) {
            parent = { id: uid("vnd"), name: cleanedName, category: category.id };
            state.parentVendors.push(parent);
          }
          let child: ChildVendor | undefined = findChildByRawName(state.childVendors, cleanedName);
          if (!child) {
            child = { id: uid("child"), parentId: parent.id, rawName: cleanedName };
            state.childVendors.push(child);
          }
          childVendorId = child.id;
          needsReview = false;
        }
      }

      const txn: Transaction = {
        id: uid("txn"),
        cardId,
        date: row.date,
        rawDescription: row.rawDescription,
        amount: Math.abs(row.amount),
        type,
        childVendorId,
        needsReview,
      };
      state.transactions.push(txn);
      created.push(txn);
    }
    state.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const auto = created.filter((t) => !t.needsReview).length;
    const review = created.filter((t) => t.needsReview).length;

    return { transactions: created, counts: { total: created.length, auto, review, skipped } };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
