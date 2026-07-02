import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { classifyTransaction } from "@/lib/classify";
import type { Transaction } from "@/lib/types";

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
  const body = await request.json();
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

    const spendCategories = state.categories.filter((c) => !c.system);

    const created: Transaction[] = [];
    for (const row of rows) {
      const classification = classifyTransaction(row.rawDescription, row.isCharge, state.vendorRules, row.typeText, row.vendorOverride);

      if (row.vendorOverride?.trim()) {
        classification.vendor = row.vendorOverride.trim();
      }

      // A mapped Category column only applies to purchase-type rows (system
      // categories — Payment/Credit/Cashback/Fees — stay derived from type).
      // Text that doesn't match an existing category is left alone rather
      // than silently invented, so the row still surfaces for review.
      if (classification.type === "purchase" && row.categoryText?.trim()) {
        const match = spendCategories.find((c) => c.name.toLowerCase() === row.categoryText!.trim().toLowerCase());
        if (match) {
          classification.category = match.id;
          classification.needsReview = false;
        }
      }

      const txn: Transaction = {
        id: uid("txn"),
        cardId,
        date: row.date,
        rawDescription: row.rawDescription,
        amount: Math.abs(row.amount),
        type: classification.type,
        category: classification.category,
        vendor: classification.vendor,
        needsReview: classification.needsReview,
      };
      state.transactions.push(txn);
      created.push(txn);
    }
    state.transactions.sort((a, b) => (a.date < b.date ? 1 : -1));

    const auto = created.filter((t) => !t.needsReview).length;
    const review = created.filter((t) => t.needsReview).length;

    return { transactions: created, counts: { total: created.length, auto, review } };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
