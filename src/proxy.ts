import { NextResponse, type NextRequest } from "next/server";
import { authSettings, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Every request passes through here before any page or route handler runs.
//
// - CSRF: a cross-site fetch with a text/plain body skips the CORS preflight
//   and the route handlers parse it as JSON anyway, so any page could POST or
//   DELETE. Browsers always send Origin on those, so a mutating request whose
//   Origin isn't this app's own is refused.
// - Sign-in (src/lib/auth.ts): when it's configured — always, on Vercel —
//   every page and API route needs a valid session cookie except the login
//   page and the login/logout endpoints.
// - With sign-in off (a local dev server), the server is bound to loopback
//   and the browser is the only thing between another site and the API. A
//   DNS-rebinding page can re-point its own hostname at 127.0.0.1 and then
//   read /api/state as "same-origin", but its requests still carry the
//   attacker's hostname in Host, so only loopback Host values are served.
//   (With sign-in on, rebinding gains nothing: the session cookie belongs to
//   the real host and is never sent to the attacker's.)
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function refuse(request: NextRequest, status: number, error: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error }, { status });
  return new NextResponse(error, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const path = request.nextUrl.pathname;

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== `${request.nextUrl.protocol}//${host}`) {
      return refuse(request, 403, "Cross-origin request refused");
    }
  }

  const auth = authSettings();

  if (auth.mode === "disabled") {
    if (!LOOPBACK_HOST.test(host)) return refuse(request, 403, "Forbidden host");
    if (path === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  // Fail closed: a deployment with partial or invalid sign-in settings serves
  // nothing, rather than serving the data with no login in front of it.
  if (auth.mode === "misconfigured") return refuse(request, 503, auth.reason);

  const signedIn = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, auth);

  if (PUBLIC_PATHS.has(path)) {
    if (signedIn && path === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!signedIn) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const login = new URL("/login", request.url);
    if (path !== "/") login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own static assets, which hold no data.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
