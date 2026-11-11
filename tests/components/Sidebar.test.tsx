/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";

function renderSidebar(workspace: "cards" | "cashflow", overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = { workspace, onWorkspaceChange: vi.fn(), screen: workspace === "cards" ? "dashboard" : "cf-month", onNavigate: vi.fn(), badges: {}, footer: "footer", ...overrides } as Parameters<typeof Sidebar>[0];
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("shows the Credit Card screens and the shared ones", () => {
    renderSidebar("cards");
    for (const label of ["Dashboard", "Averages", "Import CSV", "Transactions", "Cards", "Import Templates", "Categories", "Vendor Mappings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "This Month" })).not.toBeInTheDocument();
  });

  it("shows the Cash Flow screens and the shared ones", () => {
    renderSidebar("cashflow");
    for (const label of ["This Month", "Bank Transactions", "Import Bank CSV", "Recurring Items", "Accounts", "Categories", "Vendor Mappings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const removed of ["Upcoming", "Spending", "History", "Dashboard"]) {
      expect(screen.queryByRole("button", { name: removed })).not.toBeInTheDocument();
    }
  });

  it("switches workspace", () => {
    const props = renderSidebar("cards");
    expect(screen.getByRole("tab", { name: "Credit Cards" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(props.onWorkspaceChange).toHaveBeenCalledWith("cashflow");
  });

  it("shows badges", () => {
    renderSidebar("cashflow", { badges: { "cf-bank": 3, "cf-items": 0 } });
    expect(screen.getByRole("button", { name: /^Bank Transactions\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recurring Items" })).toBeInTheDocument();
  });

  it("navigates", () => {
    const props = renderSidebar("cashflow");
    fireEvent.click(screen.getByRole("button", { name: "Recurring Items" }));
    expect(props.onNavigate).toHaveBeenCalledWith("cf-items");
  });
});
