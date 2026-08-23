import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { classifyTransactionType, cleanVendorName, resolveVendor } from "@/lib/classify";
import { findChildByRawName, findParentByName } from "@/lib/vendors";
import { readJsonObject, readString } from "@/lib/request";
import type { ChildVendor, ParentVendor, Transaction } from "@/lib/types";

interface ImportRow {
  date: string;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
  // Set on a resubmit of a row the user already saw flagged as a duplicate
  // (see DuplicateRow below) and chose to add anyway — e.g. two genuinely
  // separate same-day, same-amount payments to the same vendor. Bypasses
  // the seenKeys check for this row only; every other validation still runs.
  forceImport?: boolean;
}

interface DuplicateRow {
  date: string;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
}

// Same card, date, description, and amount as an existing transaction — the
// shape of "this exact statement line was already imported" (e.g. the same
// CSV dropped in twice). Not part of the Transaction type itself since two
// genuinely different purchases can collide on it (rare, but a same-day
// same-amount trip to the same vendor is real) — so it drives a skip-and-report,
// not a hard uniqueness constraint.
function duplicateKey(cardId: string, date: string, rawDescription: string, amount: number): string {
  return `${cardId}\0${date}\0${rawDescription}\0${Math.abs(amount)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

// One statement import is bounded by what a card issuer will export; anything
// past this is a malformed or hostile request, and every mutation re-serializes
// the whole store, so an oversized batch slows every later request forever.
const MAX_IMPORT_ROWS = 20000;

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const cardId = readString(body.cardId);
  const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `Too many rows in one import (max ${MAX_IMPORT_ROWS})` }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    if (!state.cards.some((c) => c.id === cardId)) {
      return { error: "Unknown card" as const };
    }

    const created: Transaction[] = [];
    const duplicates: DuplicateRow[] = [];
    // Seeded from what's already on file, then grown as rows are created
    // below — so a repeated line *within* the same file (not just a whole
    // file re-imported) is also caught, not just collisions against history.
    const seenKeys = new Set(
      state.transactions.map((t) => duplicateKey(t.cardId, t.date, t.rawDescription, t.amount))
    );
    let skipped = 0;
    for (const row of rows) {
      if (
        typeof row.amount !== "number" ||
        !Number.isFinite(row.amount) ||
        typeof row.date !== "string" ||
        !ISO_DATE.test(row.date) ||
        typeof row.rawDescription !== "string" ||
        typeof row.isCharge !== "boolean" ||
        !isOptionalString(row.vendorOverride) ||
        !isOptionalString(row.categoryText) ||
        !isOptionalString(row.typeText) ||
        !isOptionalBoolean(row.forceImport)
      ) {
        // A bad/missing amount, date, or description (e.g. an unparseable
        // or malformed CSV cell) would otherwise be stored as-is and
        // permanently corrupt this transaction (wrong sort order, crashes
        // in code that assumes these are strings) — drop the row instead
        // and surface the count to the caller.
        //
        // isCharge must be a real boolean: a missing or string value made
        // `!isCharge` true, so classifyTransactionType silently returned
        // "payment" for a purchase and every dashboard total came up short.
        // The date must be the ISO yyyy-mm-dd that the Transaction contract
        // and every consumer assume — "03/15/2024" sorts lexicographically
        // ahead of all ISO dates and renders as "Invalid Date". The optional
        // text overrides must be strings or absent; a number reaching
        // row.categoryText.trim() below threw a raw TypeError out of the
        // mutator, discarding every already-processed row in the batch.
        skipped++;
        continue;
      }

      const key = duplicateKey(cardId, row.date, row.rawDescription, row.amount);
      // forceImport skips the report-and-drop below — the user already saw
      // this exact row flagged as a duplicate and chose to add it anyway.
      if (seenKeys.has(key) && !row.forceImport) {
        duplicates.push({
          date: row.date,
          rawDescription: row.rawDescription,
          amount: Math.abs(row.amount),
          isCharge: row.isCharge,
          vendorOverride: row.vendorOverride,
          categoryText: row.categoryText,
          typeText: row.typeText,
        });
        continue;
      }
      seenKeys.add(key);

      const type = classifyTransactionType(row.rawDescription, row.isCharge, row.typeText, row.vendorOverride);
      const cleanedName = cleanVendorName(row.vendorOverride || row.rawDescription);

      let childVendorId: string | null = null;
      let needsReview = true;

      const match = resolveVendor(cleanedName, state.childVendors, state.parentVendors);
      if (match.kind === "exact") {
        childVendorId = match.childVendorId;
        needsReview = false;
      } else if (match.kind === "fuzzy") {
        // A fuzzy match is a token-containment guess, not a confirmed
        // identity — link it as a starting point but still surface it for
        // review, since a short parent name can contain-match an unrelated
        // longer name (e.g. "Shell" inside "Shell Vacations Club").
        const child: ChildVendor = { id: uid("child"), parentId: match.parentId, rawName: cleanedName };
        state.childVendors.push(child);
        childVendorId = child.id;
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

    return {
      transactions: created,
      counts: { total: created.length, auto, review, skipped, duplicates: duplicates.length },
      duplicates,
    };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
