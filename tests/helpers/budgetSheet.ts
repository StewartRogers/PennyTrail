import type { SheetCell } from "@/lib/historyImport";

// A worksheet laid out exactly like the monthly budget workbook (columns
// A–L, see docs/cash-flow-plan.md section 6.1), with invented amounts. Cells
// are the formatted strings the Google Sheets connector returns.
export function octoberSheet(): SheetCell[][] {
  return [
    ["", "DATE", "CREDIT", "DEBIT", "$10,000.00", "NOTES", "DAY", "", "YEAR", "2026", "MONTH", "10"],
    ["Weekly Spend", "01-Oct-26", "$100.00", "", "$9,900.00", "AD", "1"],
    ["152 Rent (first)", "01-Oct-26", "$1,500.00", "", "$8,400.00", "9999999999", "1", "", "** Sep 20 2026 8:20PM (forgot to capture ref number)"],
    ["Stewart Pay", "01-Oct-26", "", "$3,000.00", "$11,400.00", "AD", "1"],
    ["152 Rent (second)", "01-Oct-26", "$2,000.00", "", "$9,400.00", "106126052602", "1", "", "** Sep 20 2026 8:25PM"],
    ["CIBC (Visa)", "01-Oct-26", "$222.47", "", "$9,177.53", "confirmed", "1"],
    ["RBC AVION (Visa)", "02-Oct-26", "", "", "$9,177.53", "X", "2", "", "cancelled"],
    ["END OF WEEK", "02-Oct-26", "", "", "$9,150.00", "-27.53", "2"],
    ["Weekly Spend", "03-Oct-26", "$350.00", "", "$8,800.00", "AD", "3"],
    ["Child Tax Benefit", "09-Oct-26", "", "", "$8,800.00", "X", "9"],
    ["Simplii (Visa)", "09-Oct-26", "$754.30", "", "$8,045.70", "confirmed", "9"],
    ["152 Home Insurance", "09-Oct-26", "$28.92", "", "$8,016.78", "AD", "9"],
    ["", "09-Oct-26", "", "", "$8,016.78", "", "9"],
    ["END OF WEEK", "09-Oct-26", "", "", "$8,000.00", "-16.78", "9"],
    ["Weekly Spend", "10-Oct-26", "$1,100.00", "", "$6,900.00", "AD", "10"],
    ["Stewart Pay", "15-Oct-26", "", "$3,000.00", "$9,900.00", "AD", "15"],
    ["Kerri Pay", "15-Oct-26", "", "$2,400.00", "$12,300.00", "AD", "15"],
    ["AMEX", "19-Oct-26", "$1,571.06", "", "$10,728.94", "136258", "19"],
    ["PCF (Mastercard) - KA", "20-Oct-26", "", "", "$10,728.94", "X", "20"],
    ["Child Tax Benefit", "20-Oct-26", "", "$502.35", "$11,231.29", "X", "20"],
    ["BC Hydro", "23-Oct-26", "$188.77", "", "$11,042.52", "136266", "23"],
    ["Stewart Pay", "29-Oct-26", "", "$3,000.00", "$14,042.52", "AD", "29"],
    ["Wealthsimple (Visa)", "31-Oct-26", "$0.00", "", "$14,042.52", "X", "31"],
    ["Kerri Pay", "31-Oct-26", "", "$2,400.00", "$16,442.52", "AD", "31"],
    ["152 Rent (first)", "31-Oct-26", "$1,500.00", "", "$14,942.52", "6156431232", "31", "", "** October 12, 2026 at 12:05 p.m. ET."],
    ["END OF MONTH", "31-Oct-26", "", "", "$14,942.52", "0.00", "31"],
    ["", "", "", "", "", "$4,942.52"],
  ];
}

// September 2026: every checkpoint recorded, closing at 10,000.00 — the
// opening balance of octoberSheet().
//   Sep 1–4   9,000 − 200 = 8,800 (actual 8,800)
//   Sep 5–11  8,800 − 350 = 8,450 (actual 8,450)
//   Sep 12–30 8,450 − 950 + 2,000 = 9,500 (actual 10,000, variance +500)
export function septemberSheet(): SheetCell[][] {
  return [
    ["", "DATE", "CREDIT", "DEBIT", "$9,000.00", "NOTES", "DAY", "", "YEAR", "2026", "MONTH", "9"],
    ["Weekly Spend", "01-Sep-26", "$200.00", "", "$8,800.00", "AD", "1"],
    ["END OF WEEK", "04-Sep-26", "", "", "$8,800.00", "0.00", "4"],
    ["Weekly Spend", "05-Sep-26", "$350.00", "", "$8,450.00", "AD", "5"],
    ["END OF WEEK", "11-Sep-26", "", "", "$8,450.00", "0.00", "11"],
    ["Weekly Spend", "12-Sep-26", "$950.00", "", "$7,500.00", "AD", "12"],
    ["Stewart Pay", "17-Sep-26", "", "$2,000.00", "$9,500.00", "AD", "17"],
    ["END OF MONTH", "30-Sep-26", "", "", "$10,000.00", "500.00", "30"],
  ];
}
