// The Postgres store backend (PENNYTRAIL_STORAGE=postgres), used on Vercel,
// where functions have no persistent filesystem. Schema: db/schema.sql.
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import type { AppState } from "./types";
import { emptyState, isAbort, normalizeState } from "./storeState";

const STORE_ROW_ID = 1;
const STORE_SOURCE = "The pennytrail_store row";

let pool: Pool | null = null;

// Neon's URLs say sslmode=require, which current pg already treats as
// verify-full (certificate and hostname checked) but warns about on every
// cold start. Spelling it verify-full keeps that behavior without the noise.
export function withVerifiedTls(connectionString: string): string {
  return connectionString.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

// Created on first use rather than at import, so `next build` (which loads
// route modules) never needs DATABASE_URL. The pooled URL is the right one
// for request traffic; schema changes go over DATABASE_URL_UNPOOLED in
// scripts/db-migrate.mjs.
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PENNYTRAIL_STORAGE=postgres, but DATABASE_URL isn't set");
    pool = new Pool({ connectionString: withVerifiedTls(connectionString) });
    // Keeps a Fluid compute instance alive long enough to close idle
    // connections instead of leaking them when it's suspended.
    attachDatabasePool(pool);
  }
  return pool;
}

// "relation does not exist" otherwise surfaces as an opaque 500 on every
// route of a fresh deployment.
function explainMissingSchema(err: unknown): unknown {
  if ((err as { code?: string })?.code === "42P01") {
    return new Error("The PennyTrail tables don't exist yet — run `npm run db:migrate` against this database");
  }
  return err;
}

export async function readState(): Promise<AppState> {
  try {
    const { rows } = await getPool().query("SELECT doc FROM pennytrail_store WHERE id = $1", [STORE_ROW_ID]);
    return rows.length ? normalizeState(rows[0].doc, STORE_SOURCE) : emptyState();
  } catch (err) {
    throw explainMissingSchema(err);
  }
}

export async function writeState(state: AppState): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO pennytrail_store (id, doc) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [STORE_ROW_ID, JSON.stringify(state)]
    );
  } catch (err) {
    throw explainMissingSchema(err);
  }
}

async function lockStoreRow(client: PoolClient): Promise<unknown | undefined> {
  const { rows } = await client.query("SELECT doc FROM pennytrail_store WHERE id = $1 FOR UPDATE", [STORE_ROW_ID]);
  return rows.length ? rows[0].doc : undefined;
}

// Same contract as the file store's updateState: the mutator runs against the
// current document, and a result with an `error` key writes nothing. The row
// lock serializes concurrent requests across every function instance, so two
// saves can't interleave and lose one of them.
export async function updateState<T>(mutator: (state: AppState) => T): Promise<{ state: AppState; result: T }> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (err) {
    throw explainMissingSchema(err);
  }
  try {
    await client.query("BEGIN");
    let doc = await lockStoreRow(client);
    if (doc === undefined) {
      // First write ever: create the row, then take the lock on it. A
      // concurrent first write that got there first is fine — DO NOTHING
      // and lock theirs.
      await client.query("INSERT INTO pennytrail_store (id, doc) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
        STORE_ROW_ID,
        JSON.stringify(emptyState()),
      ]);
      doc = await lockStoreRow(client);
    }
    const state = normalizeState(doc, STORE_SOURCE);
    const result = mutator(state);
    if (isAbort(result)) {
      await client.query("ROLLBACK");
    } else {
      await client.query("UPDATE pennytrail_store SET doc = $2, updated_at = now() WHERE id = $1", [
        STORE_ROW_ID,
        JSON.stringify(state),
      ]);
      await client.query("COMMIT");
    }
    return { state, result };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw explainMissingSchema(err);
  } finally {
    client.release();
  }
}

// --- Login throttling (see src/lib/loginThrottle.ts) ---

export async function loginFailures(clientKey: string, windowSeconds: number): Promise<{ failures: number; windowStart: Date } | null> {
  const { rows } = await getPool().query(
    `SELECT failures, window_start FROM pennytrail_login_attempts
     WHERE client_key = $1 AND window_start > now() - make_interval(secs => $2)`,
    [clientKey, windowSeconds]
  );
  return rows.length ? { failures: rows[0].failures, windowStart: rows[0].window_start } : null;
}

export async function recordLoginFailure(clientKey: string, windowSeconds: number): Promise<void> {
  // Starts a fresh window once the previous one has expired, otherwise
  // counts within it — in one statement, so parallel attempts can't race.
  await getPool().query(
    `INSERT INTO pennytrail_login_attempts AS a (client_key, failures, window_start) VALUES ($1, 1, now())
     ON CONFLICT (client_key) DO UPDATE SET
       failures = CASE WHEN a.window_start <= now() - make_interval(secs => $2) THEN 1 ELSE a.failures + 1 END,
       window_start = CASE WHEN a.window_start <= now() - make_interval(secs => $2) THEN now() ELSE a.window_start END`,
    [clientKey, windowSeconds]
  );
}

export async function clearLoginFailures(clientKey: string): Promise<void> {
  await getPool().query("DELETE FROM pennytrail_login_attempts WHERE client_key = $1", [clientKey]);
}
