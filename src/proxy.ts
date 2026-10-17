import { NextResponse, type NextRequest } from "next/server";

// PennyTrail has no auth by design — it's a single-user tool served on
// loopback (see the -H 127.0.0.1 in package.json's scripts). That makes the
// browser itself the only thing standing between another site and the API:
//
// - DNS rebinding: a hostile page can re-point its own hostname at 127.0.0.1
//   and then read /api/state as "same-origin". Its requests still carry the
//   attacker's hostname in Host, so only loopback Host values are served.
// - CSRF: a cross-site fetch with a text/plain body skips the CORS preflight
//   and the route handlers parse it as JSON anyway, so any page could POST or
//   DELETE. Browsers always send Origin on those, so a mutating request whose
//   Origin isn't this app's own is refused.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOOPBACK_HOST.test(host)) {
    return NextResponse.json({ error: "Forbidden host" }, { status: 403 });
  }
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== `${request.nextUrl.protocol}//${host}`) {
      return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
