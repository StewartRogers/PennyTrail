import { describe, expect, it } from "vitest";
import {
  authSettings,
  createSessionToken,
  hashPassword,
  SESSION_TTL_SECONDS,
  usernameMatches,
  verifyPassword,
  verifySessionToken,
  type AuthSettings,
} from "@/lib/auth";
import { hashPassword as scriptHashPassword } from "../../scripts/auth-setup.mjs";

// The production cost (N=32768) is deliberately slow; tests use the minimum
// the parser accepts.
const FAST = { N: 1024, r: 8, p: 1 };
const SECRET = "s".repeat(40);

async function enabled(password = "correct horse battery", username = "owner") {
  const settings = authSettings({
    PENNYTRAIL_USERNAME: username,
    PENNYTRAIL_PASSWORD_HASH: await hashPassword(password, FAST),
    PENNYTRAIL_SESSION_SECRET: SECRET,
  });
  if (settings.mode !== "enabled") throw new Error(`expected enabled, got ${JSON.stringify(settings)}`);
  return settings;
}

describe("authSettings", () => {
  it("is disabled locally when nothing is configured", () => {
    expect(authSettings({})).toEqual({ mode: "disabled" });
  });

  // On Vercel the app is public, so "nothing configured" must mean "refuse
  // everything", never "no login".
  it("is misconfigured, not disabled, on Vercel when nothing is configured", () => {
    expect(authSettings({ VERCEL: "1" }).mode).toBe("misconfigured");
  });

  it("names the missing settings when only some are set", () => {
    const settings = authSettings({ PENNYTRAIL_USERNAME: "owner" }) as Extract<AuthSettings, { mode: "misconfigured" }>;
    expect(settings.mode).toBe("misconfigured");
    expect(settings.reason).toContain("PENNYTRAIL_PASSWORD_HASH");
    expect(settings.reason).toContain("PENNYTRAIL_SESSION_SECRET");
  });

  it("rejects a short session secret and a malformed hash", async () => {
    const hash = await hashPassword("whatever-password", FAST);
    expect(authSettings({ PENNYTRAIL_USERNAME: "o", PENNYTRAIL_PASSWORD_HASH: hash, PENNYTRAIL_SESSION_SECRET: "short" }).mode).toBe(
      "misconfigured"
    );
    for (const bad of ["plaintext-password", "scrypt:1000:8:1:abc:def", "$scrypt$32768$8$1$a$b"]) {
      expect(authSettings({ PENNYTRAIL_USERNAME: "o", PENNYTRAIL_PASSWORD_HASH: bad, PENNYTRAIL_SESSION_SECRET: SECRET }).mode).toBe(
        "misconfigured"
      );
    }
  });
});

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery", FAST);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never uses a $ in the hash, which Next's .env loader would expand", async () => {
    expect(await hashPassword("x".repeat(12), FAST)).not.toContain("$");
  });

  // scripts/auth-setup.mjs can't import the TypeScript module, so it carries
  // its own copy of the hashing — this keeps the two in agreement.
  it("accepts hashes produced by `npm run auth:setup`", async () => {
    const hash = await scriptHashPassword("set-up-by-the-script", FAST);
    expect(await verifyPassword("set-up-by-the-script", hash)).toBe(true);
    expect(authSettings({ PENNYTRAIL_USERNAME: "o", PENNYTRAIL_PASSWORD_HASH: hash, PENNYTRAIL_SESSION_SECRET: SECRET }).mode).toBe(
      "enabled"
    );
  });

  it("compares usernames exactly (after trimming)", () => {
    expect(usernameMatches("owner", "owner")).toBe(true);
    expect(usernameMatches(" owner ", "owner")).toBe(true);
    expect(usernameMatches("Owner", "owner")).toBe(false);
    expect(usernameMatches("", "owner")).toBe(false);
  });
});

describe("session tokens", () => {
  it("accepts a fresh token and rejects it once expired", async () => {
    const settings = await enabled();
    const now = Date.now();
    const token = createSessionToken(settings, now);
    expect(verifySessionToken(token, settings, now + 1000)).toBe(true);
    expect(verifySessionToken(token, settings, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
  });

  it("rejects tampered and malformed tokens", async () => {
    const settings = await enabled();
    const token = createSessionToken(settings);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "owner", exp: 9999999999 })).toString("base64url");
    for (const bad of [undefined, "", "abc", `${forged}.${signature}`, `${payload}.${signature}x`, `${payload}.`, `${token}.extra`]) {
      expect(verifySessionToken(bad, settings)).toBe(false);
    }
  });

  // Changing the password (or the username) is the "sign out everywhere".
  it("stops accepting old sessions after the password or username changes", async () => {
    const original = await enabled("first password!!", "owner");
    const token = createSessionToken(original);
    expect(verifySessionToken(token, await enabled("second password!", "owner"))).toBe(false);
    expect(verifySessionToken(token, { ...original, username: "someone-else" })).toBe(false);
  });
});
