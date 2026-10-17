import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, SESSION_COOKIE } from "@/lib/auth";
import { jsonRequest } from "../helpers/testStore";

const PASSWORD = "correct horse battery";

beforeEach(async () => {
  // Fresh modules per test: the throttle keeps failures in module memory
  // when the store is the local file.
  vi.resetModules();
  vi.stubEnv("PENNYTRAIL_USERNAME", "owner");
  vi.stubEnv("PENNYTRAIL_PASSWORD_HASH", await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }));
  vi.stubEnv("PENNYTRAIL_SESSION_SECRET", "s".repeat(40));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function login(body: unknown, url = "https://pennytrail.vercel.app/api/auth/login") {
  const { POST } = await import("@/app/api/auth/login/route");
  return POST(jsonRequest(url, "POST", body));
}

describe("POST /api/auth/login", () => {
  it("sets an HttpOnly, SameSite=Lax, Secure session cookie on success", async () => {
    const res = await login({ username: "owner", password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("leaves Secure off over plain http (the loopback dev server)", async () => {
    const res = await login({ username: "owner", password: PASSWORD }, "http://127.0.0.1:3607/api/auth/login");
    expect(res.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });

  it("gives the same answer for a wrong username or a wrong password", async () => {
    const wrongUser = await login({ username: "admin", password: PASSWORD });
    const wrongPassword = await login({ username: "owner", password: "nope" });
    expect(wrongUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await wrongUser.json()).toEqual(await wrongPassword.json());
    expect(wrongUser.headers.get("set-cookie")).toBeNull();
  });

  it("rejects missing or non-string credentials", async () => {
    expect((await login({})).status).toBe(401);
    expect((await login({ username: ["owner"], password: { p: PASSWORD } })).status).toBe(401);
  });

  it("throttles after repeated failures — even the right password — until the window passes", async () => {
    for (let i = 0; i < 5; i++) expect((await login({ username: "owner", password: "wrong" })).status).toBe(401);
    const blocked = await login({ username: "owner", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("clears the failure count after a successful sign-in", async () => {
    for (let i = 0; i < 4; i++) await login({ username: "owner", password: "wrong" });
    expect((await login({ username: "owner", password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login({ username: "owner", password: "wrong" })).status).toBe(401);
  });

  it("is a 404 when sign-in isn't configured", async () => {
    vi.unstubAllEnvs();
    expect((await login({ username: "owner", password: PASSWORD })).status).toBe(404);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const res = await POST(new Request("https://pennytrail.vercel.app/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, "i"));
  });
});
