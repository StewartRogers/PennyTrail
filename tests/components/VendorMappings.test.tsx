/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VendorMappings } from "@/components/VendorMappings";
import { ToastProvider } from "@/components/ToastContext";
import type { AppState } from "@/lib/types";
import { makeAppState, makeCategory, makeChildVendor, makeParentVendor } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  deleteChildVendor: vi.fn(),
  deleteParentVendor: vi.fn(),
  mergeParentVendors: vi.fn(),
  moveChildVendor: vi.fn(),
  updateParentVendor: vi.fn(),
}));

function renderVendorMappings(appState: AppState, onReload = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <ToastProvider>
      <VendorMappings appState={appState} onReload={onReload} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VendorMappings Vendors tab", () => {
  it("does not mount a full parent-option dropdown for every row by default", () => {
    const category = makeCategory();
    const parents = Array.from({ length: 20 }, (_, i) => makeParentVendor({ id: `parent_${i}`, name: `Parent ${i}`, category: category.id }));
    const children = Array.from({ length: 10 }, (_, i) => makeChildVendor({ id: `child_${i}`, parentId: `parent_${i}`, rawName: `Vendor ${i}` }));
    const appState = makeAppState({ categories: [category], parentVendors: parents, childVendors: children });

    renderVendorMappings(appState);
    fireEvent.click(screen.getByText("Vendors"));

    // Regression test: this used to render a <select> with every parent as
    // an <option> on every single row (n rows x m parents DOM nodes). Until
    // a row's "change vendor" control is actually clicked, none of those
    // option elements should exist at all.
    expect(screen.queryAllByRole("option").length).toBe(0);
    // But the row buttons showing each vendor's current parent should be
    // there, proving the rows themselves rendered fine.
    expect(screen.getByText("Parent 0")).toBeInTheDocument();
  });

  it("reveals the parent picker only for the row being changed", () => {
    const category = makeCategory();
    const parents = [makeParentVendor({ id: "parent_0", name: "Parent 0", category: category.id }), makeParentVendor({ id: "parent_1", name: "Parent 1", category: category.id })];
    const children = [makeChildVendor({ id: "child_0", parentId: "parent_0", rawName: "Vendor 0" })];
    const appState = makeAppState({ categories: [category], parentVendors: parents, childVendors: children });

    renderVendorMappings(appState);
    fireEvent.click(screen.getByText("Vendors"));

    fireEvent.click(screen.getByText("Parent 0"));

    // Now exactly one row's <select> exists, with all parents as options.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Parent 1" })).toBeInTheDocument();
  });
});
