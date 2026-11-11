import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { findChildByRawName, findParentByName } from "@/lib/vendors";
import { BANK_TXN_TYPES, bankVendorName } from "@/lib/bankClassify";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";
import type { BankTxnType, ChildVendor, ParentVendor } from "@/lib/types";

// Edits a bank line's type, review flag, or vendor. The vendor paths mirror
// PATCH /api/transactions/[id] — bank purchases file under the same shared
// vendors and categories as card purchases — but name the vendor from the
// bank text with its prefix removed ("POS MERCHANDISE SDM" → "Sdm").
export async function PATCH(request: Request, ctx: RouteContext<"/api/bank-transactions/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);
  if (body.type !== undefined && (typeof body.type !== "string" || !BANK_TXN_TYPES.includes(body.type as BankTxnType))) {
    return NextResponse.json({ error: `Type must be one of ${BANK_TXN_TYPES.join(", ")}` }, { status: 400 });
  }
  if (typeof body.newParentName === "string" && body.newParentName.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Vendor name is too long" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    const txn = state.bankTransactions.find((t) => t.id === id);
    if (!txn) return { error: "not_found" as const };
    if (typeof body.type === "string") txn.type = body.type as BankTxnType;

    if (typeof body.parentId === "string" && body.parentId) {
      if (!state.parentVendors.some((p) => p.id === body.parentId)) return { error: "invalid_parent" as const };
      const rawName = bankVendorName(txn.rawDescription, txn.direction);
      let child = rawName ? findChildByRawName(state.childVendors, rawName) : undefined;
      if (child) child.parentId = body.parentId;
      else {
        child = { id: uid("child"), parentId: body.parentId, rawName };
        state.childVendors.push(child);
      }
      txn.childVendorId = child.id;
      txn.needsReview = false;
    } else if (typeof body.newParentName === "string" && body.newParentName.trim() && typeof body.category === "string" && body.category) {
      if (!state.categories.some((c) => c.id === body.category)) return { error: "invalid_category" as const };
      const newParentName = body.newParentName.trim();
      if (findParentByName(state.parentVendors, newParentName)) return { error: "duplicate_parent" as const };
      const rawName = bankVendorName(txn.rawDescription, txn.direction);
      const existing = rawName ? findChildByRawName(state.childVendors, rawName) : undefined;
      if (existing) return { error: "duplicate_vendor" as const };
      const parent: ParentVendor = { id: uid("vnd"), name: newParentName, category: body.category };
      const child: ChildVendor = { id: uid("child"), parentId: parent.id, rawName };
      state.parentVendors.push(parent);
      state.childVendors.push(child);
      txn.childVendorId = child.id;
      txn.needsReview = false;
    }
    if (typeof body.needsReview === "boolean") txn.needsReview = body.needsReview;
    return { txn };
  });

  if ("error" in result) {
    const messages: Record<string, [string, number]> = {
      not_found: ["Bank transaction not found", 404],
      invalid_parent: ["Unknown parent vendor", 400],
      invalid_category: ["Unknown category", 400],
      duplicate_parent: ["A parent with this name already exists", 409],
      duplicate_vendor: ["This vendor already exists — pick its parent instead of creating a new one", 409],
    };
    const [message, status] = messages[result.error as string];
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(result.txn);
}
