import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { cleanVendorName } from "@/lib/classify";
import { findChildByRawName, findParentByName } from "@/lib/vendors";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";
import type { ChildVendor, ParentVendor, TxnType } from "@/lib/types";

const VALID_TYPES: TxnType[] = ["purchase", "payment", "credit", "cashback", "fee"];

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, mo, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  if (typeof body.newParentName === "string" && body.newParentName.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Vendor name is too long" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    const txn = state.transactions.find((t) => t.id === id);
    if (!txn) return { error: "not_found" as const };

    if (typeof body.type === "string" && VALID_TYPES.includes(body.type as TxnType)) {
      txn.type = body.type as TxnType;
    }

    if (typeof body.date === "string") {
      if (!isValidIsoDate(body.date)) return { error: "invalid_date" as const };
      txn.date = body.date;
    }

    if (body.amount !== undefined) {
      if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
        return { error: "invalid_amount" as const };
      }
      txn.amount = body.amount;
      // A reimbursement can't exceed the transaction it's reimbursing — if
      // editing the amount down would break that, bring the reimbursement
      // down with it rather than rejecting an otherwise-valid amount fix.
      if (txn.reimbursedAmount !== undefined && txn.reimbursedAmount > txn.amount) {
        txn.reimbursedAmount = txn.amount;
      }
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
      let child = rawName ? findChildByRawName(state.childVendors, rawName) : undefined;
      if (!child && !rawName) {
        // This transaction has no text of its own to name a distinct child
        // from (e.g. the source statement left its description blank for
        // this row) — reuse a real child already under the target parent
        // instead of matching (or minting another) blank-named one, which
        // otherwise left every such reassignment stuck pointing at the same
        // nameless vendor no matter which parent the user picked.
        const siblings = state.childVendors.filter((c) => c.parentId === body.parentId);
        child = siblings.find((c) => c.rawName.trim() !== "") ?? siblings[0];
      }
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
      // A blank rawName (the source statement left this row's description
      // empty) isn't a real identity to dedupe on — every such transaction
      // normalizes to the same "" key, so this would flag *any* existing
      // blank-named child anywhere (even the one already on this very
      // transaction) as a collision and permanently block naming it.
      const existingChild = rawName ? findChildByRawName(state.childVendors, rawName) : undefined;
      if (existingChild) {
        const existingParentName = state.parentVendors.find((p) => p.id === existingChild.parentId)?.name ?? "another parent";
        return { error: "duplicate_vendor" as const, existingParentName };
      }
      const parent: ParentVendor = { id: uid("vnd"), name: newParentName, category: body.category };
      const child: ChildVendor = { id: uid("child"), parentId: parent.id, rawName };
      state.parentVendors.push(parent);
      state.childVendors.push(child);
      txn.childVendorId = child.id;
      txn.needsReview = false;
    }

    if (typeof body.needsReview === "boolean") txn.needsReview = body.needsReview;
    if (typeof body.excludeFromDashboard === "boolean") txn.excludeFromDashboard = body.excludeFromDashboard;

    if (body.reimbursedAmount !== undefined) {
      if (body.reimbursedAmount === null) {
        delete txn.reimbursedAmount;
      } else {
        if (typeof body.reimbursedAmount !== "number" || !Number.isFinite(body.reimbursedAmount) || body.reimbursedAmount < 0) {
          return { error: "invalid_reimbursed_amount" as const };
        }
        if (body.reimbursedAmount > txn.amount) return { error: "reimbursed_amount_too_large" as const };
        txn.reimbursedAmount = body.reimbursedAmount;
      }
    }

    return { txn };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    if (result.error === "invalid_child") return NextResponse.json({ error: "Unknown child vendor" }, { status: 400 });
    if (result.error === "invalid_parent") return NextResponse.json({ error: "Unknown parent vendor" }, { status: 400 });
    if (result.error === "invalid_date") return NextResponse.json({ error: "Date must be a valid date (yyyy-mm-dd)" }, { status: 400 });
    if (result.error === "invalid_amount") return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    if (result.error === "duplicate_parent") return NextResponse.json({ error: "A parent with this name already exists" }, { status: 409 });
    if (result.error === "duplicate_vendor")
      return NextResponse.json(
        { error: `This vendor already exists under "${result.existingParentName}" — pick that parent from the dropdown instead of creating a new one` },
        { status: 409 }
      );
    if (result.error === "invalid_reimbursed_amount") return NextResponse.json({ error: "Reimbursed amount must be a non-negative number" }, { status: 400 });
    if (result.error === "reimbursed_amount_too_large") return NextResponse.json({ error: "Reimbursed amount can't exceed the transaction amount" }, { status: 400 });
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  return NextResponse.json(result.txn);
}
