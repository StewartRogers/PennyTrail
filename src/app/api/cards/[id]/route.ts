import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();

  const { result: card } = await updateState((state) => {
    const card = state.cards.find((c) => c.id === id);
    if (!card) return null;
    if (typeof body.name === "string") card.name = body.name;
    if (typeof body.bank === "string") card.bank = body.bank;
    if (body.network === "Visa" || body.network === "Mastercard") card.network = body.network;
    return card;
  });

  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json(card);
}
