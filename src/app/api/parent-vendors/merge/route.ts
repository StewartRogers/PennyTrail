import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { readJsonObject, readString } from "@/lib/request";

// Merges one parent vendor into another: every child moves to the target
// parent (an id reassignment, not a text recompute), then the source
// parent is deleted. No transaction needs touching — category is derived
// live through the child's parentId.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const fromId = readString(body.fromId);
  const intoId = readString(body.intoId);
  if (!fromId || !intoId || fromId === intoId) {
    return NextResponse.json({ error: "fromId and intoId are required and must differ" }, { status: 400 });
  }

  const { result } = await updateState((state) => {
    const from = state.parentVendors.find((p) => p.id === fromId);
    const into = state.parentVendors.find((p) => p.id === intoId);
    if (!from || !into) return { error: "not_found" as const };

    let movedCount = 0;
    for (const child of state.childVendors) {
      if (child.parentId === fromId) {
        child.parentId = intoId;
        movedCount++;
      }
    }
    state.parentVendors = state.parentVendors.filter((p) => p.id !== fromId);

    return { parent: into, movedCount };
  });

  if ("error" in result) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  return NextResponse.json(result);
}
