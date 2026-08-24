import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { findParentByName } from "@/lib/vendors";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import type { ParentVendor } from "@/lib/types";

// A standalone parent with zero vendors — e.g. to pre-create a grouping
// before moving existing vendors into it from the Vendors tab, rather than
// only ever getting one as a side effect of naming a transaction's vendor.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const name = readString(body.name);
  const category = readString(body.category);
  if (!name || !category) {
    return NextResponse.json({ error: "Parent name and category are required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Parent name is too long" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    if (!state.categories.some((c) => c.id === category)) return { error: "invalid_category" as const };
    if (findParentByName(state.parentVendors, name)) return { error: "duplicate_name" as const };

    const parent: ParentVendor = { id: uid("vnd"), name, category };
    state.parentVendors.push(parent);
    return { parent };
  });

  if ("error" in result) {
    if (result.error === "invalid_category") return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    return NextResponse.json({ error: "A parent with this name already exists" }, { status: 409 });
  }
  return NextResponse.json(result.parent, { status: 201 });
}
