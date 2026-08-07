import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject, readString } from "@/lib/request";
import type { Category } from "@/lib/types";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const name = readString(body.name);
  const color = readString(body.color);
  if (!name || !color) {
    return NextResponse.json({ error: "Category name and color are required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH || color.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Category name or color is too long" }, { status: 400 });
  }

  const { result: category } = await updateState((state) => {
    const newCategory: Category = { id: uid("cat"), name, color };
    state.categories.push(newCategory);
    return newCategory;
  });

  return NextResponse.json(category, { status: 201 });
}
