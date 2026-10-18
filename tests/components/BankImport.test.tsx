import { describe, expect, it } from "vitest";
import { rowsFromCsv } from "@/components/cashflow/BankImport";
import { guessMapping, parseCSV } from "@/lib/csv";

// The bank's own export, header spacing included.
const SAMPLE = `Date, Transaction Details, Funds Out, Funds In
10/01/2026,PAYROLL COMPANY,,3000.00
10/01/2026, INTERAC E-TRANSFER SEND PERSON,1999.00,
10/01/2026,POS MERCHANDISE ABC KINGSGATE,6.00,
10/01/2026,POS MERCHANDISE SDM,25.87,
10/15/2026,POS MERCHANDISE SDM,,
`;

describe("bank CSV mapping", () => {
  it("guesses the Funds Out / Funds In columns", () => {
    const [header] = parseCSV(SAMPLE);
    expect(guessMapping(header)).toMatchObject({ dateCol: 0, descCol: 1, debitCol: 2, creditCol: 3 });
  });

  it("turns lines into rows with direction and a positive amount", () => {
    const lines = parseCSV(SAMPLE);
    const { rows, bad } = rowsFromCsv(lines.slice(1), { dateCol: 0, descCol: 1, outCol: 2, inCol: 3, dateFormat: "MM/DD/YYYY" });
    expect(rows).toEqual([
      { date: "2026-10-01", rawDescription: "PAYROLL COMPANY", amount: 3000, direction: "in" },
      { date: "2026-10-01", rawDescription: "INTERAC E-TRANSFER SEND PERSON", amount: 1999, direction: "out" },
      { date: "2026-10-01", rawDescription: "POS MERCHANDISE ABC KINGSGATE", amount: 6, direction: "out" },
      { date: "2026-10-01", rawDescription: "POS MERCHANDISE SDM", amount: 25.87, direction: "out" },
    ]);
    expect(bad).toBe(1); // the line with no amount
  });

  it("reads the month first, so 10/15 is October 15", () => {
    const { rows } = rowsFromCsv([["10/15/2026", "X", "1.00", ""]], { dateCol: 0, descCol: 1, outCol: 2, inCol: 3, dateFormat: "MM/DD/YYYY" });
    expect(rows[0].date).toBe("2026-10-15");
  });

  it("nets a line with both columns filled", () => {
    const { rows } = rowsFromCsv([["10/01/2026", "X", "10.00", "25.50"]], { dateCol: 0, descCol: 1, outCol: 2, inCol: 3, dateFormat: "MM/DD/YYYY" });
    expect(rows[0]).toMatchObject({ amount: 15.5, direction: "in" });
  });

  it("works with only one amount column mapped", () => {
    const { rows } = rowsFromCsv([["10/01/2026", "X", "10.00", "25.50"]], { dateCol: 0, descCol: 1, outCol: 2, inCol: -1, dateFormat: "MM/DD/YYYY" });
    expect(rows[0]).toMatchObject({ amount: 10, direction: "out" });
  });

  it("counts lines with an unreadable date", () => {
    const { rows, bad } = rowsFromCsv([["2026-10-01", "X", "1.00", ""]], { dateCol: 0, descCol: 1, outCol: 2, inCol: 3, dateFormat: "MM/DD/YYYY" });
    expect(rows).toEqual([]);
    expect(bad).toBe(1);
  });
});
