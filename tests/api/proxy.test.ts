import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authSettings, createSessionToken, hashPassword, SESSION_COOKIE } from "@/lib/auth";
import { proxy } from "@/proxy";

const SECRET = "s".repeat(40);

async function enableAuth() {
  const hash = await hashPassword("correct horse battery", { N: 1024, r: 8, p: 1 });
  vi.stubEnv("PENNYTRAIL_USERNAME", "owner");
  vi.stubEnv("PENNYTRAIL_PASSWORD_HASH", hash);
  vi.stubEnv("PENNYTRAIL_SESSION_SECRET", SECRET);
  const settings = authSettings();
  if (settings.mode !== "enabled") throw new Error("auth should be enabled");
  return createSessionToken(settings);
}

function req(url: string, init: { method?: string; host?: string; origin?: string; cookie?: string } = {}) {
  const headers = new Headers({ host: init.host ?? new URL(url).host });
  if (init.origin) headers.set("origin", init.origin);
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(url, { method: init.method ?? "GET", headers });
}

// NextResponse.next() marks the response to continue with this header.
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy with sign-in off (local dev)", () => {
  it("serves loopback hosts", () => {
    expect(passedThrough(proxy(req("http://127.0.0.1:3607/api/state")))).toBe(true);
    expect(passedThrough(proxy(req("http://localhost:3607/")))).toBe(true);
  });

  it("refuses other hosts (DNS rebinding)", async () => {
    const res = proxy(req("http://127.0.0.1:3607/api/state", { host: "evil.example:3607" }));
    expect(res.status).toBe(403);
  });

  it("refuses a cross-origin write but allows a same-origin one", () => {
    const url = "http://127.0.0.1:3607/api/categories";
    expect(proxy(req(url, { method: "POST", origin: "https://evil.example" })).status).toBe(403);
    expect(passedThrough(proxy(req(url, { method: "POST", origin: "http://127.0.0.1:3607" })))).toBe(true);
  });

  it("sends /login back to the app, since there's nothing to sign in to", () => {
    const res = proxy(req("http://127.0.0.1:3607/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});

describe("proxy with sign-in on (Vercel)", () => {
  it("returns 401 for API calls without a session", async () => {
    await enableAuth();
    const res = proxy(req("https://pennytrail.vercel.app/api/state"));
    expect(res.status).toBe(401);
  });

  it("redirects pages to /login, remembering where the user was going", async () => {
    await enableAuth();
    const res = proxy(req("https://pennytrail.vercel.app/some/page?x=1"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/some/page?x=1");
  });

  it("lets a valid session through on any host", async () => {
    const token = await enableAuth();
    expect(passedThrough(proxy(req("https://pennytrail.vercel.app/api/state", { cookie: token })))).toBe(true);
  });

  it("rejects a forged session cookie", async () => {
    await enableAuth();
    const res = proxy(req("https://pennytrail.vercel.app/api/state", { cookie: "forged.token" }));
    expect(res.status).toBe(401);
  });

  it("keeps the login page and login/logout endpoints reachable", async () => {
    await enableAuth();
    expect(passedThrough(proxy(req("https://pennytrail.vercel.app/login")))).toBe(true);
    const login = req("https://pennytrail.vercel.app/api/auth/login", { method: "POST", origin: "https://pennytrail.vercel.app" });
    expect(passedThrough(proxy(login))).toBe(true);
  });

  it("still refuses a cross-origin write, even with a session", async () => {
    const token = await enableAuth();
    const res = proxy(
      req("https://pennytrail.vercel.app/api/transactions", { method: "DELETE", origin: "https://evil.example", cookie: token })
    );
    expect(res.status).toBe(403);
  });

  it("fails closed on Vercel when sign-in isn't configured", () => {
    vi.stubEnv("VERCEL", "1");
    expect(proxy(req("https://pennytrail.vercel.app/api/state")).status).toBe(503);
    expect(proxy(req("https://pennytrail.vercel.app/")).status).toBe(503);
  });
});
