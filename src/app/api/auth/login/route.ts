import { NextResponse } from "next/server";
import { ipAddress } from "@vercel/functions";
import { authSettings, createSessionToken, sessionCookie, usernameMatches, verifyPassword } from "@/lib/auth";
import { clearLoginFailures, loginRetryAfter, recordLoginFailure } from "@/lib/loginThrottle";
import { readJsonObject } from "@/lib/request";

const INVALID = "Incorrect username or password";

export async function POST(request: Request) {
  const auth = authSettings();
  if (auth.mode === "disabled") return NextResponse.json({ error: "Sign-in isn't enabled on this server" }, { status: 404 });
  if (auth.mode === "misconfigured") return NextResponse.json({ error: auth.reason }, { status: 503 });

  // On Vercel this is the platform-set client address (x-real-ip), which a
  // caller can't override. Anywhere else that header is whatever the caller
  // sent, so every attempt shares one "local" bucket instead.
  const clientKey = (process.env.VERCEL && ipAddress(request)) || "local";

  const retryAfter = await loginRetryAfter(clientKey);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: `Too many failed attempts — try again in ${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? "s" : ""}` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const body = await readJsonObject(request);
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Always run the (deliberately slow) password check, even for a wrong
  // username, so response time doesn't reveal which half was wrong.
  const passwordOk = password.length > 0 && password.length <= 1024 && (await verifyPassword(password, auth.passwordHash));
  if (!usernameMatches(username, auth.username) || !passwordOk) {
    await recordLoginFailure(clientKey);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await clearLoginFailures(clientKey);
  const secure = new URL(request.url).protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(createSessionToken(auth), secure));
  return response;
}
