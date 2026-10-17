-- PennyTrail's Postgres schema, used when PENNYTRAIL_STORAGE=postgres (the
-- Vercel deployment). Every statement is idempotent: `npm run db:migrate`
-- applies this file as-is over the direct (unpooled) connection, and
-- `npm run db:import` runs it first too.

-- The whole AppState lives in one JSON document, exactly as data/store.json
-- does locally, so every route keeps its read-modify-write mutator. Writes
-- lock this single row (SELECT ... FOR UPDATE), which serializes concurrent
-- requests across function instances the way the file store's in-process
-- queue does for one process.
CREATE TABLE IF NOT EXISTS pennytrail_store (
  id integer PRIMARY KEY CHECK (id = 1),
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Failed sign-in attempts per client IP, for throttling the login route.
-- Kept out of the store document so a burst of failures can't contend with
-- (or bloat) real data writes.
CREATE TABLE IF NOT EXISTS pennytrail_login_attempts (
  client_key text PRIMARY KEY,
  failures integer NOT NULL,
  window_start timestamptz NOT NULL
);
