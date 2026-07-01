import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import type { Card, Network } from "@/lib/types";

const CARD_COLORS = [
  "oklch(0.55 0.13 250)",
  "oklch(0.55 0.13 25)",
  "oklch(0.55 0.13 145)",
  "oklch(0.55 0.13 300)",
  "oklch(0.55 0.13 200)",
  "oklch(0.55 0.13 80)",
  "oklch(0.55 0.13 330)",
  "oklch(0.55 0.13 100)",
];

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name || "").trim();
  const bank = String(body.bank || "").trim();
  const last4 = String(body.last4 || "").trim();
  const network: Network = body.network === "Mastercard" ? "Mastercard" : "Visa";
  if (!name) {
    return NextResponse.json({ error: "Card nickname is required" }, { status: 400 });
  }

  const { result: card } = await updateState((state) => {
    const color = CARD_COLORS[state.cards.length % CARD_COLORS.length];
    const newCard: Card = { id: uid("card"), name, bank, network, last4, color };
    state.cards.push(newCard);
    return newCard;
  });

  return NextResponse.json(card, { status: 201 });
}
