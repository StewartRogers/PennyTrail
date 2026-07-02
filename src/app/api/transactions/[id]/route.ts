import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { buildVendorRulePattern, MIN_PATTERN_LENGTH } from "@/lib/classify";
import type { TxnType } from "@/lib/types";

const VALID_TYPES: TxnType[] = ["purchase", "payment", "credit", "cashback", "fee"];

export async function PATCH(request: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();

  const { result: txn } = await updateState((state) => {
    const txn = state.transactions.find((t) => t.id === id);
    if (!txn) return null;

    if (typeof body.vendor === "string") txn.vendor = body.vendor;
    if (typeof body.type === "string" && VALID_TYPES.includes(body.type as TxnType)) {
      txn.type = body.type as TxnType;
    }
    if (typeof body.category === "string" || body.category === null) {
      txn.category = body.category;
    }
    if (typeof body.needsReview === "boolean") txn.needsReview = body.needsReview;

    if (body.rememberVendor && txn.category) {
      // Prefer the vendor name over the raw description: it's what future
      // classification actually matches against (see classifyTransaction's
      // vendorHint preference), and some banks map a generic merchant-
      // category description separately from the specific vendor name —
      // learning from description there would generalize on the category,
      // not the vendor. Only fall back to description if vendor is blank.
      const pattern = buildVendorRulePattern(txn.vendor || txn.rawDescription);
      if (pattern.length >= MIN_PATTERN_LENGTH) {
        state.vendorRules.push({
          id: uid("rule"),
          pattern,
          vendor: txn.vendor,
          category: txn.category,
        });
      }
    }

    return txn;
  });

  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  return NextResponse.json(txn);
}
