// Single-user sign-in. PennyTrail has exactly one account, defined by three
// environment variables rather than a users table:
//
//   PENNYTRAIL_USERNAME        the login name
//   PENNYTRAIL_PASSWORD_HASH   scrypt hash from `npm run auth:setup` (never the password)
//   PENNYTRAIL_SESSION_SECRET  random key that signs session cookies (32+ chars)
//
// A signed-in browser holds an HMAC-signed, HttpOnly session cookie. Nothing
// about sessions is stored server-side, so signing out everywhere means
// changing the secret or the password (both are folded into the signing key).
import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const SESSION_COOKIE = "pennytrail_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthSettings =
  | { mode: "disabled" }
  | { mode: "misconfigured"; reason: string }
  | { mode: "enabled"; username: string; passwordHash: string; sessionSecret: string };

type Env = Record<string, string | undefined>;

// Login is optional only for a local, loopback-bound server (the proxy
// refuses non-loopback hosts when it's off). On Vercel the app is on the
// public internet, so missing settings mean "refuse everything", never "open".
export function authSettings(env: Env = process.env): AuthSettings {
  const username = env.PENNYTRAIL_USERNAME?.trim() ?? "";
  const passwordHash = env.PENNYTRAIL_PASSWORD_HASH?.trim() ?? "";
  const sessionSecret = env.PENNYTRAIL_SESSION_SECRET?.trim() ?? "";

  if (!username && !passwordHash && !sessionSecret) {
    return env.VERCEL
      ? { mode: "misconfigured", reason: "Sign-in isn't set up for this deployment yet (run `npm run auth:setup`)" }
      : { mode: "disabled" };
  }
  const missing = [
    !username && "PENNYTRAIL_USERNAME",
    !passwordHash && "PENNYTRAIL_PASSWORD_HASH",
    !sessionSecret && "PENNYTRAIL_SESSION_SECRET",
  ].filter(Boolean);
  if (missing.length) return { mode: "misconfigured", reason: `Missing ${missing.join(", ")}` };
  if (sessionSecret.length < 32) return { mode: "misconfigured", reason: "PENNYTRAIL_SESSION_SECRET must be at least 32 characters" };
  if (!parsePasswordHash(passwordHash)) {
    return { mode: "misconfigured", reason: "PENNYTRAIL_PASSWORD_HASH isn't a hash from `npm run auth:setup`" };
  }
  return { mode: "enabled", username, passwordHash, sessionSecret };
}

// --- Passwords ---
//
// Format: scrypt:<N>:<r>:<p>:<salt>:<key>, salt and key base64url. Colons
// rather than the conventional `$`, because Next's .env loader expands
// `$NAME` references and would silently mangle a `$`-delimited hash.

const KEY_LENGTH = 32;
export const DEFAULT_SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 };

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parsePasswordHash(encoded: string): ParsedHash | null {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Bounded so a malformed or hostile setting can't make each sign-in
  // attempt allocate gigabytes.
  if (!Number.isInteger(N) || N < 1024 || N > 1048576 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || key.length !== KEY_LENGTH) return null;
  return { N, r, p, salt, key };
}

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function scryptOptions({ N, r, p }: { N: number; r: number; p: number }): ScryptOptions {
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string, params = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, scryptOptions(params));
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const key = await scryptAsync(password, parsed.salt, scryptOptions(parsed));
  return timingSafeEqual(key, parsed.key);
}

// Compares fixed-length digests, so the time taken doesn't leak how much of
// the username matched (or its length).
export function usernameMatches(input: string, expected: string): boolean {
  const digest = (s: string) => createHmac("sha256", "pennytrail-username").update(s.trim().normalize("NFKC")).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

// --- Sessions ---
//
// Token: <payload>.<signature>, both base64url. The payload carries the
// username and an expiry; the signature is HMAC-SHA256 under a key derived
// from the session secret *and* the password hash, so setting a new password
// signs out every existing session.

type Enabled = Extract<AuthSettings, { mode: "enabled" }>;

function signingKey(settings: Enabled): Buffer {
  return createHmac("sha256", settings.sessionSecret).update(`pennytrail-session\0${settings.passwordHash}`).digest();
}

function sign(payload: string, settings: Enabled): Buffer {
  return createHmac("sha256", signingKey(settings)).update(payload).digest();
}

export function createSessionToken(settings: Enabled, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: settings.username, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })
  ).toString("base64url");
  return `${payload}.${sign(payload, settings).toString("base64url")}`;
}

export function verifySessionToken(token: string | undefined, settings: Enabled, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;
  const payload = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = sign(payload, settings);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return claims?.u === settings.username && typeof claims.exp === "number" && claims.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

// HttpOnly keeps the token away from page scripts; SameSite=Lax keeps it off
// cross-site POSTs (alongside the proxy's Origin check). Secure is set
// whenever the request arrived over HTTPS — always the case on Vercel —
// and left off for the plain-http loopback dev server, where a Secure
// cookie wouldn't be sent back.
export function sessionCookie(value: string, secure: boolean, maxAge = SESSION_TTL_SECONDS) {
  return { name: SESSION_COOKIE, value, httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge };
}
