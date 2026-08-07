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
//   trend window (12 mths) 2025-05 .. 2026-05  (June 2026 is in progress, so excluded)
//   avg-by-category window 2025-12 .. 2026-05
const IN_TREND_BEFORE_CUTOFF = "2025-06-10"; // inside the trend window, before the KPI cutoff
const CURRENT_MONTH = "2026-06-10"; // inside the KPI range, outside the trend window

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
      makeTransaction({ id: "t8", cardId: "card_a", date: IN_TREND_BEFORE_CUTOFF, type: "purchase", amount: 777, childVendorId: "c_costco" }),
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

  it("averages spend over the months that actually have purchases", () => {
    renderDashboard();

    // Purchases fall in 2026-03, 2026-04 and 2026-06 => 1189 / 3.
    expect(kpi("Avg Monthly Spend")).toBe("$396.33");
  });

  it("shows zeroes rather than NaN when there are no transactions", () => {
    renderDashboard(makeAppState({ cards: [], categories: [], transactions: [] }));

    expect(kpi("Total Spend")).toBe("$0.00");
    expect(kpi("Avg Monthly Spend")).toBe("$0.00");
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
  it("excludes the current, still-in-progress month", () => {
    renderDashboard();

    expect(screen.getByText("May 26")).toBeInTheDocument();
    // June 2026 is in progress; showing it would render a misleadingly short bar.
    expect(screen.queryByText("Jun 26")).toBeNull();
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
    renderDashboard();

    // t8 is before the 12-month KPI cutoff but inside the trend window.
    expect(screen.getByText("$777")).toBeInTheDocument();
    expect(kpi("Total Spend")).toBe("$1,189.00");

    fireEvent.click(screen.getByRole("button", { name: "6mo" }));

    expect(screen.getByText("$777")).toBeInTheDocument();
  });

  it("regroups into quarters on demand", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Quarter" }));

    // Trailing 8 complete quarters ending at Q1 2026; Q2 2026 is in progress.
    expect(screen.getByText("2026-Q1")).toBeInTheDocument();
    expect(screen.queryByText("2026-Q2")).toBeNull();
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

  it("averages a second category independently", () => {
    renderDashboard();

    // Dining: t3 (60) over 6 months => $10.00/mo.
    expect(within(panel("Avg Monthly Spend by Category")).getByText("$10.00")).toBeInTheDocument();
  });
});
