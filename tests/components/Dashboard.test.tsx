/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dashboard } from "@/components/Dashboard";
import type { AppState } from "@/lib/types";
import { makeAppState, makeCard, makeCategory, makeChildVendor, makeParentVendor, makeTransaction } from "../helpers/fixtures";

// Every aggregate on this screen is relative to "now" — the trend window is a
// trailing 12 complete months, the range presets are month offsets, and the
// avg-by-category table is the trailing 6 complete months. Freezing the clock
// is what makes any of it assertable. Only Date is faked so React Testing
// Library's own timer use is untouched.
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15, mid-June

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Derived from NOW:
//   12mo KPI cutoff        2025-07-01
//   trend window (12 bars) 2025-07 .. 2026-05 full months, plus 2026-06 "to date"
//   avg-by-category window 2025-12 .. 2026-05 (never before the first month with data)
//   avg-monthly KPI window range start (or first data month) .. 2026-05
const BEFORE_CUTOFF = "2025-06-10"; // before both the KPI cutoff and the trend window
const CURRENT_MONTH = "2026-06-10"; // inside the KPI range; the trend's partial "to date" bar

function buildState(): AppState {
  return makeAppState({
    cards: [makeCard({ id: "card_a", name: "Card A" }), makeCard({ id: "card_b", name: "Card B" })],
    categories: [
      makeCategory({ id: "cat_groceries", name: "Groceries", color: "#0a0" }),
      makeCategory({ id: "cat_dining", name: "Dining", color: "#a00" }),
      makeCategory({ id: "cat_reimb", name: "Reimbursable", color: "#00a", excludeFromDashboard: true }),
    ],
    parentVendors: [
      makeParentVendor({ id: "p_costco", name: "Costco", category: "cat_groceries" }),
      makeParentVendor({ id: "p_cafe", name: "Cafe", category: "cat_dining" }),
      makeParentVendor({ id: "p_work", name: "WorkExpense", category: "cat_reimb" }),
    ],
    childVendors: [
      makeChildVendor({ id: "c_costco", parentId: "p_costco", rawName: "Costco Wholesale" }),
      makeChildVendor({ id: "c_cafe", parentId: "p_cafe", rawName: "Cafe Downtown" }),
      makeChildVendor({ id: "c_work", parentId: "p_work", rawName: "Work Travel" }),
    ],
    transactions: [
      makeTransaction({ id: "t1", cardId: "card_a", date: "2026-03-05", type: "purchase", amount: 100, childVendorId: "c_costco" }),
      // Partly reimbursed: only the $30 that wasn't recovered should count.
      makeTransaction({ id: "t2", cardId: "card_a", date: "2026-04-10", type: "purchase", amount: 50, reimbursedAmount: 20, childVendorId: "c_costco" }),
      makeTransaction({ id: "t3", cardId: "card_b", date: "2026-04-15", type: "purchase", amount: 60, childVendorId: "c_cafe" }),
      makeTransaction({ id: "t4", cardId: "card_a", date: "2026-05-20", type: "payment", amount: 500, childVendorId: null }),
      makeTransaction({ id: "t5", cardId: "card_a", date: "2026-05-21", type: "cashback", amount: 25, childVendorId: null }),
      // Dashboard-excluded category.
      makeTransaction({ id: "t6", cardId: "card_a", date: "2026-05-22", type: "purchase", amount: 200, childVendorId: "c_work" }),
      makeTransaction({ id: "t7", cardId: "card_a", date: CURRENT_MONTH, type: "purchase", amount: 999, childVendorId: "c_costco" }),
      makeTransaction({ id: "t8", cardId: "card_a", date: BEFORE_CUTOFF, type: "purchase", amount: 777, childVendorId: "c_costco" }),
    ],
  });
}

function renderDashboard(state: AppState = buildState(), onDrillDown = vi.fn()) {
  render(<Dashboard appState={state} onDrillDown={onDrillDown} />);
  return { onDrillDown };
}

// The KPI value sits in the element immediately after its label.
function kpi(label: string): string {
  return screen.getByText(label).nextElementSibling!.textContent!.trim();
}

// The same figure legitimately appears in several panels at once — Groceries'
// breakdown total and Costco's top-merchant total are both $1,129.00 here — so
// assertions have to be scoped to the panel under test. Panels are the
// rounded Card wrappers; climb from the section heading to find one.
function panel(sectionTitle: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(sectionTitle);
  while (el && el.style?.borderRadius !== "12px") el = el.parentElement;
  if (!el) throw new Error(`Could not find the panel containing "${sectionTitle}"`);
  return el;
}

describe("Dashboard KPIs", () => {
  it("sums only purchases into Total Spend, net of reimbursements", () => {
    renderDashboard();

    // t1 100 + t2 (50 - 20) + t3 60 + t7 999 = 1189. The payment, the
    // cashback, the excluded-category purchase and the pre-cutoff purchase
    // are all correctly absent.
    expect(kpi("Total Spend")).toBe("$1,189.00");
  });

  it("reports cashback separately from spend", () => {
    renderDashboard();

    expect(kpi("Net Cashback Earned")).toBe("$25.00");
  });

  // Spend in an excluded category still gets paid off on the card, so leaving
  // it in Payments would make the two KPIs incomparable.
  it("nets dashboard-excluded spend back out of Total Payments", () => {
    renderDashboard();

    // 500 paid - 200 of excluded (Reimbursable) spend.
    expect(kpi("Total Payments")).toBe("$300.00");
  });

  it("floors Total Payments at zero rather than going negative", () => {
    const state = buildState();
    state.transactions = [
      makeTransaction({ id: "p", cardId: "card_a", date: "2026-05-01", type: "payment", amount: 100, childVendorId: null }),
      makeTransaction({ id: "e", cardId: "card_a", date: "2026-05-02", type: "purchase", amount: 300, childVendorId: "c_work" }),
    ];
    renderDashboard(state);

    expect(kpi("Total Payments")).toBe("$0.00");
  });

  it("averages over full months only, from the start of the range", () => {
    renderDashboard();

    // 12mo range starts 2025-07; the last full month is 2026-05 => 11 months.
    // Full-month spend is t1 100 + t2 30 + t3 60 = 190 (t7, this month's
    // $999, waits until June is over) => 190 / 11.
    expect(kpi("Avg Monthly Spend")).toBe("$17.27");
  });

  it("starts the average at the first month with history, not the range start", () => {
    renderDashboard();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "card_b" } });

    // Card B's history begins 2026-04 (t3), so its average covers April and
    // May only: 60 / 2 — not 60 / 11 with nine never-imported months as $0.
    expect(kpi("Avg Monthly Spend")).toBe("$30.00");
  });

  it("shows a dash for the average until there is a full month of history", () => {
    const state = buildState();
    state.transactions = [
      makeTransaction({ id: "n", cardId: "card_a", date: CURRENT_MONTH, type: "purchase", amount: 80, childVendorId: "c_costco" }),
    ];
    renderDashboard(state);

    expect(kpi("Total Spend")).toBe("$80.00");
    expect(kpi("Avg Monthly Spend")).toBe("—");
  });

  it("shows zeroes rather than NaN when there are no transactions", () => {
    renderDashboard(makeAppState({ cards: [], categories: [], transactions: [] }));

    expect(kpi("Total Spend")).toBe("$0.00");
    expect(kpi("Avg Monthly Spend")).toBe("—");
  });
});

describe("Dashboard refunds", () => {
  // A merchant refund resolves to the same vendor as the purchase it reverses.
  function withRefund(): AppState {
    const state = buildState();
    state.transactions.push(
      makeTransaction({ id: "r1", cardId: "card_a", date: "2026-04-12", type: "credit", amount: 40, childVendorId: "c_costco" })
    );
    return state;
  }

  it("subtracts refunds from Total Spend", () => {
    renderDashboard(withRefund());

    // 1189 - 40.
    expect(kpi("Total Spend")).toBe("$1,149.00");
  });

  it("nets refunds in the breakdown, the trend, and the card totals", () => {
    renderDashboard(withRefund());

    // Groceries / Costco / Card A: 1129 - 40 = 1089.
    expect(within(panel("Breakdown")).getByText("$1,089.00")).toBeInTheDocument();
    expect(within(panel("Top Merchants")).getByText("$1,089.00")).toBeInTheDocument();
    expect(within(panel("Spending by Card")).getByText("$1,089.00")).toBeInTheDocument();
    // April: t2 net 30 + t3 60 - 40 = 50.
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("lists the refund in the drill-down and counts it separately", () => {
    const { onDrillDown } = renderDashboard(withRefund());

    fireEvent.click(within(panel("Breakdown")).getByText("Groceries"));

    const arg = onDrillDown.mock.calls[0][0];
    expect(arg.subtitle).toBe("3 purchases, 1 refund");
    expect(arg.transactions.map((t: { id: string }) => t.id).sort()).toEqual(["r1", "t1", "t2", "t7"]);
  });

  it("leaves cashback out of spend, since it has its own KPI", () => {
    renderDashboard(withRefund());

    expect(kpi("Net Cashback Earned")).toBe("$25.00");
    expect(kpi("Total Spend")).toBe("$1,149.00");
  });
});

describe("Dashboard filters", () => {
  it("narrows every aggregate to the selected card", () => {
    renderDashboard();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "card_b" } });

    // Card B holds only t3.
    expect(kpi("Total Spend")).toBe("$60.00");
    expect(kpi("Total Payments")).toBe("$0.00");
  });

  it("widens the range when All is selected, pulling in pre-cutoff transactions", () => {
    renderDashboard();
    expect(kpi("Total Spend")).toBe("$1,189.00");

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    // t8 ($777, before the 12-month cutoff) now counts.
    expect(kpi("Total Spend")).toBe("$1,966.00");
  });

  it("keeps excluded categories out even at All-time range", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(screen.queryByText("Reimbursable")).toBeNull();
    expect(screen.queryByText("WorkExpense")).toBeNull();
  });
});

describe("Dashboard spending trend", () => {
  it("shows the current month as a partial, to-date bar after the full months", () => {
    renderDashboard();

    expect(screen.getByText("May 26")).toBeInTheDocument();
    expect(screen.getByText("Jun 26")).toBeInTheDocument();
    expect(screen.getAllByText("to date")).toHaveLength(1);
    expect(screen.getByText("$999")).toBeInTheDocument(); // t7, June so far
    // Still 12 bars: 11 full months back to Jul 2025, so Jun 2025 is out.
    expect(screen.getByText("Jul 25")).toBeInTheDocument();
    expect(screen.queryByText("Jun 25")).toBeNull();
  });

  it("titles the partial bar's drill-down as to date", () => {
    const { onDrillDown } = renderDashboard();

    fireEvent.click(screen.getByText("Jun 26").previousElementSibling!);

    const arg = onDrillDown.mock.calls[0][0];
    expect(arg.title).toBe("Jun 26 (to date)");
    expect(arg.transactions.map((t: { id: string }) => t.id)).toEqual(["t7"]);
  });

  it("zero-fills months that have no transactions", () => {
    renderDashboard();

    // Nothing happened in May 2026, but the bar is still drawn at $0.
    expect(screen.getByText("May 26")).toBeInTheDocument();
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
  });

  it("totals each bucket net of reimbursements", () => {
    renderDashboard();

    expect(screen.getByText("$100")).toBeInTheDocument(); // 2026-03: t1
    expect(screen.getByText("$90")).toBeInTheDocument(); // 2026-04: t2 net 30 + t3 60
  });

  // The trend is a fixed trailing calendar window; only the card filter
  // narrows it, so changing the range preset must not move it.
  it("ignores the range preset", () => {
    const state = buildState();
    // Inside the trend window, but before the 6mo KPI cutoff (2026-01-01).
    state.transactions.push(
      makeTransaction({ id: "t9", cardId: "card_a", date: "2025-09-10", type: "purchase", amount: 555, childVendorId: "c_costco" })
    );
    renderDashboard(state);
    expect(screen.getByText("$555")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "6mo" }));

    expect(kpi("Total Spend")).toBe("$1,189.00"); // t9 is out of the KPIs...
    expect(screen.getByText("$555")).toBeInTheDocument(); // ...but not the trend
  });

  it("regroups into quarters on demand, with the current quarter to date", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Quarter" }));

    // Seven complete quarters ending at Q1 2026, then Q2 2026 so far.
    expect(screen.getByText("2026-Q1")).toBeInTheDocument();
    expect(screen.getByText("2026-Q2")).toBeInTheDocument();
    expect(screen.getAllByText("to date")).toHaveLength(1);
  });
});

describe("Dashboard breakdown", () => {
  it("ranks categories by spend, netting reimbursements", () => {
    renderDashboard();
    const breakdown = within(panel("Breakdown"));

    // Groceries = 100 + 30 + 999 = 1129; Dining = 60.
    expect(breakdown.getByText("Groceries")).toBeInTheDocument();
    expect(breakdown.getByText("$1,129.00")).toBeInTheDocument();
    expect(breakdown.getByText("Dining")).toBeInTheDocument();
    expect(breakdown.getByText("$60.00")).toBeInTheDocument();
  });

  it("switches to per-vendor totals", () => {
    renderDashboard();
    expect(within(panel("Breakdown")).queryByText("Costco")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vendor" }));

    const breakdown = within(panel("Breakdown"));
    expect(breakdown.getByText("Costco")).toBeInTheDocument();
    expect(breakdown.getByText("Cafe")).toBeInTheDocument();
    expect(breakdown.queryByText("Groceries")).toBeNull();
  });

  it("shows an empty state when nothing matches", () => {
    renderDashboard(makeAppState({ cards: [], categories: [], transactions: [] }));

    expect(screen.getAllByText("No data yet.").length).toBeGreaterThan(0);
  });

  it("passes the matching purchases to the drill-down handler", () => {
    const { onDrillDown } = renderDashboard();

    fireEvent.click(within(panel("Breakdown")).getByText("Groceries"));

    expect(onDrillDown).toHaveBeenCalledTimes(1);
    const arg = onDrillDown.mock.calls[0][0];
    expect(arg.title).toBe("Groceries");
    expect(arg.subtitle).toBe("3 purchases");
    expect(arg.transactions.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t2", "t7"]);
    expect(arg.viewAllFilter).toEqual({ categoryFilter: "cat_groceries" });
  });
});

describe("Dashboard top merchants", () => {
  it("ranks parent vendors by spend and counts their transactions", () => {
    renderDashboard();

    const merchants = within(panel("Top Merchants"));
    expect(merchants.getByText("Costco")).toBeInTheDocument();
    expect(merchants.getByText("Groceries · 3 txns")).toBeInTheDocument();
    expect(merchants.getByText("Dining · 1 txns")).toBeInTheDocument();
    expect(merchants.getByText("$1,129.00")).toBeInTheDocument();
  });

  it("omits vendors in dashboard-excluded categories", () => {
    renderDashboard();

    expect(screen.queryByText("WorkExpense")).toBeNull();
  });
});

describe("Dashboard spending by card", () => {
  it("ranks cards by spend and counts their transactions", () => {
    renderDashboard();

    const cards = within(panel("Spending by Card"));
    // Card A: t1 (100) + t2 (net 30) + t7 (999) = 1129, over 3 purchases.
    expect(cards.getByText("Card A")).toBeInTheDocument();
    expect(cards.getByText("Test Bank · 3 txns")).toBeInTheDocument();
    expect(cards.getByText("$1,129.00")).toBeInTheDocument();
    // Card B: t3 (60) only.
    expect(cards.getByText("Card B")).toBeInTheDocument();
    expect(cards.getByText("Test Bank · 1 txns")).toBeInTheDocument();
    expect(cards.getByText("$60.00")).toBeInTheDocument();
  });

  it("respects the same 12mo/All-cards filters as the rest of the page", () => {
    renderDashboard();

    // t8 ($777, card_a) is before the default 12mo cutoff — same reasoning
    // as the KPI and trend tests above.
    expect(within(panel("Spending by Card")).queryByText("$1,906.00")).toBeNull(); // 1129 + 777

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(within(panel("Spending by Card")).getByText("$1,906.00")).toBeInTheDocument();
  });

  it("passes the matching purchases to the drill-down handler", () => {
    const { onDrillDown } = renderDashboard();

    fireEvent.click(within(panel("Spending by Card")).getByText("Card A"));

    expect(onDrillDown).toHaveBeenCalledTimes(1);
    const arg = onDrillDown.mock.calls[0][0];
    expect(arg.title).toBe("Card A");
    expect(arg.subtitle).toBe("3 purchases");
    expect(arg.transactions.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t2", "t7"]);
    expect(arg.viewAllFilter).toEqual({ cardFilter: "card_a" });
  });
});

describe("Dashboard transaction-level exclusion", () => {
  function buildExclusionState(): AppState {
    return makeAppState({
      cards: [makeCard({ id: "card_a", name: "Card A" })],
      categories: [makeCategory({ id: "cat_groceries", name: "Groceries", color: "#0a0" })],
      parentVendors: [makeParentVendor({ id: "p_costco", name: "Costco", category: "cat_groceries" })],
      childVendors: [makeChildVendor({ id: "c_costco", parentId: "p_costco", rawName: "Costco Wholesale" })],
      transactions: [
        makeTransaction({ id: "normal", cardId: "card_a", date: "2026-04-10", type: "purchase", amount: 50, childVendorId: "c_costco" }),
        // A one-off outlier from the same vendor, excluded individually —
        // the other Costco purchase above must still count.
        makeTransaction({
          id: "outlier",
          cardId: "card_a",
          date: "2026-04-15",
          type: "purchase",
          amount: 5000,
          childVendorId: "c_costco",
          excludeFromDashboard: true,
        }),
        makeTransaction({ id: "pmt", cardId: "card_a", date: "2026-05-01", type: "payment", amount: 5050, childVendorId: null }),
      ],
    });
  }

  it("drops a flagged transaction from Total Spend without hiding its vendor's other purchases", () => {
    renderDashboard(buildExclusionState());

    expect(kpi("Total Spend")).toBe("$50.00");
    expect(within(panel("Breakdown")).getByText("Groceries")).toBeInTheDocument();
    expect(within(panel("Breakdown")).getByText("$50.00")).toBeInTheDocument();
  });

  it("nets the excluded transaction's spend back out of Total Payments", () => {
    renderDashboard(buildExclusionState());

    // 5050 paid - 5000 of individually-excluded spend = 50.
    expect(kpi("Total Payments")).toBe("$50.00");
  });
});

describe("Dashboard avg monthly spend by category", () => {
  // The documented reason this divides by a fixed 6: a category with spend in
  // only two of the last six months averages over all six, not over the two.
  it("divides by six full months, not by the months that had spend", () => {
    renderDashboard();

    const table = within(panel("Avg Monthly Spend by Category"));
    // Groceries inside the 6-month window is t1 (100) + t2 (net 30) = 130,
    // spread over 6 months => 21.67/mo, NOT 65/mo.
    expect(table.getByText("$21.67")).toBeInTheDocument();
    expect(table.getByText("$130.00")).toBeInTheDocument();
    expect(table.queryByText("$65.00")).toBeNull();
  });

  it("excludes transactions outside the trailing six full months", () => {
    renderDashboard();
    const table = within(panel("Avg Monthly Spend by Category"));

    // t7 (current month, $999) and t8 (2025-06, $777) both fall outside the
    // window, so neither inflates the six-month totals.
    expect(table.queryByText("$906.00")).toBeNull(); // 130 + 777
    expect(table.queryByText("$1,129.00")).toBeNull(); // 130 + 999
    expect(table.getByText("$130.00")).toBeInTheDocument();
    // ...while the breakdown, which is not windowed to 6 months, still has it.
    expect(within(panel("Breakdown")).getByText("$1,129.00")).toBeInTheDocument();
  });

  it("averages each card over the months its own history covers", () => {
    renderDashboard();

    const table = within(panel("Avg Monthly Spend by Category"));
    // Dining is all Card B (t3, 60), whose history starts 2026-04: 60 over
    // April and May => $30.00/mo, not 60 / 6 — even with All Cards, where
    // Card A's history fills the whole window.
    expect(table.getByText("$30.00")).toBeInTheDocument();
    expect(table.queryByText("$10.00")).toBeNull();
    expect(table.getByText("Averaged from first transaction: Card B from Apr 26")).toBeInTheDocument();
  });

  // A card imported only recently shouldn't have its averages divided by
  // months that were simply never imported.
  it("shortens the window to the months since the history starts", () => {
    renderDashboard();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "card_b" } });

    const table = within(panel("Avg Monthly Spend by Category"));
    // Card B starts 2026-04: Dining 60 over April and May => $30.00/mo.
    expect(table.getByText("Last 2 full months")).toBeInTheDocument();
    expect(table.getByText("Total (2mo)")).toBeInTheDocument();
    expect(table.getByText("$30.00")).toBeInTheDocument();
  });
});
