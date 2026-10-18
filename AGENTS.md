<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PennyTrail-specific notes

- **Stack**: Next.js 16.4.2 (App Router), React 19, TypeScript, Tailwind v4,
  deployed on Vercel (project `pennytrail`, linked in `.vercel/`, live at
  https://pennytrail-rsrogers.vercel.app). It's a single-user personal tool
  by design — don't introduce multi-user accounts or multi-tenancy without
  being asked.
- **Pushing to `main` deploys to production.** The GitHub repo is connected
  to the Vercel project, so a push to `main` ships to the live site the user
  depends on; other branches get previews. Only push when asked, and have
  `npm test`, lint, and `next build` green first. `vercel.json` pins
  `"framework": "nextjs"` — the project was created with the "Other" preset,
  which served the build as static files (every route 404); don't remove it.
- **Two storage backends, one document.** `src/lib/store.ts` keeps the whole
  `AppState` as one JSON document: in `data/store.json` locally, and in the
  single `pennytrail_store` row of Neon Postgres when
  `PENNYTRAIL_STORAGE=postgres` (set on Vercel Production + Preview only;
  `src/lib/storePostgres.ts`, schema in `db/schema.sql`). The backend is an
  explicit opt-in, never inferred from `DATABASE_URL`: `vercel env pull`
  writes the *production* database URL into `.env.local`, so never run a
  local server or script with `PENNYTRAIL_STORAGE=postgres`, `db:import`, or
  any write against that URL without the user asking — it's their live data.
  Neon is the source of truth since the one-time import; the local
  `data/store.json` is a stale snapshot, so don't treat it as current or
  push it up (`db:import -- --force`) unprompted. Schema changes go in
  `db/schema.sql` (idempotent) and are applied with `npm run db:migrate`
  over `DATABASE_URL_UNPOOLED` — before the code that needs them deploys.
- **Sign-in is env-configured, single account** (`src/lib/auth.ts`):
  `PENNYTRAIL_USERNAME`, `PENNYTRAIL_PASSWORD_HASH` (scrypt, colon-delimited
  because Next's .env loader expands `$`), `PENNYTRAIL_SESSION_SECRET`. Off
  when none are set locally; on Vercel, missing or partial settings make the
  proxy return 503 for everything — keep it failing closed. The user sets the
  password with `npm run auth:setup`; never ask for it, type it, or log it.
- **Ports are non-default**: `npm run dev` serves on `3607`, `npm run
  start` on `2607` (see `scripts` in `package.json`), not the usual 3000.
  Ad-hoc verification (an agent driving the app to prove a change works)
  should use `npm run test:server` (port `4607`) instead of `dev` — that
  way a verification run never collides with a real dev server the user
  already has open on `3607`. Also point `PENNYTRAIL_DATA_DIR` at a
  scratch directory for these runs so they don't read/write the user's
  real `data/store.json`. Stopping a backgrounded `test:server` can leave
  its node process listening on 4607 — free the port before the next run,
  or the next run's requests hit the stale server.
- **Loopback only, and the proxy checks who's asking.** Every server script
  passes `-H 127.0.0.1` — with sign-in off, Next's default `0.0.0.0` bind
  exposed the whole history to the LAN. Don't drop it. `src/proxy.ts`
  (Next 16's renamed middleware) runs on every request: it 403s non-GET
  requests with a foreign `Origin` (always), requires a session cookie on
  every page and API route except `/login` and `/api/auth/*` (when sign-in
  is on), and 403s non-loopback `Host` values (when it's off). Route tests
  call handlers directly, so the proxy only runs in `tests/api/proxy.test.ts`.
- **`package.json` has `overrides.postcss` and `overrides.sharp` pins.**
  Don't remove them and never run `npm audit fix --force` here — npm's own
  suggested fix for the bundled-postcss advisory is to downgrade `next` to
  `9.3.3`, which is a regression, not a fix. Verify what any suggested audit
  fix actually changes before applying it.
- **Test suite**: `npm test` runs Vitest (`tests/lib`, `tests/api`,
  `tests/components`). API-route tests import route handlers directly and
  point `PENNYTRAIL_DATA_DIR` at a fresh per-test temp directory — see
  `tests/helpers/testStore.ts` for why a dynamic `import()` after
  `vi.resetModules()` is required (store.ts's data-dir path is only
  evaluated once per module instance). Run `npm test` after any change to
  `src/lib/` or `src/app/api/`.
  If the suite exits **135 with just `Bus error`** and no test output, that is
  a truncated native binary in `node_modules` (Vite's `lightningcss`), not a
  code or network problem — `npm cache verify`, delete the package directory,
  and `npm install`. See the README's maintenance notes.
- **Store contract — a rejected request must persist nothing** (both
  backends: the Postgres one rolls the transaction back).
  `updateState` skips the write when the mutator returns an object with an
  `error` key, so routes signal failure by *returning* `{ error: "..." }`
  from inside the mutator (never by throwing, and never by mutating and then
  reporting failure some other way). Keep new routes on that convention: it
  is what stops a validation failure from leaving half-applied changes on
  disk.
- **Destructive endpoints require an explicit opt-in.** `DELETE
  /api/transactions` wipes the history only for `{ all: true }`; a missing,
  unparseable, or unrecognized body is a 400. Don't reintroduce a
  "no body means delete everything" default anywhere.
- **Amounts are always stored positive** (`Math.abs` at import), so a total
  that spans transaction types must sign them itself — use
  `categorySpendForTransaction` in `src/lib/vendors.ts` rather than summing
  `netAmountForTransaction` across types, or refunds get added to spend
  instead of subtracted. Note the Dashboard deliberately reports
  `type === "purchase"` only, so it and the Categories screen answer
  different questions.
- **Credit-side lines are never fees, and default to `credit`.** In
  `classifyTransactionType`, the fee/interest rules only fire for charges;
  after the payment and cashback keywords, any other credit-side line is a
  `credit` (a merchant refund often carries nothing but the merchant name),
  so it offsets spend instead of vanishing as a `payment`.
- **Design fidelity**: the UI was ported from a Claude Design handoff
  (dashboard, import wizard, transactions, categories, cards, templates
  screens) — OKLCH color tokens, Public Sans + IBM Plex Mono fonts, exact
  copy and spacing. Keep new UI work consistent with that spec rather than
  introducing a different visual language.
- The `nextjs-agent-rules` block at the top of this file is generated by
  `next dev` itself (`node_modules/next/dist/server/lib/generate-agent-files.js`)
  and re-added if removed, so keep it committed; `agentRules: false` in
  `next.config.ts` turns it off. (Under 16.2.12 the bundled
  `docs/index.md` carried a bogus `unstable_instant` "agent hint"; it's
  gone in 16.4.2, where `instant` is a real, stabilized export — check the
  docs rather than this note if it comes up.)
