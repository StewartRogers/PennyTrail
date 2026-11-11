// Classifies a bank (chequing) line from its "Transaction Details" text. The
// bank puts the type in a prefix — "PAYROLL …", "INTERAC E-TRANSFER SEND …",
// "POS MERCHANDISE …" — so a keyword table covers it without a type column.
// See docs/cash-flow-plan.md phase 4.

import type { BankTxnType } from "./types";
import { cleanVendorName } from "./classify";

export interface BankClassification {
  type: BankTxnType;
  // The counterparty text with the prefix removed ("SDM", "PERSON").
  vendor: string;
  // False when no rule matched and the type is only the direction's default.
  recognised: boolean;
}

interface Rule {
  pattern: RegExp;
  type: BankTxnType;
  direction?: "in" | "out";
}

// Checked in order; the first match wins. A capture group, when present, is
// the vendor text.
const RULES: Rule[] = [
  { pattern: /^PAYROLL\b\s*(.*)$/, type: "deposit", direction: "in" },
  { pattern: /^(?:DIRECT DEPOSIT|DIR DEP|PAY DEPOSIT)\b\s*(.*)$/, type: "deposit", direction: "in" },
  { pattern: /\b(CANADA CHILD|CHILD TAX|CCB|CAN(?:ADA)? CHILD BENEFIT|GST ?CREDIT|GST\/HST|BC FAMILY|FED(?:ERAL)? (?:GOVT|GOV|PAYMENT)|GOVT? CANADA|CANADA PRO DEPOSIT)\b.*$/, type: "deposit", direction: "in" },
  { pattern: /^INTERAC E-?TRANSFER (?:SEND|SENT|TO)\b\s*(.*)$/, type: "etransfer", direction: "out" },
  { pattern: /^INTERAC E-?TRANSFER (?:RECEIVE|RECEIVED|DEPOSIT|AUTODEPOSIT|AUTO DEPOSIT|FROM)\b\s*(.*)$/, type: "etransfer", direction: "in" },
  { pattern: /^(?:INTERAC )?E-?TRANSFER\b\s*(.*)$/, type: "etransfer" },
  { pattern: /^(?:POS MERCHANDISE|POS PURCHASE|POINT OF SALE(?: PURCHASE)?|VISA DEBIT(?: PURCHASE)?|DEBIT PURCHASE|INTERAC PURCHASE|POS)\b\s*(.*)$/, type: "purchase", direction: "out" },
  { pattern: /^(?:ONLINE BANKING PAYMENT|ONLINE BILL PAYMENT|BILL PAYMENT|BILL PAY|PAYMENT TO|MISC PAYMENT|PRE-?AUTHORI[SZ]ED DEBIT|PRE-?AUTH(?: DEBIT)?|PAP|INSURANCE|UTILITY BILL PMT)\b\s*(.*)$/, type: "bill_payment" },
  { pattern: /^(?:ATM|ABM)(?: WITHDRAWAL| WDL)?\b\s*(.*)$/, type: "atm", direction: "out" },
  { pattern: /^CASH WITHDRAWAL\b\s*(.*)$/, type: "atm", direction: "out" },
  { pattern: /^(?:INTERNET TRANSFER|ONLINE TRANSFER|TRANSFER (?:TO|FROM)|TFR(?: TO| FROM)?|MOBILE TRANSFER)\b\s*(.*)$/, type: "transfer" },
  { pattern: /^(?:SERVICE CHARGE|MONTHLY (?:ACCOUNT )?FEE|ACCOUNT FEE|NSF(?: FEE)?|OVERDRAFT (?:FEE|INTEREST)|.*\bFEE)\b\s*(.*)$/, type: "fee", direction: "out" },
  { pattern: /^(?:INTEREST(?: PAID| EARNED)?|DEPOSIT INTEREST)\b\s*(.*)$/, type: "interest", direction: "in" },
];

function normalize(details: string): string {
  return details.replace(/\s+/g, " ").trim().toUpperCase();
}

export function classifyBankLine(details: string, direction: "in" | "out"): BankClassification {
  const text = normalize(details);
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const vendor = (match[1] ?? "").trim() || text;
    return { type: rule.type, vendor, recognised: true };
  }
  return { type: direction === "in" ? "deposit" : "purchase", vendor: text, recognised: false };
}

// The vendor name a bank line files under in the shared vendor system: the
// counterparty without the bank's prefix, cleaned the same way as a card
// line, so "POS MERCHANDISE SDM" and a card's "SDM" can share a vendor.
export function bankVendorName(details: string, direction: "in" | "out"): string {
  return cleanVendorName(classifyBankLine(details, direction).vendor);
}

// Types that count as day-to-day spending on the Spending screen. Bill
// payments are tracked as cash-flow entries instead, transfers move money
// between your own accounts, and e-transfers count only when they aren't
// matched to a planned entry (rent sent by e-transfer is a bill).
export function isSpendingType(type: BankTxnType): boolean {
  return type === "purchase" || type === "atm" || type === "fee";
}

export const BANK_TXN_TYPES: BankTxnType[] = ["deposit", "purchase", "bill_payment", "transfer", "etransfer", "atm", "fee", "interest"];

export const BANK_TXN_TYPE_LABELS: Record<BankTxnType, string> = {
  deposit: "Deposit",
  purchase: "Debit purchase",
  bill_payment: "Bill payment",
  transfer: "Transfer",
  etransfer: "E-transfer",
  atm: "ATM",
  fee: "Fee",
  interest: "Interest",
};
