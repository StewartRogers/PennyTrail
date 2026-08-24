import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";

export async function PATCH(request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const { id } = await ctx.params;
  const body = await readJsonObject(request);

  for (const field of ["name", "bank", "last4"] as const) {
    if (typeof body[field] === "string" && body[field].length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "Card details are too long" }, { status: 400 });
    }
  }

  const { result: card } = await updateState((state) => {
    const card = state.cards.find((c) => c.id === id);
    if (!card) return null;
    if (typeof body.name === "string") card.name = body.name;
    if (typeof body.bank === "string") card.bank = body.bank;
    if (typeof body.last4 === "string") card.last4 = body.last4;
    if (body.network === "Visa" || body.network === "Mastercard") card.network = body.network;
    if (typeof body.currency === "string" && body.currency.trim()) {
      const currency = body.currency.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(currency)) card.currency = currency;
    }
    return card;
  });

  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json(card);
}
