import { describe, expect, it } from "vitest";
import { setupScratchDataDir } from "../helpers/testStore";
import { addEntry, confirmMatches, createAccount, deleteBankTxns, importBank, patchBankTxn, readStore, startMonth, unlinkMatch } from "../helpers/cashflowApi";
import { summarizeMonth } from "@/lib/cashflow";

setupScratchDataDir();

const sampleRows = [
  { date: "2026-10-01", rawDescription: "PAYROLL COMPANY", amount: 3000, direction: "in" },
  { date: "2026-10-01", rawDescription: " INTERAC E-TRANSFER SEND PERSON", amount: 1999, direction: "out" },
  { date: "2026-10-01", rawDescription: "POS MERCHANDISE ABC KINGSGATE", amount: 6, direction: "out" },
  { date: "2026-10-01", rawDescription: "POS MERCHANDISE SDM", amount: 25.87, direction: "out" },
];

describe("POST /api/bank-transactions/import", () => {
  it("imports and classifies the sample export", async () => {
    const { body: account } = await createAccount();
    const { status, body } = await importBank({ accountId: account.id, rows: sampleRows });
    expect(status).toBe(201);
    expect(body.counts).toEqual({ total: 4, review: 2, skipped: 0, duplicates: 0 });
    const byDesc = Object.fromEntries(body.transactions.map((t: { rawDescription: string; type: string }) => [t.rawDescription, t.type]));
    expect(byDesc).toEqual({
      "PAYROLL COMPANY": "deposit",
      "INTERAC E-TRANSFER SEND PERSON": "etransfer", // trimmed
      "POS MERCHANDISE ABC KINGSGATE": "purchase",
      "POS MERCHANDISE SDM": "purchase",
    });
  });

  it("skips duplicates, including within the same file, unless forced", async () => {
    const { body: account } = await createAccount();
    await importBank({ accountId: account.id, rows: sampleRows });
    const again = await importBank({ accountId: account.id, rows: [...sampleRows, sampleRows[3]] });
    expect(again.body.counts).toMatchObject({ total: 0, duplicates: 5 });
    const forced = await importBank({ accountId: account.id, rows: [{ ...sampleRows[3], forceImport: true }] });
    expect(forced.body.counts.total).toBe(1);
    expect((await readStore()).bankTransactions).toHaveLength(5);
  });

  it("treats padding differences as the same line", async () => {
    const { body: account } = await createAccount();
    await importBank({ accountId: account.id, rows: [sampleRows[1]] });
    const again = await importBank({ accountId: account.id, rows: [{ ...sampleRows[1], rawDescription: "INTERAC  E-TRANSFER SEND PERSON " }] });
    expect(again.body.counts.duplicates).toBe(1);
  });

  it("skips malformed rows and counts them", async () => {
    const { body: account } = await createAccount();
    const { body } = await importBank({
      accountId: account.id,
      rows: [
        { date: "10/01/2026", rawDescription: "X", amount: 1, direction: "out" },
        { date: "2026-10-01", rawDescription: "X", amount: -1, direction: "out" },
        { date: "2026-10-01", rawDescription: "X", amount: 0, direction: "out" },
        { date: "2026-10-01", rawDescription: "X", amount: 1, direction: "sideways" },
        null,
        { date: "2026-10-01", rawDescription: "OK", amount: 1, direction: "out" },
      ],
    });
    expect(body.counts).toMatchObject({ total: 1, skipped: 5 });
  });

  it("files a purchase under an existing vendor with the same name", async () => {
    const { body: account } = await createAccount();
    const { body: first } = await importBank({ accountId: account.id, rows: [sampleRows[3]] });
    const sdm = first.transactions[0];
    const state = await readStore();
    const category = state.categories[0].id;
    await patchBankTxn(sdm.id, { newParentName: "Shoppers Drug Mart", category });
    const { body: second } = await importBank({ accountId: account.id, rows: [{ ...sampleRows[3], date: "2026-10-05" }] });
    expect(second.transactions[0].needsReview).toBe(false);
    expect(second.transactions[0].childVendorId).toBe((await readStore()).bankTransactions.find((t) => t.id === sdm.id)!.childVendorId);
  });

  it("rejects an unknown account and an empty import", async () => {
    expect((await importBank({ accountId: "nope", rows: sampleRows })).status).toBe(400);
    const { body: account } = await createAccount();
    expect((await importBank({ accountId: account.id, rows: [] })).status).toBe(400);
  });
});

describe("PATCH /api/bank-transactions/[id]", () => {
  it("changes the type and rejects an unknown one", async () => {
    const { body: account } = await createAccount();
    const { body } = await importBank({ accountId: account.id, rows: [sampleRows[1]] });
    const id = body.transactions[0].id;
    expect((await patchBankTxn(id, { type: "bill_payment" })).body.type).toBe("bill_payment");
    expect((await patchBankTxn(id, { type: "gift" })).status).toBe(400);
  });

  it("names a vendor from the bank text without the prefix", async () => {
    const { body: account } = await createAccount();
    const { body } = await importBank({ accountId: account.id, rows: [sampleRows[3]] });
    const state = await readStore();
    await patchBankTxn(body.transactions[0].id, { newParentName: "Shoppers", category: state.categories[0].id });
    const after = await readStore();
    expect(after.childVendors.map((c) => c.rawName)).toEqual(["Sdm"]);
  });
});

describe("DELETE /api/bank-transactions", () => {
  it("requires ids or all: true", async () => {
    const { body: account } = await createAccount();
    await importBank({ accountId: account.id, rows: sampleRows });
    expect((await deleteBankTxns()).status).toBe(400);
    expect((await deleteBankTxns({ wipe: true })).status).toBe(400);
    expect((await readStore()).bankTransactions).toHaveLength(4);
    expect((await deleteBankTxns({ all: true })).body.deletedCount).toBe(4);
  });
});

describe("matching bank lines to entries", () => {
  async function octoberWithPay() {
    const { body: account } = await createAccount();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1000 });
    const { body: pay } = await addEntry({ monthId: oct.month.id, name: "Stewart Pay", kind: "deposit", postingDate: "2026-10-01", expectedAmount: 2999 });
    const { body: imported } = await importBank({ accountId: account.id, rows: [sampleRows[0]] });
    return { account, oct, pay, line: imported.transactions[0] };
  }

  it("posts the entry with the line's date and amount, and moves the balance", async () => {
    const { oct, pay, line } = await octoberWithPay();
    const { status } = await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }] });
    expect(status).toBe(200);
    const state = await readStore();
    const entry = state.cashFlowEntries.find((e) => e.id === pay.id)!;
    expect(entry).toMatchObject({ status: "posted", postedDate: "2026-10-01", actualAmount: 3000, bankTransactionId: line.id });
    expect(state.bankTransactions[0].entryId).toBe(pay.id);
    // 1,000 − 1,550 spend + 3,000
    expect(summarizeMonth(state.cashFlowMonths.find((m) => m.id === oct.month.id)!, state.cashFlowEntries).projectedClose).toBe(2450);
  });

  it("is all-or-nothing", async () => {
    const { pay, line } = await octoberWithPay();
    const res = await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }, { bankTransactionId: "gone", entryId: "gone" }] });
    expect(res.status).toBe(409);
    expect((await readStore()).cashFlowEntries.find((e) => e.id === pay.id)!.status).toBe("planned");
  });

  it("refuses a line and entry going opposite ways, or a repeat", async () => {
    const { account, oct, pay, line } = await octoberWithPay();
    const { body: bill } = await addEntry({ monthId: oct.month.id, name: "Bill", kind: "bill", postingDate: "2026-10-01", expectedAmount: 3000 });
    expect((await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: bill.id }] })).status).toBe(409);
    await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }] });
    const { body: second } = await addEntry({ monthId: oct.month.id, name: "Stewart Pay", kind: "deposit", postingDate: "2026-10-15", expectedAmount: 3000 });
    expect((await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: second.id }] })).status).toBe(409);
    expect(account.id).toBeTruthy();
  });

  it("rejects the same line twice in one batch", async () => {
    const { pay, line } = await octoberWithPay();
    expect((await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }, { bankTransactionId: line.id, entryId: "other" }] })).status).toBe(400);
  });

  it("unlinks, returning the entry to outstanding", async () => {
    const { pay, line } = await octoberWithPay();
    await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }] });
    expect((await unlinkMatch({ bankTransactionId: line.id })).status).toBe(200);
    const state = await readStore();
    const entry = state.cashFlowEntries.find((e) => e.id === pay.id)!;
    expect(entry.status).toBe("planned");
    expect(entry.postedDate).toBeUndefined();
    expect(entry.actualAmount).toBeUndefined();
    expect(entry.bankTransactionId).toBeUndefined();
    expect(state.bankTransactions[0].entryId).toBeUndefined();
    expect((await unlinkMatch({ bankTransactionId: line.id })).status).toBe(400);
  });

  it("deleting a matched bank line keeps the entry posted but drops the link", async () => {
    const { pay, line } = await octoberWithPay();
    await confirmMatches({ matches: [{ bankTransactionId: line.id, entryId: pay.id }] });
    await deleteBankTxns({ ids: [line.id] });
    const entry = (await readStore()).cashFlowEntries.find((e) => e.id === pay.id)!;
    expect(entry.status).toBe("posted");
    expect(entry.bankTransactionId).toBeUndefined();
  });

  it("moves an entry whose line posted in the next month", async () => {
    const { body: account } = await createAccount();
    const { body: oct } = await startMonth({ accountId: account.id, month: "2026-10", openingBalance: 1000 });
    const { body: nov } = await startMonth({ accountId: account.id, month: "2026-11" });
    const { body: rent } = await addEntry({ monthId: oct.month.id, name: "152 Rent (first)", kind: "bill", postingDate: "2026-10-31", expectedAmount: 1500 });
    const { body: imported } = await importBank({ accountId: account.id, rows: [{ date: "2026-11-02", rawDescription: "INTERAC E-TRANSFER SEND PERSON", amount: 1500, direction: "out" }] });
    await confirmMatches({ matches: [{ bankTransactionId: imported.transactions[0].id, entryId: rent.id }] });
    const state = await readStore();
    expect(state.cashFlowEntries.find((e) => e.id === rent.id)!.monthId).toBe(nov.month.id);
    // October no longer loses the 1,500; November's carried opening follows.
    const octClose = summarizeMonth(state.cashFlowMonths.find((m) => m.id === oct.month.id)!, state.cashFlowEntries.filter((e) => e.monthId === oct.month.id)).closingBalance;
    expect(octClose).toBe(1000 - 1550);
    expect(state.cashFlowMonths.find((m) => m.id === nov.month.id)!.openingBalance).toBe(octClose);
  });
});
