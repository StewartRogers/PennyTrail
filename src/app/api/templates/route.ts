import { NextResponse } from "next/server";
import { updateState } from "@/lib/store";
import { uid } from "@/lib/id";
import { MAX_NAME_LENGTH, readJsonObject } from "@/lib/request";
import type { Template } from "@/lib/types";

const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "Month DD, YYYY", "YYYYMMDD"];

function isValidCol(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (typeof body.name !== "string" || !body.name || typeof body.bank !== "string" || !body.bank) {
    return NextResponse.json({ error: "Template name and bank are required" }, { status: 400 });
  }
  if (body.name.length > MAX_NAME_LENGTH || body.bank.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Template name or bank is too long" }, { status: 400 });
  }
  if (!isValidCol(body.dateCol) || !isValidCol(body.descCol)) {
    return NextResponse.json({ error: "A date column and description column are required" }, { status: 400 });
  }
  if (typeof body.dateFormat !== "string" || !DATE_FORMATS.includes(body.dateFormat)) {
    return NextResponse.json({ error: "A valid date format is required" }, { status: 400 });
  }
  const amountMode = body.amountMode === "split" ? "split" : "single";
  if (amountMode === "single" && !isValidCol(body.amountCol)) {
    return NextResponse.json({ error: "An amount column is required" }, { status: 400 });
  }
  // Split mode only requires at least one of debit/credit mapped — some
  // statements have just one of the two columns — matching the wizard's
  // own canProceedFromStep2 gate rather than requiring both.
  if (amountMode === "split" && !isValidCol(body.debitCol) && !isValidCol(body.creditCol)) {
    return NextResponse.json({ error: "A debit or credit column is required" }, { status: 400 });
  }

  const { result: template } = await updateState((state) => {
    const newTemplate: Template = {
      id: uid("tpl"),
      name: body.name,
      bank: body.bank,
      network: body.network === "Mastercard" ? "Mastercard" : "Visa",
      dateCol: body.dateCol,
      descCol: body.descCol,
      dateFormat: body.dateFormat,
      amountMode,
      amountCol: amountMode === "single" ? body.amountCol : -1,
      amountConvention: body.amountConvention === "negative_is_purchase" ? "negative_is_purchase" : "positive_is_purchase",
      debitCol: amountMode === "split" && isValidCol(body.debitCol) ? body.debitCol : -1,
      creditCol: amountMode === "split" && isValidCol(body.creditCol) ? body.creditCol : -1,
      vendorCol: isValidCol(body.vendorCol) ? body.vendorCol : -1,
      categoryCol: isValidCol(body.categoryCol) ? body.categoryCol : -1,
      typeCol: isValidCol(body.typeCol) ? body.typeCol : -1,
      skipRows: isValidCol(body.skipRows) ? body.skipRows : 0,
      // Only Array.isArray was checked before, so `[{...}]` or `[null]` was
      // persisted into a field typed string[]. Templates.tsx renders these
      // directly, so a non-string element showed up as "[object Object]" and
      // there is no template PATCH to correct it — the only fix was editing
      // store.json by hand. Keep the strings, drop everything else.
      headerSnapshot: Array.isArray(body.headerSnapshot)
        ? (body.headerSnapshot as unknown[]).filter((h): h is string => typeof h === "string")
        : [],
    };
    state.templates.push(newTemplate);
    return newTemplate;
  });

  return NextResponse.json(template, { status: 201 });
}
