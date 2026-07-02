import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function DELETE() {
  const { result: deletedCount } = await updateState((state) => {
    const count = state.transactions.length;
    state.transactions = [];
    return count;
  });

  return NextResponse.json({ deletedCount });
}
