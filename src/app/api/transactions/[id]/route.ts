import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { cleanVendorName } from "@/lib/classify";
import { findChildByRawName, findParentByName } from "@/lib/vendors";
import type { ChildVendor, ParentVendor, TxnType } from "@/lib/types";

const VALID_TYPES: TxnType[] = ["purchase", "payment", "credit", "cashback", "fee"];

export async function PATCH(request: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();

  const { result } = await updateState((state) => {
    const txn = state.transactions.find((t) => t.id === id);
    if (!txn) return { error: "not_found" as const };

    if (typeof body.type === "string" && VALID_TYPES.includes(body.type as TxnType)) {
      txn.type = body.type as TxnType;
    }

    if (typeof body.childVendorId === "string") {
      // Reassign to an existing vendor — a direct id change, always
      // authoritative (see resolveVendor's contract in classify.ts).
      if (!state.childVendors.some((c) => c.id === body.childVendorId)) return { error: "invalid_child" as const };
      txn.childVendorId = body.childVendorId;
      txn.needsReview = false;
    } else if (typeof body.parentId === "string" && body.parentId) {
      // Reassign to an existing parent vendor by id (used by the
      // Transactions page's vendor picker) — find or create the vendor
      // that represents this transaction's own cleaned name, rather than
      // requiring the caller to resolve a childVendorId itself. Vendor
      // names are unique, so this looks up by name *globally*, not scoped
      // to the target parent — if the name already exists under a
      // different parent, that vendor (and everything else linked to it)
      // moves to the requested parent instead of forking a duplicate.
      if (!state.parentVendors.some((p) => p.id === body.parentId)) return { error: "invalid_parent" as const };
      const rawName = cleanVendorName(txn.rawDescription);
      let child = findChildByRawName(state.childVendors, rawName);
      if (child) {
        child.parentId = body.parentId;
      } else {
        child = { id: uid("child"), parentId: body.parentId, rawName };
        state.childVendors.push(child);
      }
      txn.childVendorId = child.id;
      txn.needsReview = false;
    } else if (typeof body.newParentName === "string" && body.newParentName.trim() && typeof body.category === "string" && body.category) {
      // First-occurrence path: no existing vendor covers this transaction,
      // so create a brand-new Parent+Child pair for it. Parent names and
      // vendor names are each unique.
      if (!state.categories.some((c) => c.id === body.category)) return { error: "invalid_category" as const };
      const newParentName = body.newParentName.trim();
      if (findParentByName(state.parentVendors, newParentName)) return { error: "duplicate_parent" as const };
      const rawName = cleanVendorName(txn.rawDescription);
      if (findChildByRawName(state.childVendors, rawName)) return { error: "duplicate_vendor" as const };
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
    if (result.error === "not_found") return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    if (result.error === "invalid_child") return NextResponse.json({ error: "Unknown child vendor" }, { status: 400 });
    if (result.error === "invalid_parent") return NextResponse.json({ error: "Unknown parent vendor" }, { status: 400 });
    if (result.error === "duplicate_parent") return NextResponse.json({ error: "A parent with this name already exists" }, { status: 409 });
    if (result.error === "duplicate_vendor")
      return NextResponse.json({ error: "A vendor for this exact description already exists under a different parent" }, { status: 409 });
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  return NextResponse.json(result.txn);
}
