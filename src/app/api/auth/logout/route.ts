import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth";

// Clears this browser's session. Sessions aren't stored server-side, so this
// can't revoke a copied cookie — changing the password does (see auth.ts).
export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie("", secure, 0));
  return response;
}
