// Throttles failed sign-ins per client IP. With one account there's nothing
// to enumerate, so the only thing to slow down is password guessing. The
// limit is per IP rather than global on purpose: a global lockout would let
// anyone on the internet lock the owner out of their own app.
const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

const postgresBackend = () => process.env.PENNYTRAIL_STORAGE?.trim().toLowerCase() === "postgres";

// Local (file-store) runs are a single process, so memory is enough there.
// On Vercel, failures live in Postgres so every function instance sees them.
const memory = new Map<string, { failures: number; windowStart: number }>();

function memoryEntry(clientKey: string, now: number) {
  const entry = memory.get(clientKey);
  if (entry && now - entry.windowStart >= WINDOW_SECONDS * 1000) {
    memory.delete(clientKey);
    return undefined;
  }
  return entry;
}

// Seconds until this client may try again, or 0 if it isn't blocked.
export async function loginRetryAfter(clientKey: string, now = Date.now()): Promise<number> {
  let entry: { failures: number; windowStart: number } | undefined;
  if (postgresBackend()) {
    const row = await (await import("./storePostgres")).loginFailures(clientKey, WINDOW_SECONDS);
    entry = row ? { failures: row.failures, windowStart: row.windowStart.getTime() } : undefined;
  } else {
    entry = memoryEntry(clientKey, now);
  }
  if (!entry || entry.failures < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((entry.windowStart + WINDOW_SECONDS * 1000 - now) / 1000));
}

export async function recordLoginFailure(clientKey: string, now = Date.now()): Promise<void> {
  if (postgresBackend()) {
    await (await import("./storePostgres")).recordLoginFailure(clientKey, WINDOW_SECONDS);
    return;
  }
  const entry = memoryEntry(clientKey, now);
  if (entry) entry.failures++;
  else memory.set(clientKey, { failures: 1, windowStart: now });
}

export async function clearLoginFailures(clientKey: string): Promise<void> {
  if (postgresBackend()) {
    await (await import("./storePostgres")).clearLoginFailures(clientKey);
    return;
  }
  memory.delete(clientKey);
}
