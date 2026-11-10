import { describe, expect, it } from "vitest";
import { resetMonthStatuses } from "@/lib/cashflowState";
import type { BankTransaction, CashFlowEntry, CashFlowMonth } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

const month: CashFlowMonth = { id: "m_nov", accountId: "acct", month: "2026-11", openingBalance: 1000, openingSource: "manual", dailySpendRate: 50, periods: [{ id: "p", endDate: "2026-11-30", label: "End of month" }], closed: false };
const entry = (o: Partial<CashFlowEntry>): CashFlowEntry => ({ id: o.name!, monthId: "m_nov", itemId: null, name: "", kind: "bill", dueDate: "2026-11-02", postingDate: "2026-11-02", expectedAmount: 100, status: "planned", ...o });

describe("resetMonthStatuses", () => {
  it("puts posted, scheduled, and skipped entries back to Planned", () => {
    const state = makeAppState({
      cashFlowMonths: [month],
      cashFlowEntries: [
        entry({ name: "Posted", status: "posted", postedDate: "2026-11-04", actualAmount: 98.5 }),
        entry({ name: "Scheduled", status: "scheduled", confirmationCode: "123" }),
        entry({ name: "Skipped", status: "skipped" }),
        entry({ name: "Planned" }),
      ],
    });
    expect(resetMonthStatuses(state, month)).toBe(3);
    expect(state.cashFlowEntries.every((e) => e.status === "planned")).toBe(true);
    const posted = state.cashFlowEntries.find((e) => e.name === "Posted")!;
    // Stays where it posted, with the amount it posted for.
    expect(posted).toMatchObject({ postingDate: "2026-11-04", actualAmount: 98.5 });
    expect(posted.postedDate).toBeUndefined();
    expect(state.cashFlowEntries.find((e) => e.name === "Scheduled")!.confirmationCode).toBe("123");
  });

  it("undoes a bank-line match on both sides", () => {
    const txn: BankTransaction = { id: "t1", accountId: "acct", date: "2026-11-04", rawDescription: "HYDRO", amount: 98.5, direction: "out", type: "bill_payment", childVendorId: null, needsReview: false, entryId: "Hydro" };
    const state = makeAppState({
      cashFlowMonths: [month],
      cashFlowEntries: [entry({ name: "Hydro", status: "posted", postedDate: "2026-11-04", actualAmount: 98.5, bankTransactionId: "t1" })],
      bankTransactions: [txn],
    });
    resetMonthStatuses(state, month);
    expect(state.cashFlowEntries[0].bankTransactionId).toBeUndefined();
    expect(state.bankTransactions[0].entryId).toBeUndefined();
  });

  it("leaves other months alone", () => {
    const state = makeAppState({
      cashFlowMonths: [month],
      cashFlowEntries: [entry({ name: "October", monthId: "m_oct", status: "posted", postedDate: "2026-10-30" })],
    });
    expect(resetMonthStatuses(state, month)).toBe(0);
    expect(state.cashFlowEntries[0].status).toBe("posted");
  });
});
