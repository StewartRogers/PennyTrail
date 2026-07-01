import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import type { Category } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name || "").trim();
  const color = String(body.color || "").trim();
  if (!name || !color) {
    return NextResponse.json({ error: "Category name and color are required" }, { status: 400 });
  }

  const { result: category } = await updateState((state) => {
    const newCategory: Category = { id: uid("cat"), name, color, system: false };
    state.categories.push(newCategory);
    return newCategory;
  });

  return NextResponse.json(category, { status: 201 });
}
