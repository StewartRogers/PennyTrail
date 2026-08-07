# PennyTrail

A personal, single-user credit card transaction analyzer. Import statement
CSVs from multiple banks, auto-classify each line item (purchase / payment /
credit / cashback / fee), categorize spend by vendor, and get BI-style
reporting — trends by month/quarter/year, category and vendor breakdowns, and
top merchants, with drill-down into the underlying transactions.

There is no multi-user auth — this is a personal tool for one person.

Built from a [Claude Design](https://claude.ai/design) handoff prototype; the
UI and CSV-classification logic are ported to match that spec closely.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS v4 for base styles; screens use design tokens (OKLCH colors,
  Public Sans + IBM Plex Mono) matching the original design spec
- A local JSON file (`data/store.json`) as the data store — no database
  server required. See [`src/lib/store.ts`](src/lib/store.ts).

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on **http://localhost:3607** (not the Next.js default
3000 — see `scripts` in `package.json`). Production mode (`npm run build &&
npm run start`) runs on **http://localhost:2607**.

## Testing

```bash
npm test          # run the suite once
npm run test:watch  # re-run on file changes
```

[Vitest](https://vitest.dev) covers three layers, under `tests/`:

- `tests/lib/` — unit tests for the framework-agnostic business logic
  (CSV parsing, vendor classification/matching, formatting).
- `tests/api/` — integration tests for the Route Handlers, calling the
  exported handler functions directly against a scratch directory (via
  `PENNYTRAIL_DATA_DIR`, a fresh temp dir per test) — no real `data/store.json`
  is ever touched.
- `tests/components/` — React Testing Library tests for a few
  regression-prone screens.

`test:server` (the `next dev -p 4607` alias) is unrelated — that's for
manually driving the app in a browser against a scratch data dir, not for
running the automated suite.

## Data & persistence

All app data (cards, categories, import templates, vendor rules,
transactions) is stored in `data/store.json`, created on first run. That
directory is gitignored — it's your personal financial data, not sample
content, and should never be committed. Reads/writes are serialized through
a single queue with atomic temp-file+rename writes (the temp file is fsynced
before the rename, so a crash mid-write can't leave a truncated store) so
concurrent requests can't corrupt the file. A CSV row with a missing or
non-numeric amount, a non-ISO date, or a non-boolean charge flag is skipped
during import (rather than stored as corrupted data) and counted in the
post-import summary; the import wizard also reports rows it couldn't read
before you commit the import.

Two invariants worth knowing if you touch the store or the routes:

- **A rejected request writes nothing.** `updateState` skips the write
  entirely when the mutator returns an `{ error }` object, so a mutator that
  bails out partway can't leave half-applied changes on disk. Routes signal
  failure by returning `{ error: ... }` rather than throwing.
- **Deleting every transaction requires `{ all: true }`.** `DELETE
  /api/transactions` rejects a missing, unparseable, or unrecognized body
  with a 400 instead of treating it as "delete everything".

## Features / screens

- **Dashboard** — KPIs (total spend, payments, cashback, avg monthly spend),
  a spending trend chart (month/quarter/year), category/vendor breakdown,
  and top merchants, each with a drill-down modal into matching
  transactions.
- **Import CSV** — a 5-step wizard: pick a card, upload & map columns
  (with reusable per-bank templates), confirm the auto-classified preview,
  resolve any transactions that need manual review, done.
- **Transactions** — full searchable/editable ledger with filters and
  pagination. Each transaction can also record a partial or full
  reimbursement (e.g. an employer/insurance payback that never appears as
  its own card transaction) — every spend total elsewhere in the app nets
  it out automatically.
- **Categories** — manage the spend category taxonomy (the four system
  categories — Payment, Credit/Refund, Cashback, Fees & Interest — are
  derived automatically and read-only).
- **Cards** — manage your credit cards.
- **Import Templates** — view/manage saved CSV column-mapping templates,
  reused automatically for future statements from the same bank.

## Project structure

- `src/lib/` — framework-agnostic business logic: CSV parsing
  (`csv.ts`), transaction classification (`classify.ts`), formatting
  (`format.ts`), the JSON data store (`store.ts`), and the client-side API
  wrapper (`api.ts`).
- `src/app/api/` — server-side Route Handlers (cards, categories,
  templates, transactions) backed by the JSON store.
- `src/components/` — the client-rendered UI, one component per screen,
  orchestrated by `App.tsx`.

## Maintenance notes

- `package.json` has `overrides.postcss` (`^8.5.10`) and `overrides.sharp`
  (`^0.35.3`) pins. The `postcss` one fixes a moderate-severity advisory in a
  copy bundled inside `next`'s own dependencies. The `sharp` one fixes a
  libvips CVE in `next`'s optional image-optimization dependency, which
  `next` itself pins to a range (`^0.34.5`) that excludes the patched
  version. **Do not run `npm audit fix --force`** — as of this writing,
  npm's own auto-fix for the `postcss` advisory is to downgrade `next` to
  `9.3.3`, a multi-major-version regression, not an actual fix. If you hit
  new audit findings, check what the suggested fix actually changes before
  applying it.
- `npm install` prints an `EBADENGINE` warning for
  `@testing-library/jest-dom@7`, which asks for Node >= 22. The suite passes
  on Node 20 regardless, so this is a warning rather than a break — resolve it
  by moving to Node 22+ or pinning `jest-dom` to its v6 line if you want it
  silenced.
- **If `npm test` dies with `Bus error` (exit 135)**, a native `.node` binary
  in `node_modules` has been extracted truncated — usually a corrupt npm cache
  entry, and it takes Vitest down via Vite's `lightningcss` dependency. It is
  not a code failure and not a network failure. Fix it with:

  ```bash
  npm cache verify        # garbage-collects the corrupt entries
  rm -rf node_modules/lightningcss-linux-*    # or whichever package crashes
  npm install
  ```

  To confirm which binary is at fault, `node -e "require('lightningcss')"` —
  a truncated one SIGBUSes on load, and its file size will be far smaller
  than the same version freshly installed elsewhere.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## License

[MIT](LICENSE)
