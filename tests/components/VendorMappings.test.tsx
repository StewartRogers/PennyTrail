/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VendorMappings } from "@/components/VendorMappings";
import { ToastProvider } from "@/components/ToastContext";
import { addParentVendor } from "@/lib/api";
import type { AppState } from "@/lib/types";
import { makeAppState, makeCategory, makeChildVendor, makeParentVendor } from "../helpers/fixtures";

vi.mock("@/lib/api", () => ({
  addParentVendor: vi.fn(),
  deleteChildVendor: vi.fn(),
  deleteParentVendor: vi.fn(),
  mergeParentVendors: vi.fn(),
  moveChildVendor: vi.fn(),
  updateParentVendor: vi.fn(),
}));

function renderVendorMappings(
  appState: AppState,
  onReload = vi.fn().mockResolvedValue(undefined),
  onNavigateToTransactions = vi.fn()
) {
  return render(
    <ToastProvider>
      <VendorMappings appState={appState} onReload={onReload} onNavigateToTransactions={onNavigateToTransactions} />
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

  it("shows a fallback label for a vendor with no raw description, instead of a blank row", () => {
    const category = makeCategory();
    const parent = makeParentVendor({ id: "parent_0", name: "Parent 0", category: category.id });
    const blankChild = makeChildVendor({ id: "child_blank", parentId: "parent_0", rawName: "" });
    const appState = makeAppState({ categories: [category], parentVendors: [parent], childVendors: [blankChild] });

    renderVendorMappings(appState);
    fireEvent.click(screen.getByText("Vendors"));

    expect(screen.getByText("(no description)")).toBeInTheDocument();
  });
});

describe("VendorMappings row navigation", () => {
  it("clicking a parent row jumps to that parent's transactions", () => {
    const category = makeCategory();
    const parent = makeParentVendor({ id: "parent_0", name: "Parent 0", category: category.id });
    const child = makeChildVendor({ id: "child_0", parentId: "parent_0", rawName: "Vendor 0" });
    const appState = makeAppState({ categories: [category], parentVendors: [parent], childVendors: [child] });
    const onNavigateToTransactions = vi.fn();

    renderVendorMappings(appState, undefined, onNavigateToTransactions);
    fireEvent.click(screen.getByTitle("View this vendor's transactions"));

    expect(onNavigateToTransactions).toHaveBeenCalledWith({ vendorFilter: "parent_0" });
  });

  it("clicking a vendor row jumps to that vendor's transactions, even with a blank raw name", () => {
    const category = makeCategory();
    const parent = makeParentVendor({ id: "parent_0", name: "Parent 0", category: category.id });
    const blankChild = makeChildVendor({ id: "child_blank", parentId: "parent_0", rawName: "" });
    const appState = makeAppState({ categories: [category], parentVendors: [parent], childVendors: [blankChild] });
    const onNavigateToTransactions = vi.fn();

    renderVendorMappings(appState, undefined, onNavigateToTransactions);
    fireEvent.click(screen.getByText("Vendors"));
    fireEvent.click(screen.getByTitle("View this vendor's transactions"));

    expect(onNavigateToTransactions).toHaveBeenCalledWith({ childVendorFilter: "child_blank" });
  });

  it("clicking a parent row's inline controls does not also trigger navigation", () => {
    const category = makeCategory();
    const parent = makeParentVendor({ id: "parent_0", name: "Parent 0", category: category.id });
    const child = makeChildVendor({ id: "child_0", parentId: "parent_0", rawName: "Vendor 0" });
    const appState = makeAppState({ categories: [category], parentVendors: [parent], childVendors: [child] });
    const onNavigateToTransactions = vi.fn();

    renderVendorMappings(appState, undefined, onNavigateToTransactions);
    fireEvent.click(screen.getByDisplayValue("Parent 0")); // the inline rename input
    fireEvent.click(screen.getAllByRole("combobox")[0]); // the row's category select, not the "+ Add a parent" one

    expect(onNavigateToTransactions).not.toHaveBeenCalled();
  });
});

describe("VendorMappings add parent", () => {
  it("disables Add until both a name and a category are chosen", () => {
    const category = makeCategory();
    const appState = makeAppState({ categories: [category], parentVendors: [], childVendors: [] });

    renderVendorMappings(appState);

    expect(screen.getByText("Add").closest("button")).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Parent name"), { target: { value: "New Grouping" } });
    expect(screen.getByText("Add").closest("button")).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("— Choose a category —"), { target: { value: category.id } });
    expect(screen.getByText("Add").closest("button")).not.toBeDisabled();
  });

  it("creates a standalone parent with the entered name and category, then reloads", async () => {
    const category = makeCategory({ id: "cat_1", name: "Groceries" });
    const appState = makeAppState({ categories: [category], parentVendors: [], childVendors: [] });
    const onReload = vi.fn().mockResolvedValue(undefined);
    vi.mocked(addParentVendor).mockResolvedValue({ id: "vnd_new", name: "New Grouping", category: "cat_1" });

    renderVendorMappings(appState, onReload);

    fireEvent.change(screen.getByPlaceholderText("Parent name"), { target: { value: "New Grouping" } });
    fireEvent.change(screen.getByDisplayValue("— Choose a category —"), { target: { value: "cat_1" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(addParentVendor).toHaveBeenCalledWith({ name: "New Grouping", category: "cat_1" }));
    expect(onReload).toHaveBeenCalled();
  });

  it("shows a toast instead of an unhandled rejection when the name is already taken", async () => {
    const category = makeCategory({ id: "cat_1" });
    const appState = makeAppState({ categories: [category], parentVendors: [], childVendors: [] });
    vi.mocked(addParentVendor).mockRejectedValue(new Error("A parent with this name already exists"));

    renderVendorMappings(appState);

    fireEvent.change(screen.getByPlaceholderText("Parent name"), { target: { value: "Costco" } });
    fireEvent.change(screen.getByDisplayValue("— Choose a category —"), { target: { value: "cat_1" } });
    fireEvent.click(screen.getByText("Add"));

    expect(await screen.findByText("A parent with this name already exists")).toBeInTheDocument();
  });
});
