import { describe, expect, it } from "vitest";
import { bankVendorName, classifyBankLine } from "@/lib/bankClassify";

describe("classifyBankLine", () => {
  it("reads the sample export's four lines", () => {
    expect(classifyBankLine("PAYROLL COMPANY", "in")).toEqual({ type: "deposit", vendor: "COMPANY", recognised: true });
    // The export pads this one with a leading space.
    expect(classifyBankLine(" INTERAC E-TRANSFER SEND PERSON", "out")).toEqual({ type: "etransfer", vendor: "PERSON", recognised: true });
    expect(classifyBankLine("POS MERCHANDISE ABC KINGSGATE", "out")).toEqual({ type: "purchase", vendor: "ABC KINGSGATE", recognised: true });
    expect(classifyBankLine("POS MERCHANDISE SDM", "out")).toEqual({ type: "purchase", vendor: "SDM", recognised: true });
  });

  it.each([
    ["CANADA CHILD BENEFIT", "in", "deposit"],
    ["GST CREDIT CANADA", "in", "deposit"],
    ["INTERAC E-TRANSFER RECEIVE FRIEND", "in", "etransfer"],
    ["INTERAC E-TRANSFER AUTODEPOSIT FRIEND", "in", "etransfer"],
    ["ONLINE BANKING PAYMENT BC HYDRO", "out", "bill_payment"],
    ["BILL PAYMENT FORTISBC", "out", "bill_payment"],
    ["PRE-AUTHORIZED DEBIT INSURANCE CO", "out", "bill_payment"],
    ["ATM WITHDRAWAL 123 MAIN ST", "out", "atm"],
    ["ABM WDL", "out", "atm"],
    ["INTERNET TRANSFER 000123", "out", "transfer"],
    ["TRANSFER FROM SAVINGS", "in", "transfer"],
    ["MONTHLY FEE", "out", "fee"],
    ["SERVICE CHARGE", "out", "fee"],
    ["INTEREST PAID", "in", "interest"],
  ] as const)("%s (%s) is %s", (details, direction, type) => {
    expect(classifyBankLine(details, direction).type).toBe(type);
  });

  it("respects direction: a POS line coming in isn't a purchase", () => {
    expect(classifyBankLine("POS MERCHANDISE SDM", "in")).toEqual({ type: "deposit", vendor: "POS MERCHANDISE SDM", recognised: false });
  });

  it("falls back to the direction's default and says so", () => {
    expect(classifyBankLine("SOMETHING ELSE", "out")).toEqual({ type: "purchase", vendor: "SOMETHING ELSE", recognised: false });
    expect(classifyBankLine("SOMETHING ELSE", "in")).toEqual({ type: "deposit", vendor: "SOMETHING ELSE", recognised: false });
  });

  it("doesn't read 'fee' inside another word", () => {
    expect(classifyBankLine("COFFEE ROASTERS", "out").type).toBe("purchase");
    expect(classifyBankLine("COFFEE ROASTERS", "out").recognised).toBe(false);
  });

  it("is case- and spacing-insensitive", () => {
    expect(classifyBankLine("  pos   merchandise   sdm ", "out")).toEqual({ type: "purchase", vendor: "SDM", recognised: true });
  });
});

describe("bankVendorName", () => {
  it("strips the bank's prefix and cleans the name like a card line", () => {
    expect(bankVendorName("POS MERCHANDISE ABC KINGSGATE", "out")).toBe("Abc Kingsgate");
    expect(bankVendorName("POS MERCHANDISE SDM", "out")).toBe("Sdm");
    expect(bankVendorName("INTERAC E-TRANSFER SEND PERSON", "out")).toBe("Person");
  });
});
