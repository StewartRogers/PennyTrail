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
  system: boolean;
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
  headerSnapshot: string[];
}

export interface VendorRule {
  id: string;
  pattern: string;
  vendor: string;
  category: string;
}

export interface Transaction {
  id: string;
  cardId: string;
  date: string; // ISO yyyy-mm-dd
  rawDescription: string;
  amount: number; // always positive
  type: TxnType;
  category: string | null;
  vendor: string;
  needsReview: boolean;
}

export interface AppState {
  cards: Card[];
  categories: Category[];
  templates: Template[];
  vendorRules: VendorRule[];
  transactions: Transaction[];
}
