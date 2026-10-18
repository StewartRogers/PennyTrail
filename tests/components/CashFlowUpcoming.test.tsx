/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CashFlowUpcoming } from "@/components/cashflow/CashFlowUpcoming";
import { ToastProvider } from "@/components/ToastContext";
import { updateCashFlowEntry } from "@/lib/api";
import type { CashFlowEntry, CashFlowMonth } from "@/lib/types";
import { makeAppState } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({ updateCashFlowEntry: vi.fn().mockResolvedValue({}) }));

const month: CashFlowMonth = { id: "m_oct", accountId: "acct", month: "2026-10", openingBalance: 0, openingSource: "manual", dailySpendRate: 50, periods: [{ id: "p", endDate: "2026-10-31", label: "End of month" }], closed: false };
const e = (o: Partial<CashFlowEntry>): CashFlowEntry => ({ id: o.name!, monthId: "m_oct", itemId: null, name: "", kind: "bill", dueDate: "2026-10-01", postingDate: "2026-10-01", expectedAmount: 100, status: "planned", ...o });

const entries = [
  e({ name: "Overdue bill", postingDate: "2026-10-15" }),
  e({ name: "AMEX", postingDate: "2026-10-19" }),
  e({ name: "Hydro", postingDate: "2026-10-23", status: "scheduled", confirmationCode: "136266" }),
  e({ name: "Kerri Pay", kind: "deposit", postingDate: "2026-10-30", settlement: "auto" }),
  e({ name: "Far off", postingDate: "2026-11-20" }),
  e({ name: "Done", postingDate: "2026-10-20", status: "posted" }),
  e({ name: "Other account", monthId: "elsewhere", postingDate: "2026-10-20" }),
];

function renderUpcoming() {
  render(
    <ToastProvider>
      <CashFlowUpcoming appState={makeAppState({ cashFlowMonths: [month], cashFlowEntries: entries })} onReload={vi.fn().mockResolvedValue(undefined)} accountId="acct" onOpenMonth={vi.fn()} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
});

afterEach(() => vi.useRealTimers());

describe("CashFlowUpcoming", () => {
  it("groups outstanding entries within the horizon", () => {
    renderUpcoming();
    expect(screen.getByText("Overdue · 1")).toBeInTheDocument();
    expect(screen.getByText("Needs scheduling · 1")).toBeInTheDocument();
    expect(screen.getByText("Scheduled, waiting to post · 1")).toBeInTheDocument();
    expect(screen.getByText("Expected · 1")).toBeInTheDocument();
    expect(screen.queryByText("Far off")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Other account")).not.toBeInTheDocument();
  });

  it("widens the horizon", () => {
    renderUpcoming();
    fireEvent.click(screen.getByRole("button", { name: "31 days" }));
    expect(screen.getByText("Needs scheduling · 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.queryByText("Expected · 1")).not.toBeInTheDocument();
  });

  it("schedules a bill with its confirmation number", async () => {
    renderUpcoming();
    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" })[1]);
    fireEvent.change(screen.getByLabelText("Confirmation number for AMEX"), { target: { value: "136258" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("AMEX", { status: "scheduled", scheduledDate: "2026-10-18", confirmationCode: "136258" }));
  });

  it("marks an entry posted with the date and amount", async () => {
    renderUpcoming();
    fireEvent.click(screen.getAllByRole("button", { name: "Mark posted" })[0]);
    fireEvent.change(screen.getByLabelText("Posted amount for Overdue bill"), { target: { value: "101.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCashFlowEntry).toHaveBeenCalledWith("Overdue bill", { status: "posted", postedDate: "2026-10-18", actualAmount: 101.25 }));
  });
});
