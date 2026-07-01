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

## Data & persistence

All app data (cards, categories, import templates, vendor rules,
transactions) is stored in `data/store.json`, created on first run. That
directory is gitignored — it's your personal financial data, not sample
content, and should never be committed. Reads/writes are serialized through
a single queue with atomic temp-file+rename writes so concurrent requests
can't corrupt the file.

## Features / screens

- **Dashboard** — KPIs (total spend, payments, cashback, avg monthly spend),
  a spending trend chart (month/quarter/year), category/vendor breakdown,
  and top merchants, each with a drill-down modal into matching
  transactions.
- **Import CSV** — a 5-step wizard: pick a card, upload & map columns
  (with reusable per-bank templates), confirm the auto-classified preview,
  resolve any transactions that need manual review, done.
- **Transactions** — full searchable/editable ledger with filters and
  pagination.
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

- `package.json` has an `overrides.postcss` pin (`^8.5.10`). This fixes a
  moderate-severity advisory in a copy of `postcss` bundled inside `next`'s
  own dependencies. **Do not run `npm audit fix --force`** — as of this
  writing, npm's own auto-fix for that advisory is to downgrade `next` to
  `9.3.3`, a multi-major-version regression, not an actual fix. If you hit
  new audit findings, check what the suggested fix actually changes before
  applying it.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## License

[MIT](LICENSE)
