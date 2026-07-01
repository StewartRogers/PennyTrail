import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";

export async function PATCH(request: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();

  const { result: txn } = await updateState((state) => {
    const txn = state.transactions.find((t) => t.id === id);
    if (!txn) return null;

    if (typeof body.vendor === "string") txn.vendor = body.vendor;
    if (typeof body.category === "string" || body.category === null) {
      txn.category = body.category;
    }
    if (typeof body.needsReview === "boolean") txn.needsReview = body.needsReview;

    if (body.rememberVendor && txn.category) {
      const pattern = txn.rawDescription.toUpperCase().replace(/\d{3,}/g, "");
      state.vendorRules.push({
        id: uid("rule"),
        pattern,
        vendor: txn.vendor,
        category: txn.category,
      });
    }

    return txn;
  });

  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  return NextResponse.json(txn);
}
