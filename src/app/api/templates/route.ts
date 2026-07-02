import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import type { Template } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || !body.bank) {
    return NextResponse.json({ error: "Template name and bank are required" }, { status: 400 });
  }

  const { result: template } = await updateState((state) => {
    const newTemplate: Template = {
      id: uid("tpl"),
      name: body.name,
      bank: body.bank,
      network: body.network === "Mastercard" ? "Mastercard" : "Visa",
      dateCol: Number(body.dateCol),
      descCol: Number(body.descCol),
      dateFormat: body.dateFormat,
      amountMode: body.amountMode === "split" ? "split" : "single",
      amountCol: Number(body.amountCol ?? -1),
      amountConvention: body.amountConvention === "negative_is_purchase" ? "negative_is_purchase" : "positive_is_purchase",
      debitCol: Number(body.debitCol ?? -1),
      creditCol: Number(body.creditCol ?? -1),
      vendorCol: Number(body.vendorCol ?? -1),
      categoryCol: Number(body.categoryCol ?? -1),
      typeCol: Number(body.typeCol ?? -1),
      skipRows: Number(body.skipRows ?? 0),
      headerSnapshot: Array.isArray(body.headerSnapshot) ? body.headerSnapshot : [],
    };
    state.templates.push(newTemplate);
    return newTemplate;
  });

  return NextResponse.json(template, { status: 201 });
}
