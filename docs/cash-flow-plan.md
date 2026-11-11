# PennyTrail: Cash Flow expansion plan

Branch: `cash-flow` (created from `main` at `8180052`).

## Status (2026-10-19)

Phases 1–5 are built on the `cash-flow` branch, committed locally and not
pushed. Phase 6 (syncing with the card side) is still to do. `npm test`
(759 tests), lint, and `next build` all pass.

Still needed before this branch is pushed:

- **Phase 0's separate Preview database.** Previews still share the
  production database, so pushing `cash-flow` would run this code against
  live data. That's a Vercel/Neon change, and it hasn't been made.

Changes from the plan as written:

- **The bank import is its own screen** (Import Bank CSV), not a mode of the
  card Import wizard, so the card side is untouched. Its column mapping is
  saved on the bank account (`BankAccount.importMapping`), not as a
  `Template`. Import Templates stays on the Credit Cards side, and only
  Categories and Vendor Mappings moved to Shared.
- **The .xlsx reader is built in** (`src/lib/xlsx.ts`) instead of `exceljs`.
  It uses the browser's own DecompressionStream and needs no new
  dependency.
- **The import preview has a "Same item as…" mapping** (`keyMap`) for
  renamed cards that the name normaliser can't join on its own, such as
  "RBC Mastercard (SR)" → "RBC WESTJET (Mastercard)".
- **Recurring items are created for names seen in at least three months.**
  Names seen in fewer months import as one-off rows unless they're mapped
  to an item.
- **Upcoming flags an item as overdue once its date passes without
  posting.** Scheduled items count too, because done means posted.

The dry run against the real workbook through the connector (all 35
sheets) confirmed that every sheet has the same row 1 headings and the same
Weekly Spend / END OF WEEK / END OF MONTH labels.

## 1. Goal

PennyTrail today reviews credit card spending in detail: CSV import, vendor
and category classification, dashboards, and averages. This change adds a
second side to the app, **Cash Flow**, which replaces the monthly
bill-tracking spreadsheet and later takes in the bank (debit) account's
transactions.

The Credit Card side stays as it is. The two sides are separate at first,
with a defined path to syncing them later (section 9).

Cash Flow has two jobs:

1. **Bills and deposits.** Show what is due this month, when it is due, and
   whether it has been scheduled or paid. Record the payment confirmation
   code.
2. **Day-to-day spending and balance tracking.** Estimate spending per
   period, record the real balance at each checkpoint, and show how the
   month is tracking. Bank transactions can later be uploaded to replace
   the estimates with actuals.

## 2. How the spreadsheet works today (the model to replicate)

Each month is a sheet split into **three periods**. Each period ends at a
balance checkpoint:

| Period | Ends | Typical contents |
|---|---|---|
| 1 | First Friday | Weekly Spend, 152 Rent (first + second), CIBC Visa, Triangle MC, Stewart Pay, RBC Avion Visa |
| 2 | Second Friday | Weekly Spend, Child Tax Benefit, Rogers MC, Simplii Visa, 152 Home Insurance, BMO Porter MC, Kerri Pay |
| 3 | End of month | Weekly Spend, Child Tax Benefit, PCF MC (KA), Stewart Pay, BC Hydro, Fortis, RBC WestJet MC, 152 Rent (first), Kerri Pay, Wealthsimple Visa |

The workflow:

- Each period opens with a **Weekly Spend** estimate rather than individual
  purchases.
- Bills and deposits are listed in due-date order. When a bill's due date
  comes up, the user schedules the payment and records the confirmation code.
- At **END OF WEEK / END OF MONTH**, the user enters the real account
  balance. The difference between projected and actual shows the true
  spend, and the next period starts from the real number.
- Every month is kept, so history stays visible.

Item types this implies:

- **Deposits:** pay (Stewart, Kerri), Child Tax Benefit.
- **Fixed bills:** rent, home insurance.
- **Variable bills:** credit card payments (the amount depends on the
  statement) and utilities (BC Hydro and Fortis, possibly every two months).
- **Spend estimates:** one per period.
- **Checkpoints:** one per period, holding the actual balance.

### 2.1 How each item recurs

| Item | Schedule | Notes |
|---|---|---|
| 152 Rent (first) | Monthly, last day of the month | Paid in two parts. The bank posts on business days, so when the last day falls on a weekend or holiday this part posts on the 1st. That is why period 1 often shows both parts. |
| 152 Rent (second) | Monthly, 1st | Moves to the next business day if needed |
| Stewart Pay (SR) | Every 2 weeks from an anchor payday (Thursdays) | Some months have three paydays |
| Kerri Pay (KA) | Twice a month, on the 15th and the last day of the month | |
| Child Tax Benefit | Once a month, exact day unknown | Stored with an estimated day and a "date uncertain" flag. The second line in the spreadsheet is usually zero and is dropped. |
| BC Hydro | Every 2 months | Variable amount |
| Fortis | Monthly | Variable amount |
| Credit card payments | Monthly, on each card's due day | Variable amount (the statement balance) |
| 152 Home Insurance | Monthly | Fixed amount |

**SR** and **KA** are the two people in the household, so items carry an
optional owner (for example PCF Mastercard belongs to KA). Owner is a
filter and label, not a separate account.

### 2.2 Business days decide which month a payment lands in

The bank only posts on business days. What moves the balance is the
**posting date**, not the nominal due date, so every entry keeps both:

- `dueDate`: the nominal date (rent part 1: October 31).
- `postingDate`: the business-day-adjusted date (October 31, 2026 is a
  Saturday, so November 2).

The entry belongs to the month and period of its **posting date**. October
31's rent therefore appears in November's period 1, next to November 1's
rent part 2, which is exactly what the spreadsheet shows.

Each item has a roll rule:

- `next`: move forward to the next business day. This is the default for
  bills.
- `previous`: move back to the previous business day. This is the default
  for pay, because employers usually pay early when payday is a holiday.
- `none`: no adjustment.

Business days exclude weekends and the bank holiday calendar. The calendar
is prefilled with Payments Canada's non-business days (New Year's Day,
Family Day, Good Friday, Victoria Day, Canada Day, BC Day, Labour Day,
National Day for Truth and Reconciliation, Thanksgiving, Remembrance Day,
Christmas, Boxing Day) and is editable in Accounts, so a wrong date is a
one-line fix rather than a code change.

## 3. Product shape

### 3.1 Splitting the UI

Add a two-way switch at the top of the sidebar: **Credit Cards | Cash Flow**.
Each side has its own navigation:

**Credit Cards** (unchanged): Dashboard, Averages, Import CSV, Transactions,
Categories, Vendor Mappings, Cards, Import Templates.

**Cash Flow** (new):

| Screen | Purpose |
|---|---|
| **This Month** (default) | The spreadsheet view: periods, items, statuses, running balance, checkpoints |
| **Upcoming** | Overdue, due in the next 7–14 days, and unpaid items this month, across months |
| **Spending** *(phase 4)* | Debit purchases per period against the estimate, by category |
| **Bank Transactions** *(phase 4)* | Imported bank lines with review and matching |
| **Import CSV** *(phase 4)* | The existing import wizard, aimed at a bank account |
| **Recurring Items** | Set up bills and deposits: name, amount, schedule, owner tag |
| **History** | Month list with opening, closing, and variance; opens any past month |
| **Accounts** | Bank account setup: name, institution, last 4 digits, starting balance |

Categories, Vendor Mappings, and Import Templates stay on the Credit Cards
side until bank transactions use them (phase 4). At that point they move
into a small **Shared** group at the bottom of the sidebar.

The active side is remembered per browser in `localStorage`, wrapped in
try/catch so the app still works if storage is unavailable. It is a
convenience only, not data.

### 3.2 The "This Month" screen

- **Header:** month picker, opening balance (carried from last month's final
  checkpoint, or entered by hand), projected month-end balance, **lowest
  projected balance and its date** (the early-warning number), and the count
  and total of unpaid bills.
- **One block per period**, mirroring the spreadsheet:
  - First row: **Weekly Spend**, calculated as the daily rate times the
    days in the period (for example $50 × 7 days = $350). The days run
    from the day after the previous checkpoint to this checkpoint,
    inclusive. The amount can be overridden for a single period.
  - Item rows in due-date order. Columns: Item, Due, Expected, Actual,
    Status, Scheduled on, Confirmation #, Running balance.
  - Footer: **END OF WEEK (date)**, with projected balance, an actual
    balance input, and the variance (actual minus projected, plus the
    implied actual spend).
- **Statuses:**
  - `projected`: the amount is still a projection
  - `actual`: the deposit or withdrawal happened and its amount is confirmed
  - `skipped`: not due this month

  The statuses are only indicators for confirming each real amount. A past
  month is all Actual; the current month is a mix. (As built these replaced
  the original `planned` / `scheduled` / `posted`: `scheduled` was folded
  into `projected`, and a payment that is set up is recognised by its
  confirmation number or scheduling date. Older stores are mapped on read.
  Where the rest of this plan says planned, scheduled, or posted, read
  Projected, Projected-with-a-payment-set-up, and Actual.)

  A Projected item past its expected posting date is overdue and uses the
  attention colour. Actual rows are muted.
- **Quick actions on a row:** Schedule, which takes a date, an optional
  confirmation code, and the actual amount if it differs; Mark posted,
  which takes the posted date and the actual amount; Skip; Edit; Move to
  another period. An **Add one-off item** button sits on each period.
- **Estimate first, then correct.** Pay, card payments, and utilities start
  at the item's default amount. Entering the actual amount when an item
  posts replaces the estimate in every calculation.
- **Checkpoint dates** default to the first Friday, second Friday, and last
  day of the month, and can be edited per month. This covers a month where
  the first Friday is the 1st, or a long weekend.

### 3.3 Balance math

For each period *p*:

```
opening(p)   = actual(p-1) if recorded, else projected(p-1)
               (period 1 uses the month's opening balance)
projected(p) = opening(p) + Σ deposits(p) − Σ bills(p) − spendEstimate(p)
variance(p)  = actual(p) − projected(p)
impliedSpend(p) = spendEstimate(p) − variance(p)

days(p)          = checkpoint(p) − checkpoint(p-1)   (period 1 counts from the 1st)
spendEstimate(p) = spendOverride(p) ?? dailySpendRate × days(p)
impliedDailySpend(p) = impliedSpend(p) / days(p)    (compared against the $50 rate)
```

- Each item uses `actualAmount` when set and `expectedAmount` otherwise.
- `planned`, `scheduled`, and `posted` items all count toward the
  projection. `skipped` items do not.
- An item counts in the period of its actual posted date once posted, and
  of its expected posting date before that.
- The daily rate is stored on each month when the month is started. If the
  rate later changes, past months keep the rate they were planned with.
- The running balance column applies items in posting-date order inside
  the period, so the low point inside a period is visible too.
- An item with an uncertain date (Child Tax Benefit) is placed on its
  estimated day and shown as "~Oct 20". When the lowest projected balance
  is calculated, an uncertain deposit is counted at the **end** of its
  period, so the warning errs on the cautious side.
- All of this lives in one pure module, `src/lib/cashflow.ts`, so the UI and
  tests share it.

### 3.4 Months, history, and recurring items

- A month is **materialized**. When the user starts a month (for example
  "Start November"), PennyTrail generates that month's entries from the
  active recurring items, copies default spend estimates into the periods,
  and carries the opening balance from the previous month's last recorded
  checkpoint.
- Generation works from posting dates. PennyTrail expands each item's
  occurrences from the start of the previous month to the end of the target
  month, applies the roll rule, and keeps the occurrences whose posting date
  falls in the target month. Each occurrence has a deterministic
  `occurrenceKey` (item id plus nominal due date), and generation skips keys
  that already exist. A rent payment that rolled from October 31 into
  November can then never appear in both months.
- Moving an entry's posting date by hand, for example when a payment
  actually cleared a day late, can move it to a different period or month.
  The nominal due date stays as it was.
- Editing a recurring item changes future months only. The edit dialog
  offers "also update this month's unpaid entries". Past months are never
  rewritten, which is what keeps the history reliable.
- A past month can still be edited, for a late correction, but it is marked
  `closed` once its final checkpoint is recorded. A closed month shows a
  "closed" badge instead of locking edits.
- **History** lists each month with its opening balance, closing balance,
  total deposits, total bills, estimated spend, implied actual spend, and
  variance. A small trend chart (estimated vs implied spend per month) is a
  later addition.

## 4. Data model

Everything stays in the single `AppState` document, so both storage
backends keep working unchanged. `normalizeState` already fills missing
collections with their empty defaults, so adding collections to
`emptyState()` needs no data migration. Existing production code also keeps
keys it doesn't recognise, so a rollback to `main` won't drop Cash Flow data.

```ts
// src/lib/types.ts — additions

export interface BankAccount {
  id: string;
  name: string;            // "Chequing"
  institution: string;     // "RBC"
  last4: string;
  color: string;
  currency?: string;       // absent = CAD, same rule as Card
  dailySpendRate: number;  // default for new months, e.g. 50
  bankHolidays: string[];  // ISO dates; see businessDays.ts
}

export type CashFlowKind = "bill" | "deposit";

// A day of "last" means the last day of the month (rent part 1, KA's
// month-end pay), so short months need no special-casing.
export type DayOfMonth = number | "last";

export type Recurrence =
  | { type: "monthly"; day: DayOfMonth }                       // Fortis, cards, rent
  | { type: "everyNMonths"; n: number; day: DayOfMonth; anchorMonth: string } // BC Hydro
  | { type: "semiMonthly"; days: [DayOfMonth, DayOfMonth] }    // KA: [15, "last"]
  | { type: "everyNWeeks"; n: number; anchorDate: string }     // SR: n = 2
  | { type: "once"; date: string };

export type RollRule = "next" | "previous" | "none";

export interface CashFlowItem {          // the recurring template
  id: string;
  accountId: string;
  name: string;            // "CIBC (Visa)"
  kind: CashFlowKind;
  amountMode: "fixed" | "variable";
  defaultAmount: number;   // always positive; kind gives the sign
  recurrence: Recurrence;
  roll: RollRule;          // default: "next" for bills, "previous" for deposits
  // Who completes it. "manual": you schedule it and record the bank's
  // confirmation number. "auto": the sheet's AD, a pre-authorised debit or
  // direct deposit. "external": the sheet's X, completed by someone else
  // or arriving on its own (Child Tax Benefit, KA paying PCF), with no
  // confirmation number but still tracked. Only "manual" items ever ask
  // to be scheduled. Absent means "manual".
  settlement?: "manual" | "auto" | "external";
  dateUncertain?: boolean; // Child Tax Benefit: the day is an estimate
  owner?: string;          // household member: "SR" | "KA"
  matchText?: string;      // phase 5: substring to match bank lines
  cardId?: string;         // phase 6: link a card-payment bill to its Card
  active: boolean;
  notes?: string;
}

export interface CashFlowPeriod {
  id: string;
  endDate: string;         // ISO date of the checkpoint
  label: string;           // "End of week" / "End of month"
  spendOverride?: number;  // absent = month's dailySpendRate × days in period
  actualBalance?: number;  // the checkpoint; absent until recorded
}

export interface CashFlowMonth {
  id: string;
  accountId: string;
  month: string;           // "2026-11"
  openingBalance: number;
  openingSource: "carried" | "manual";
  dailySpendRate: number;  // copied from the account when the month starts
  periods: CashFlowPeriod[];
  closed: boolean;
  importedFrom?: string;   // worksheet name, for months brought in from the spreadsheet
}

export type EntryStatus = "projected" | "actual" | "skipped";

export interface CashFlowEntry {        // one occurrence in one month
  id: string;
  monthId: string;
  itemId: string | null;   // null = one-off
  occurrenceKey?: string;  // `${itemId}:${dueDate}`; prevents a rolled payment appearing twice
  name: string;            // copied from the item at generation time
  kind: CashFlowKind;
  dueDate: string;         // nominal date
  postingDate: string;     // expected, business-day-adjusted
  postedDate?: string;     // actual; once set, decides month and period
  dateUncertain?: boolean;
  expectedAmount: number;
  actualAmount?: number;
  status: EntryStatus;
  scheduledDate?: string;
  confirmationCode?: string;
  bankTransactionId?: string;  // phase 5
  notes?: string;
}

// phase 4
export type BankTxnType =
  | "deposit" | "purchase" | "bill_payment" | "transfer"
  | "etransfer" | "atm" | "fee" | "interest";

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string;
  rawDescription: string;
  amount: number;          // always positive, like Transaction
  direction: "in" | "out";
  type: BankTxnType;
  childVendorId: string | null;   // shared vendor/category system
  needsReview: boolean;
}

export interface AppState {
  // ...existing collections unchanged...
  bankAccounts: BankAccount[];
  cashFlowItems: CashFlowItem[];
  cashFlowMonths: CashFlowMonth[];
  cashFlowEntries: CashFlowEntry[];
  bankTransactions: BankTransaction[];   // phase 4
}
```

Design decisions:

- **Bank transactions get their own collection** instead of joining
  `transactions`. Every card screen (Dashboard, Averages, Categories,
  Transactions) aggregates `transactions` and uses card-specific `TxnType`
  semantics. Mixing debit lines in would change the card side's numbers,
  and the brief is to leave it as is. Bank lines still use the same
  `ParentVendor`/`ChildVendor`/`Category` layer, so "Groceries" means the
  same thing on both sides.
- **Entries are flat and periods are nested**, matching the existing
  flat-array style. An entry's period is derived from its posting date and
  the month's checkpoint dates, so moving a checkpoint regroups entries
  automatically. "Move to another period" changes the posting date.
- **The bank holiday calendar** is the `bankHolidays` list on
  `BankAccount`, prefilled when the account is created and extended a year
  at a time. Business-day logic lives in `src/lib/businessDays.ts`.
- **Amounts are always positive, and the kind or direction carries the
  sign.** This matches the existing invariant (see `AGENTS.md`).
- **Multi-account ready but not multi-account heavy.** Months and items
  carry an `accountId`, so a second account is possible later. The UI
  assumes one account until there is a reason to show more.
- **Size check:** every mutation re-serializes the whole document. A year
  of bank lines (roughly 1–2k rows) is well within what that handles. If it
  ever matters, `bankTransactions` is the collection to move into its own
  Postgres table first.

## 5. API routes

These follow the existing conventions. Every mutator signals failure by
**returning `{ error }`** so nothing persists on rejection. Request bodies
are validated with `src/lib/request.ts`. Each route gets a test in
`tests/api/` using `tests/helpers/testStore.ts`.

| Route | Methods | Notes |
|---|---|---|
| `/api/bank-accounts`, `/[id]` | GET POST / PATCH DELETE | Delete refuses while months or transactions reference the account |
| `/api/cashflow/items`, `/[id]` | POST / PATCH DELETE | Delete deactivates instead, if past entries reference the item |
| `/api/cashflow/months` | POST | `{ accountId, month }` generates entries and periods. 409 if the month exists |
| `/api/cashflow/months/[id]` | PATCH DELETE | Opening balance, checkpoint dates, estimates, actual balances. DELETE requires `{ confirm: true }` (destructive opt-in rule) |
| `/api/cashflow/entries`, `/[id]` | POST / PATCH DELETE | One-off add; status, schedule, confirmation code, amounts |
| `/api/bank-transactions/import` | POST | Phase 4: mirrors `/api/transactions/import` (dedupe, row cap, classification) |
| `/api/bank-transactions`, `/[id]` | GET / PATCH DELETE | Phase 4: DELETE all requires `{ all: true }`, as on the card side |

`GET /api/state` keeps returning the whole document, so the client loads
everything in one request as it does today.

## 6. Phases

Each phase ends with `npm test`, lint, and `next build` passing, and is
committed on `cash-flow`.

### Phase 0: Groundwork (before any push)

- [ ] **Give Preview deployments their own database.** The README says
      previews share the production Neon database. Pushing `cash-flow`
      would create a preview that runs unfinished code against live data.
      Create a Neon branch (or a separate database) for the Vercel
      **Preview** environment's `DATABASE_URL`/`DATABASE_URL_UNPOOLED`,
      seeded from a copy of production. Until then, keep the branch local.
- [ ] Add the sidebar's Credit Cards / Cash Flow switch and the empty Cash
      Flow screens. Make `Screen` workspace-aware. The card side is
      unchanged. Add a component test confirming every existing screen
      still renders.

### Phase 1: Core Cash Flow (replaces the spreadsheet)

- [ ] Add types and `emptyState()` entries.
- [ ] `src/lib/businessDays.ts`: weekend and holiday checks, next and
      previous business day, and the Payments Canada holiday generator
      (fixed dates, nth-Monday rules, and Easter for Good Friday).
- [ ] `src/lib/cashflow.ts`: recurrence expansion, roll rules, posting-date
      month assignment with `occurrenceKey` de-duplication, default
      checkpoint dates (first and second Friday, month end), period
      assignment, and balance math. Fully unit-tested, covering:
      - October 31, 2026 rent rolling into November's period 1, and not
        appearing in October
      - SR's biweekly pay giving a three-payday month
      - KA's `"last"` payday in February and in a leap year
      - a payday that falls on a holiday rolling back
      - BC Hydro every second month
      - a month that starts on a Friday
- [ ] Routes for bank accounts, items, months, and entries, with tests.
- [ ] Screens: Accounts, Recurring Items, and This Month (periods, status
      actions, confirmation codes, checkpoints, running balance).
- [ ] Seed path: enter the current spreadsheet's items once in Recurring
      Items, then start the current month with a manual opening balance.

### Phase 2: Due and unpaid at a glance

- [ ] **Upcoming** screen: overdue, due soon, and unpaid this month, with
      the same quick actions.
- [ ] Cash Flow header badges: sidebar count of overdue and due-soon
      items, like the card side's needs-review badge.
- [ ] A low-balance warning when the projected low point drops below a
      threshold set in Accounts.

### Phase 3: History

- [ ] **History** screen with the month list and per-month totals,
      variance, and implied spend.
- [ ] Mark a month closed once its final checkpoint is recorded.
- [ ] **Spreadsheet history import** (see section 6.1).

### 6.1 Importing the spreadsheet history

The workbook ("2026 Monthly Budget") has **35 worksheets, one per month,
from Jan 24 to Nov 26**. Jan 24, June 25, Oct 26, and Nov 26 were read
through the Google Sheets connector to design the parser. All four share
the same layout; only the rows differ. No amounts or confirmation codes
are copied into this document.

#### The layout

Row 1 is a header row and also holds the month's opening balance:

| Column | Row 1 | Item rows | Weekly Spend row | END OF WEEK / END OF MONTH row |
|---|---|---|---|---|
| A | (blank) | item name | `Weekly Spend` | label |
| B | `DATE` | date, `DD-Mon-YY` | period start date | checkpoint date |
| C | `CREDIT` | **money out** | spend estimate | (blank) |
| D | `DEBIT` | **money in** | (blank) | (blank) |
| E | **opening balance** | running balance (formula) | running balance | **actual balance**, entered by hand |
| F | `NOTES` | code: confirmation #, `AD`, `X`, `confirmed`, or blank | `AD` | **variance** (actual − projected) |
| G | `DAY` | day of month | day | day |
| I–L | `YEAR` *yyyy* `MONTH` *m* | free-text note in **I** (`** Submitted: <date> …`, `cancelled`, `not using`, `** TBD`) | | |

Notes on the layout:

- **The `CREDIT` and `DEBIT` labels are the reverse of the bank's
  meaning.** Column C reduces the balance and column D increases it. The
  importer goes by column position and the balance arithmetic, never by
  the label text.
- **The month comes from J1 and L1** (the year and month cells), with the
  sheet name as a fallback. Sheet names aren't consistent ("Jun 24",
  "June 25", "July 25").
- **Weekly Spend confirms the daily rate.** Every estimate sampled is $50
  × the days in its period: 5, 7, and 19 days in January 2024, and 2, 7,
  and 22 days in October 2026.
- **Checkpoints fall on the first Friday, the second Friday, and the last
  day of the month** in every month sampled.
- **The last row** holds closing minus opening for the month, which is
  calculated, so it's ignored. So is any stray cell outside columns A–L.
- **Rows with a date but no name** are empty placeholders and are skipped.
- **Item names drift over time**, for example "CIBC Visa" → "CIBC (Visa)",
  "Rogers Mastercard" → "Rogers (Mastercard)", "Mastercard PCF (KA)" →
  "PCF (Mastercard) - KA", and "Simplii Visa SR" → "Simplii (Visa)". The
  item set changes too: Tangerine, TD, RBC Mastercard, AMEX, life
  insurance, RESP rows, and cards marked `cancelled` or `not using`.
  Owner suffixes (`SR`, `(SR)`, `(KA)`, `- KA`) become the item's owner.
- **Example of business-day rolling:** in the October 2026 sheet,
  September 30's rent part 1 posts on October 1. September 30 is the
  National Day for Truth and Reconciliation, a bank holiday, which is the
  roll rule from section 2.2.

#### How rows become data

| Sheet row | Becomes |
|---|---|
| Row 1 | `CashFlowMonth`: `month` from J1/L1, `openingBalance` from E1, `importedFrom` set to the sheet name |
| `Weekly Spend` | The spend for the period that starts on its date. `spendOverride` is set only when the amount differs from rate × days. The month's `dailySpendRate` is inferred (it's $50 in every sample). |
| `END OF WEEK` / `END OF MONTH` | `CashFlowPeriod`: `endDate` from B. `actualBalance` from E when the date is on or before the import date; later checkpoints in the open months stay unrecorded. |
| Item row with an amount in C or D | `CashFlowEntry`: `bill` for C, `deposit` for D. `dueDate`, `postingDate`, and `postedDate` all come from B, with no re-rolling of history. |
| Item row with $0.00 or no amount | Entry with status `skipped`, keeping its note (`cancelled`, `not using`) |

The notes column F maps to status and code:

| Column F | Status | Stored as |
|---|---|---|
| A number (`139136`), the bank's confirmation number | `posted` if dated on or before today, otherwise `scheduled` | `confirmationCode`; the item is `settlement: "manual"` |
| `confirmed` | `posted` | no code; `manual` |
| `AD`, an automatic transaction | `posted` if past, otherwise `planned` | `settlement: "auto"` |
| `X`, a transaction someone else completed | `posted` if there's an amount (`planned` if future), `skipped` if $0.00 or blank | no code; `settlement: "external"` |
| A placeholder code (`9999999999`) | `posted` | no code; the column I note is kept |
| Blank | `posted` if past, otherwise `planned` | |

- Column I's text becomes the entry's `notes`.
- A `** Submitted: <date>` note also sets `scheduledDate`.

#### Import flow

1. **Upload** the workbook on an *Import history* screen (File → Download
   → Microsoft Excel in Google Sheets). It's parsed in the browser with
   `exceljs`, loaded only on that screen. Don't use the npm `xlsx`
   package: its last npm release has unfixed security advisories.
   `exceljs` returns real dates and numbers, not the formatted strings
   the connector shows.
2. **Parse.** `parseBudgetSheet(grid)` in `src/lib/historyImport.ts` is a
   pure function over a 2-D cell grid, so it's unit-tested against
   fixtures that copy this layout (with invented amounts).
3. **Map names once.** Each distinct row name across all 35 sheets is
   listed with a suggested recurring item. The suggestions come from
   normalised names: lower case, punctuation and owner suffixes removed,
   and "MasterCard" treated the same as "Mastercard". Names you leave
   unmapped import as one-off entries.
4. **Create recurring items from the newest sheet.** Its rows provide
   each item's name, day of month, default amount, owner, and
   `settlement`. Settlement is taken from the item's most common code
   across recent months.
   Items noted `cancelled` or `not using` start inactive. Stewart Pay's
   biweekly anchor comes from its dates; it lands on Thursdays. This
   saves entering the items by hand in phase 1.
5. **Preview** every month: opening balance, periods, entries, and the
   balance recomputed row by row and compared with column E. Any row
   where the recomputed balance differs from column E is flagged.
6. **Save** through one `POST /api/cashflow/history-import`.
   - Jan 24 to Sep 26 are saved `closed`.
   - **Oct 26** (the current month) and **Nov 26** (already planned) are
     saved as open months, with their future rows `planned` or
     `scheduled`.
   - The whole import is rejected if anything fails.
   - A month that already exists is skipped, never overwritten.

Before release, a read-only dry run through the connector over all 35
sheets checks that the parser handles every month, not just the four
sampled.

### Phase 4: Bank (debit) transactions

- [ ] Extend `Template` with optional `target?: "card" | "bank"` (absent
      means card, so no migration). Network is ignored for bank templates.
- [ ] The bank CSV's columns are **`Date, Transaction Details, Funds Out,
      Funds In`**. That fits the existing split-amount template mode:
      `amountMode: "split"`, with Funds Out as the debit column and Funds
      In as the credit column. Add `"funds out"` and `"funds in"` to the
      column-name guesses in `guessMapping` (`src/lib/csv.ts`), since only
      "debit" and "credit" are recognised today; "details" already maps
      the description. There is **no balance column**, so checkpoint
      balances can't be read from the file (see phase 5).
- [ ] Make the Import wizard target either a card or a bank account.
- [ ] What the sample rows show:

      ```
      Date, Transaction Details, Funds Out, Funds In
      10/01/2026,PAYROLL COMPANY,,3000.00
      10/01/2026, INTERAC E-TRANSFER SEND PERSON,1999.00,
      10/01/2026,POS MERCHANDISE ABC KINGSGATE,6.00,
      10/01/2026,POS MERCHANDISE SDM,25.87,
      ```

      - **Dates** are `MM/DD/YYYY`, the template default. All four sample
        rows are on day 01, so a file with a day after the 12th is needed
        to confirm the order.
      - **Headers and values have stray spaces** (`" Funds In "`,
        `" INTERAC…"`). `guessMapping` already trims headers. The bank
        import must also trim the description before it is used in
        de-duplication and vendor matching.
      - **The type is a prefix in the details text**, which is enough to
        classify every line without a type column.
- [ ] `classifyBankTransaction` works from those prefixes, with an
      editable keyword table:

      | Prefix | Direction | Type | Vendor name |
      |---|---|---|---|
      | `PAYROLL …` | in | `deposit` (pay) | the payer, matched to SR or KA's pay item |
      | Government benefit text (for example `CANADA CCB`, to confirm) | in | `deposit` | the benefit |
      | `INTERAC E-TRANSFER SEND …` | out | `etransfer` | the recipient |
      | `INTERAC E-TRANSFER RECEIVE …` (to confirm) | in | `etransfer` | the sender |
      | `POS MERCHANDISE …` | out | `purchase` (debit card) | the rest of the text (`SDM`, `ABC KINGSGATE`) |
      | Bill payment, ATM, fee, interest, and transfer text (to confirm) | either | matching type | the payee |

      - `cleanVendorName` currently strips only `POS *` with an asterisk,
        so a bank-side cleaner strips the `POS MERCHANDISE` prefix first.
      - Only `purchase` lines go through the vendor and category system
        and count as day-to-day spending.
      - E-transfers count as spending only if they aren't matched to a
        planned entry. If rent goes out by e-transfer, the rent items'
        `matchText` is the recipient (`E-TRANSFER SEND <name>`), so rent
        never counts as spending as well.
      - An unrecognised line is flagged `needsReview`, as on the card side.
- [ ] **Bank Transactions** screen (review, edit, delete) and **Spending**
      screen (debit purchases per period vs the estimate, by category).
- [ ] Move Categories, Vendor Mappings, and Import Templates into the
      sidebar's **Shared** group.

### Phase 5: Matching (estimates become actuals)

- [ ] After a bank import, suggest matches between bank lines and planned
      or scheduled entries: same direction, date within ±5 days of the due
      or scheduled date, the item's `matchText` in the description, and the
      exact amount for fixed items (any amount for variable items).
      **Suggest, then confirm in one click**, including a bulk "accept all
      exact matches"; never link silently. A confirmed match sets the
      status to `posted`, sets `postedDate` from the bank line's date and
      `actualAmount` from its amount, and links `bankTransactionId`.
- [ ] **Derived checkpoint balance.** The bank CSV has no balance column,
      so the balance is rebuilt from data: start at the last checkpoint
      you entered, then add Funds In and subtract Funds Out for each
      imported line up to the next checkpoint date. That figure is
      offered as the suggested actual balance, and you confirm it against
      the banking app. A mismatch means a missing or duplicated import,
      which is worth seeing.
- [ ] Once a period's spending is fully imported, the Spending screen
      shows actual debit spend next to the estimate and the implied spend.

### Phase 6: Sync with the Credit Card side (later)

- [ ] Link card-payment bills to their `Card` (`cardId`). The Cards screen
      shows next due date, amount, and status from Cash Flow.
- [ ] Prefill a card bill's expected amount from the card side (spend since
      the last `payment`), because current card CSVs don't include the
      statement balance.
- [ ] Link the bank's "payment to CIBC Visa" line to the card's matching
      `payment` transaction.
- [ ] Combined spending view (card purchases plus debit purchases). It must
      **exclude bank→card payments**, or every card purchase is counted
      twice, and must sign refunds using `categorySpendForTransaction`.

## 7. Design

There is no Claude Design handoff for the Cash Flow screens. The new screens
reuse the existing language: OKLCH tokens in `globals.css`, Public Sans for
text, IBM Plex Mono for amounts, the primitives in `src/components/ui.tsx`,
and the card side's table and modal patterns. If you'd like exact copy and
spacing for This Month and Upcoming, get a design handoff before phase 1's
UI work. Otherwise I'll build them in the existing style and we adjust
afterwards.

## 8. Testing

- **lib:** `tests/lib/cashflow.test.ts` covers recurrence, checkpoints,
  period assignment, and balance math. Phase 4 adds bank classification
  tests and phase 5 adds matching tests.
- **api:** one test file per new route, covering validation 400s, the
  "rejected request persists nothing" contract, and destructive opt-ins.
- **components:** This Month rendering and status transitions, and the
  sidebar workspace switch.
- **Manual check:** `npm run test:server` on port 4607 with
  `PENNYTRAIL_DATA_DIR` set to a scratch directory, never against the real
  store or Neon.

## 9. Risks and guardrails

- **Live data:** previews share the production database (Phase 0 fixes
  this). Never run a local server with `PENNYTRAIL_STORAGE=postgres`.
- **Merging to `main` deploys to production.** Merge phase by phase only
  when you ask. Each phase is additive, and the card side is never
  touched, so a partially finished Cash Flow side is safe to ship.
- **Rollback safety:** new collections are additive and keep existing
  fields, and `main`'s code keeps keys it doesn't recognise, so promoting
  an earlier deployment loses no data.
- **History integrity:** months are materialized and recurring-item edits
  apply forward only.

## 10. Decisions so far

- **Rent** is two monthly payments: part 1 on the last day of the month
  and part 2 on the 1st. Both roll to the next business day, which is why
  they often post together on the 1st (section 2.2).
- **Child Tax Benefit** is one payment a month with an uncertain date. The
  second spreadsheet line is dropped.
- **SR's pay** is every 2 weeks. **KA's pay** is on the 15th and the last
  day of the month.
- **BC Hydro** bills every 2 months. **Fortis** bills monthly.
- **SR and KA** are household members, recorded as an item's owner.
- **Pay** is consistent enough to project: estimate it, then correct it
  with the actual amount when it posts.
- **Weekly Spend** is a daily rate ($50) times the days in the period, and
  can be overridden for a single period.
- **A payment is done when it posts.** `scheduled` is still outstanding,
  and the posted date decides which period an item counts in.
- **History** goes back to **January 2024** and all of it is imported. The
  workbook is a **Google Sheet**, one worksheet per month (section 6.1).
  The structure was read through the Google Sheets connector, and the
  layout is the same across months, only the rows vary (section 6.1). The
  import itself uses an .xlsx download, so the app doesn't depend on the
  connector.
- **Oct 26 and Nov 26** import as open months; everything earlier imports
  as closed history.
- **Notes codes:** a number is the bank's confirmation number. **AD** is an
  automatic transaction. **X** is a transaction you didn't complete
  yourself, so it has no confirmation number but is still tracked. These
  map to an item's `settlement`: `manual`, `auto`, or `external`. Only
  `manual` items appear as "needs scheduling" on Upcoming. `auto` and
  `external` items show as "expected" until they post.
- **Bank CSV** columns are `Date, Transaction Details, Funds Out, Funds
  In`, with no balance column. The type comes from a prefix in the details
  text (phase 4).

## 11. Open questions

1. **More bank CSV wording:** a longer export would confirm the date order
   and the remaining prefixes (government benefit, e-transfer received,
   bill payments, card payments, ATM, fees). Scrubbing the amounts is
   optional; the description text is what's needed.
