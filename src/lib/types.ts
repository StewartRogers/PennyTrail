export type Network = "Visa" | "Mastercard";

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
}

export interface AppState {
  cards: Card[];
  categories: Category[];
  templates: Template[];
  parentVendors: ParentVendor[];
  childVendors: ChildVendor[];
  transactions: Transaction[];
}
