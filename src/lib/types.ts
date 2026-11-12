export const NETWORKS = ["Visa", "Mastercard", "American Express"] as const;

export type Network = (typeof NETWORKS)[number];

export function isNetwork(value: unknown): value is Network {
  return typeof value === "string" && (NETWORKS as readonly string[]).includes(value);
}

export type TxnType = "purchase" | "payment" | "credit" | "cashback" | "fee";

export type AmountConvention = "positive_is_purchase" | "negative_is_purchase";

export type AmountMode = "single" | "split";

export interface Card {
  id: string;
  name: string;
  bank: string;
  network: Network;
  last4: string;
  color: string;
  // ISO 4217 code (e.g. "USD", "MXN"). Absent/undefined means CAD — the
  // store's base/display currency, matching what fmtCurrency renders and
  // what every existing card's statements were already in. A non-CAD card
  // is converted to CAD per-transaction at import time (see
  // src/lib/fx.ts) — the store never holds a mix of currencies.
  currency?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  // When true, every transaction whose derived category is this one is
  // left out of Dashboard aggregates (KPIs, trend, breakdown, top
  // merchants, avg/month) — but stays fully visible everywhere else
  // (Transactions, Categories totals). Absent/undefined means included,
  // so existing stored categories don't need a migration.
  excludeFromDashboard?: boolean;
}

export interface Template {
  id: string;
  name: string;
  bank: string;
  network: Network;
  dateCol: number;
  descCol: number;
  dateFormat: string;
  amountMode: AmountMode;
  amountCol: number;
  amountConvention: AmountConvention;
  debitCol: number;
  creditCol: number;
  // Optional source columns. -1 means "not mapped" — PennyTrail derives
  // vendor/category/type itself via classification in that case.
  vendorCol: number;
  categoryCol: number;
  typeCol: number;
  // Rows to skip before the header row — some banks prepend summary/
  // metadata rows before the real column headers.
  skipRows: number;
  headerSnapshot: string[];
}

// The parent is the stable, user-owned vendor identity: a name and a
// category, nothing else. It's never recomputed from text — only ever
// created or edited directly by the user (or, once, by a fuzzy-match
// auto-attach — see ChildVendor).
export interface ParentVendor {
  id: string;
  name: string;
  category: string;
}

// A child is an exact-match key: one specific cleaned-vendor-name shape
// (e.g. "Freedom Mobile Toronto") linked to the parent it belongs to. Once
// created, its parentId is authoritative — matching logic only ever
// decides where a *new* child lands, never re-evaluates an existing one.
export interface ChildVendor {
  id: string;
  parentId: string;
  rawName: string;
}

export interface Transaction {
  id: string;
  cardId: string;
  date: string; // ISO yyyy-mm-dd
  rawDescription: string;
  amount: number; // always positive
  type: TxnType;
  // Category is intentionally not stored here — it's always derived live
  // via childVendorId -> ChildVendor.parentId -> ParentVendor.category, so
  // there's no denormalized copy that can go stale or disagree with itself.
  childVendorId: string | null;
  needsReview: boolean;
  // Amount recovered afterward (employer/insurance reimbursement) that never
  // shows up as its own card transaction — e.g. a future statement credit
  // lumped in with unrelated spend. Optional and defaults to "not
  // reimbursed" so existing stored transactions don't need a migration.
  // Always <= amount; partial reimbursement is expected (see
  // netAmountForTransaction in vendors.ts).
  reimbursedAmount?: number;
  // Free-text, e.g. auto-filled at import time for a foreign-currency card
  // with the original amount/currency and the Bank of Canada rate used to
  // convert it to the CAD `amount` above (see ImportWizard's FX
  // conversion) — the store never keeps the original amount as its own
  // field, only this note. Shown on the transaction (Edit modal) but never
  // on the Transactions list.
  conversionNote?: string;
  // Same idea as Category.excludeFromDashboard, but scoped to one
  // transaction instead of every transaction under a category — for a
  // one-off outlier (e.g. a single large purchase) that shouldn't skew
  // Dashboard/Averages, without hiding every other transaction from the
  // same vendor or category. Optional and defaults to "included" so
  // existing stored transactions don't need a migration.
  excludeFromDashboard?: boolean;
}

// ---------------------------------------------------------------------------
// Cash Flow (see docs/cash-flow-plan.md). Separate collections from the card
// side on purpose: every card screen aggregates `transactions` with card
// semantics, so bank lines live in their own `bankTransactions`.
// ---------------------------------------------------------------------------

// Column mapping for a bank account's CSV export, saved on the account after
// the first import. Amounts come in as separate out/in columns (the bank's
// "Funds Out" / "Funds In"); -1 means unmapped.
export interface BankImportMapping {
  dateCol: number;
  descCol: number;
  outCol: number;
  inCol: number;
  dateFormat: string;
}

export interface BankAccount {
  id: string;
  name: string;
  institution: string;
  last4: string;
  color: string;
  // Default for each new month's Weekly Spend: this rate times the days in
  // the period. Each month keeps its own copy (CashFlowMonth.dailySpendRate).
  dailySpendRate: number;
  // ISO dates the bank doesn't post on, besides weekends — prefilled from
  // canadianBankHolidays() and editable, so a wrong date is a data fix.
  bankHolidays: string[];
  // The projected low point warns below this balance. 0 means "warn only
  // when the projection goes negative".
  lowBalanceThreshold?: number;
  importMapping?: BankImportMapping;
}

export type CashFlowKind = "bill" | "deposit";

// "last" is the last day of whatever month it lands in, so short months need
// no special-casing. A numeric day past the end of a month clamps to it.
export type DayOfMonth = number | "last";

export type Recurrence =
  | { type: "monthly"; day: DayOfMonth }
  | { type: "everyNMonths"; n: number; day: DayOfMonth; anchorMonth: string }
  | { type: "semiMonthly"; days: [DayOfMonth, DayOfMonth] }
  | { type: "everyNWeeks"; n: number; anchorDate: string }
  | { type: "once"; date: string };

// What happens when a due date isn't a business day: bills move forward to
// the next one, pay moves back (employers pay early).
export type RollRule = "next" | "previous" | "none";

// Who completes a payment. "manual": you schedule it and record the bank's
// confirmation number. "auto": the spreadsheet's AD — a pre-authorised debit
// or direct deposit. "external": the spreadsheet's X — completed by someone
// else or arriving on its own, so no confirmation number, but still tracked.
// Only "manual" items ever ask to be scheduled.
export type Settlement = "manual" | "auto" | "external";

export interface CashFlowItem {
  id: string;
  accountId: string;
  name: string;
  kind: CashFlowKind;
  // "variable" items (card payments, utilities) default each new month to
  // the most recent posted amount instead of defaultAmount.
  amountMode: "fixed" | "variable";
  defaultAmount: number; // always positive; kind gives the sign
  recurrence: Recurrence;
  roll: RollRule;
  settlement: Settlement;
  dateUncertain?: boolean;
  owner?: string;
  // Case-insensitive text that identifies this item's bank lines
  // ("BC HYDRO", "E-TRANSFER SEND <landlord>") for import matching.
  matchText?: string;
  active: boolean;
  notes?: string;
}

export interface CashFlowPeriod {
  id: string;
  endDate: string; // the checkpoint date, inclusive
  label: string;
  // Absent means the month's dailySpendRate × days in the period.
  spendOverride?: number;
  // The real balance entered at the checkpoint; absent until recorded.
  actualBalance?: number;
}

export interface CashFlowMonth {
  id: string;
  accountId: string;
  month: string; // yyyy-mm
  openingBalance: number;
  openingSource: "carried" | "manual";
  dailySpendRate: number;
  periods: CashFlowPeriod[];
  closed: boolean;
  importedFrom?: string; // worksheet name, for months imported from the spreadsheet
}

// Indicators for confirming an entry's real amount, nothing more: Projected
// until the deposit or withdrawal is confirmed, then Actual; Skipped entries
// don't count. Stores written before the rename ("planned", "scheduled",
// "posted") are mapped on read — see normalizeState.
export type EntryStatus = "projected" | "actual" | "skipped";

export interface CashFlowEntry {
  id: string;
  monthId: string;
  itemId: string | null; // null = one-off
  // `${itemId}:${dueDate}` for generated entries — stops a payment that
  // rolled across a month boundary from being generated in both months.
  occurrenceKey?: string;
  name: string;
  kind: CashFlowKind;
  dueDate: string; // nominal
  postingDate: string; // expected, business-day adjusted
  postedDate?: string; // actual; once set, decides the period
  expectedAmount: number;
  actualAmount?: number;
  status: EntryStatus;
  settlement?: Settlement;
  dateUncertain?: boolean;
  scheduledDate?: string;
  confirmationCode?: string;
  // When confirmationCode was entered (ISO date-time, set by the server).
  // Absent for numbers imported from the spreadsheet or entered before this
  // was recorded.
  confirmationRecordedAt?: string;
  bankTransactionId?: string;
  notes?: string;
}

export type BankTxnType = "deposit" | "purchase" | "bill_payment" | "transfer" | "etransfer" | "atm" | "fee" | "interest";

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string;
  rawDescription: string;
  amount: number; // always positive; direction gives the sign
  direction: "in" | "out";
  type: BankTxnType;
  childVendorId: string | null;
  needsReview: boolean;
  entryId?: string; // the cash-flow entry this line was matched to
}

export interface AppState {
  cards: Card[];
  categories: Category[];
  templates: Template[];
  parentVendors: ParentVendor[];
  childVendors: ChildVendor[];
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  cashFlowItems: CashFlowItem[];
  cashFlowMonths: CashFlowMonth[];
  cashFlowEntries: CashFlowEntry[];
  bankTransactions: BankTransaction[];
}
