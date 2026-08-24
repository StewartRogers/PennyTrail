"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { AppState, AmountConvention, AmountMode, Category, Network, TxnType } from "@/lib/types";
import { parseCSV, guessMapping, parseAmount, parseDateFlexible } from "@/lib/csv";
import { classifyTransactionType, cleanVendorName, resolveVendor } from "@/lib/classify";
import { addTemplate, fetchState, importTransactions, updateCard, updateTransaction, type DuplicateRow, type ImportRow } from "@/lib/api";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { TYPE_META, sortCategoriesByName } from "@/lib/categories";
import { PrimaryButton, SecondaryButton, Pill, inputStyle, labelStyle } from "./ui";
import { useToast } from "./ToastContext";
import type { Transaction } from "@/lib/types";

type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "Month DD, YYYY" | "YYYYMMDD";

interface Mapping {
  dateCol: number;
  descCol: number;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  amountCol: number;
  amountConvention: AmountConvention;
  debitCol: number;
  creditCol: number;
  // Optional — leave at -1 to let PennyTrail derive vendor/category/type itself.
  vendorCol: number;
  categoryCol: number;
  typeCol: number;
}

const BLANK_MAPPING: Mapping = {
  dateCol: -1,
  descCol: -1,
  dateFormat: "MM/DD/YYYY",
  amountMode: "single",
  amountCol: -1,
  amountConvention: "positive_is_purchase",
  debitCol: -1,
  creditCol: -1,
  vendorCol: -1,
  categoryCol: -1,
  typeCol: -1,
};

interface ParsedRow {
  date: string | null;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
  vendorOverride?: string;
  categoryText?: string;
  typeText?: string;
}

interface RowPreview {
  type: TxnType;
  vendorName: string;
  categoryName: string | null;
  needsReview: boolean;
}

const STEP_LABELS = ["1 · Card", "2 · Upload & Map", "3 · Confirm", "4 · Review", "5 · Done"];

// Case/whitespace-insensitive so "Date" vs "date" across two exports of the
// same statement layout isn't treated as a real mismatch.
function sameHeaders(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h.trim().toLowerCase() === (b[i] || "").trim().toLowerCase());
}

function computeRows(dataRows: string[][], mapping: Mapping): ParsedRow[] {
  return dataRows.map((row) => {
    const date = parseDateFlexible(row[mapping.dateCol], mapping.dateFormat);
    const vendorOverride = mapping.vendorCol > -1 ? row[mapping.vendorCol] : undefined;
    // Some banks leave the mapped Description blank on certain rows (e.g.
    // payment/cashback/fee lines) but still populate a separately-mapped
    // Vendor column for them — fall back to that rather than storing an
    // empty rawDescription, which left nothing for the review screen's
    // suggested vendor name (or the raw-description line) to show.
    const rawDescription = row[mapping.descCol] || vendorOverride || "";
    const extras = {
      vendorOverride,
      categoryText: mapping.categoryCol > -1 ? row[mapping.categoryCol] : undefined,
      typeText: mapping.typeCol > -1 ? row[mapping.typeCol] : undefined,
    };
    if (mapping.amountMode === "single") {
      const signed = parseAmount(row[mapping.amountCol]);
      const isCharge = mapping.amountConvention === "negative_is_purchase" ? signed < 0 : signed > 0;
      return { date, rawDescription, amount: Math.abs(signed), isCharge, ...extras };
    }
    const debit = parseAmount(row[mapping.debitCol]);
    const credit = parseAmount(row[mapping.creditCol]);
    if (!isNaN(debit) && debit !== 0) return { date, rawDescription, amount: Math.abs(debit), isCharge: true, ...extras };
    return { date, rawDescription, amount: Math.abs(credit), isCharge: false, ...extras };
  });
}

// Client-side mirror of what the import route will actually do, purely for
// the "Confirm" preview table — the server is the source of truth at
// commit time, this just shows what to expect.
function previewClassification(row: ParsedRow, appState: AppState, categories: Category[]): RowPreview {
  const type = classifyTransactionType(row.rawDescription, row.isCharge, row.typeText, row.vendorOverride);
  const cleanedName = cleanVendorName(row.vendorOverride || row.rawDescription);
  const match = resolveVendor(cleanedName, appState.childVendors, appState.parentVendors);

  if (match.kind === "exact") {
    const child = appState.childVendors.find((c) => c.id === match.childVendorId);
    const parent = child ? appState.parentVendors.find((p) => p.id === child.parentId) : undefined;
    const categoryName = parent ? categories.find((c) => c.id === parent.category)?.name ?? null : null;
    return { type, vendorName: cleanedName, categoryName, needsReview: false };
  }
  if (match.kind === "fuzzy") {
    // Mirrors the import route: a fuzzy match still needs review, so this
    // preview's auto/review split matches what actually happens on import.
    const parent = appState.parentVendors.find((p) => p.id === match.parentId);
    const categoryName = parent ? categories.find((c) => c.id === parent.category)?.name ?? null : null;
    return { type, vendorName: cleanedName, categoryName, needsReview: true };
  }
  // A mapped Category column names a category the bank already assigns —
  // trust it, same as the server does at import time.
  if (row.categoryText?.trim()) {
    const cat = categories.find((c) => c.name.toLowerCase() === row.categoryText!.trim().toLowerCase());
    if (cat) return { type, vendorName: cleanedName, categoryName: cat.name, needsReview: false };
  }
  return { type, vendorName: cleanedName, categoryName: null, needsReview: true };
}

const mapTh: CSSProperties = {
  textAlign: "left",
  padding: "0 10px 8px 0",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--muted)",
  borderBottom: "1px solid var(--border)",
};
const mapTdLabel: CSSProperties = { padding: "10px 10px 10px 0", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", verticalAlign: "top" };
const mapTdField: CSSProperties = { padding: "10px 10px 10px 0", verticalAlign: "top" };
const mapTdFormat: CSSProperties = { padding: "10px 0", verticalAlign: "top" };
const mapOptionalTag: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--muted)", marginLeft: 6 };

function ColumnSelect({
  value,
  onChange,
  headers,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  headers: string[];
  placeholder: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...inputStyle, width: "100%" }}>
      <option value={-1}>{placeholder}</option>
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h}
        </option>
      ))}
    </select>
  );
}

export function ImportWizard({
  appState,
  onReload,
  onGoDashboard,
}: {
  appState: AppState;
  onReload: () => Promise<void>;
  onGoDashboard: () => void;
}) {
  const pushToast = useToast();
  const [step, setStep] = useState(1);
  const [cardId, setCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", bank: "", network: "Visa" as Network });

  const [fileName, setFileName] = useState("");
  // One entry per selected file, each the full parsed CSV for that file,
  // unsliced. Some banks prepend a few summary/metadata rows before the real
  // column-header row, so headers and dataRows are derived by skipping that
  // many rows rather than always assuming row 0 is the header. Selecting
  // several files (e.g. a run of monthly statements for one card) is only
  // sound when they share one layout, so every file is assumed to put its
  // header at the same skipRows offset as the first — see handleFilesChange,
  // which rejects the selection up front if any file's header row doesn't
  // match the first file's.
  const [fileRows, setFileRows] = useState<string[][][]>([]);
  const [skipRows, setSkipRows] = useState(0);
  const primaryRows = useMemo(() => fileRows[0] || [], [fileRows]);
  const headers = useMemo(() => primaryRows[skipRows] || [], [primaryRows, skipRows]);
  const dataRows = useMemo(() => fileRows.flatMap((rows) => rows.slice(skipRows + 1)), [fileRows, skipRows]);

  const [mapChoice, setMapChoice] = useState<string>("__new__");
  const [mapping, setMapping] = useState<Mapping>(BLANK_MAPPING);
  const [templateName, setTemplateName] = useState("");

  const [reviewQueue, setReviewQueue] = useState<Transaction[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewResolvedCount, setReviewResolvedCount] = useState(0);
  const [reviewType, setReviewType] = useState<TxnType>("purchase");
  // "__new__" means "create a brand-new vendor"; otherwise it's an existing ParentVendor id.
  const [reviewParentId, setReviewParentId] = useState<string>("__new__");
  const [reviewNewName, setReviewNewName] = useState("");
  const [reviewCategory, setReviewCategory] = useState("");
  const [summary, setSummary] = useState({ total: 0, auto: 0, review: 0, skipped: 0, duplicates: 0 });
  const [duplicateRows, setDuplicateRows] = useState<DuplicateRow[]>([]);
  // Indices into duplicateRows the user has checked off as "actually valid,
  // add it anyway" — unchecked (not in the set) by default, since a flagged
  // duplicate is presumed to really be a duplicate until the user says otherwise.
  const [selectedDuplicates, setSelectedDuplicates] = useState<Set<number>>(new Set());
  const [addingDuplicates, setAddingDuplicates] = useState(false);
  // In-flight guards. The import route now dedupes rows against what's
  // already on file, so a stray double-click just reports the whole batch
  // back as duplicates rather than importing it twice — but this still
  // avoids firing the request twice for no reason. The others (template,
  // card, review) have the same shape and no server-side dedup to fall
  // back on, so they still need the guard to avoid actual double-writes.
  const [importing, setImporting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

  const selectedCard = appState.cards.find((c) => c.id === cardId) || null;
  const sortedCategories = useMemo(() => sortCategoriesByName(appState.categories), [appState.categories]);
  const sortedParents = useMemo(
    () => [...appState.parentVendors].sort((a, b) => a.name.localeCompare(b.name)),
    [appState.parentVendors]
  );
  const categoryById = useMemo(() => new Map(appState.categories.map((c) => [c.id, c])), [appState.categories]);
  const parentById = useMemo(() => new Map(appState.parentVendors.map((p) => [p.id, p])), [appState.parentVendors]);
  const childById = useMemo(() => new Map(appState.childVendors.map((c) => [c.id, c])), [appState.childVendors]);

  const matchingTemplates = useMemo(() => {
    if (!selectedCard) return [];
    return appState.templates.filter((t) => t.bank.trim().toLowerCase() === selectedCard.bank.trim().toLowerCase());
  }, [appState.templates, selectedCard]);

  const parsedRows = useMemo(() => (headers.length ? computeRows(dataRows, mapping) : []), [dataRows, mapping, headers]);

  const previewRows = useMemo(
    () =>
      parsedRows
        .filter((r) => r.date)
        .slice(0, 10)
        .map((r) => ({ ...r, ...previewClassification(r, appState, appState.categories) })),
    [parsedRows, appState]
  );

  const validRows = useMemo(() => parsedRows.filter((r) => r.date && !isNaN(r.amount)), [parsedRows]);
  // Rows dropped here are silently absent from every count the wizard shows,
  // so a statement with timestamped dates or ragged short rows presented as a
  // smaller, apparently-clean import. Surfaced on the confirm step instead.
  const droppedRowCount = parsedRows.length - validRows.length;
  // Only classify on the step that displays the result. This is
  // O(rows x parents) regex work and it depends on `mapping`, so it used to
  // re-run over the entire file on the render path for every single column
  // dropdown change on step 2 — seconds of freeze per keystroke on a large
  // export with many existing vendors, to compute counts step 2 never shows.
  const classifiedAll = useMemo(
    () => (step >= 3 ? validRows.map((r) => previewClassification(r, appState, appState.categories)) : []),
    [validRows, appState, step]
  );
  const autoCount = classifiedAll.filter((c) => !c.needsReview).length;
  const reviewCount = classifiedAll.filter((c) => c.needsReview).length;

  function resetWizard() {
    setStep(1);
    setCardId(null);
    setFileName("");
    setFileRows([]);
    setSkipRows(0);
    setMapChoice("__new__");
    setMapping(BLANK_MAPPING);
    setTemplateName("");
    // Carrying these over meant "Import another file" started the next run
    // still holding the previous import's completion figures.
    setSummary({ total: 0, auto: 0, review: 0, skipped: 0, duplicates: 0 });
    setDuplicateRows([]);
    setSelectedDuplicates(new Set());
    setReviewQueue([]);
    setReviewTotal(0);
    setReviewResolvedCount(0);
  }

  function startEditCard(c: { id: string; name: string; bank: string; network: Network }) {
    setEditingCardId(c.id);
    setEditDraft({ name: c.name, bank: c.bank, network: c.network });
  }

  async function saveCardEdit(id: string) {
    const name = editDraft.name.trim();
    if (!name) return;
    try {
      await updateCard(id, { name, bank: editDraft.bank.trim(), network: editDraft.network });
      await onReload();
      setEditingCardId(null);
      pushToast("Card updated");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to update card");
    }
  }

  async function handleFilesChange(files: File[]) {
    if (files.length === 0) return;
    try {
      const parsed = await Promise.all(files.map(async (file) => ({ name: file.name, rows: parseCSV(await file.text()) })));
      const empties = parsed.filter((p) => p.rows.length === 0);
      if (empties.length > 0) {
        pushToast(
          parsed.length === 1
            ? "That file has no rows to import"
            : `${empties.map((p) => p.name).join(", ")} — no rows to import. Fix or remove ${empties.length === 1 ? "it" : "them"} and choose files again.`
        );
        return;
      }

      // A bank can have more than one saved template (re-saved after the
      // export format changed, an abandoned experiment, etc.) — picking
      // whichever sorts first ignored that and could silently apply a
      // stale skipRows/column mapping to a file it doesn't actually match.
      // Verify a candidate's snapshot against this file's real content
      // before trusting its skipRows, instead of assuming the first one
      // saved is still the right one.
      const t = matchingTemplates.find((c) => sameHeaders(c.headerSnapshot, parsed[0].rows[c.skipRows] || [])) ?? null;
      const skip = t?.skipRows ?? 0;
      // A run of files (e.g. a year's worth of monthly statements for one
      // card) is only safe to merge if every file is laid out the same way —
      // otherwise a column shift silently mixes up dates/amounts/vendors
      // across files with no error. Compare each file's header row against
      // the first file's rather than trusting the filenames or row counts.
      const firstHeaders = parsed[0].rows[skip] || [];
      const mismatch = parsed.slice(1).find((p) => !sameHeaders(firstHeaders, p.rows[skip] || []));
      if (mismatch) {
        pushToast(`"${mismatch.name}" has different columns than "${parsed[0].name}" — select files that share the same statement layout.`);
        return;
      }

      setFileName(parsed.length === 1 ? parsed[0].name : `${parsed.length} files: ${parsed.map((p) => p.name).join(", ")}`);
      setFileRows(parsed.map((p) => p.rows));
      if (t) {
        setSkipRows(skip);
        applyTemplate(t.id, firstHeaders);
      } else {
        setSkipRows(0);
        applyTemplate("__new__", firstHeaders);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to read the selected file(s)");
    }
  }

  // Some banks prepend a few summary/metadata rows before the real column
  // header. Moving the header row forces a fresh column guess — the
  // previous mapping's column positions no longer mean anything once the
  // header row itself has moved.
  function handleSkipRowsChange(newSkip: number) {
    const clamped = Math.max(0, Math.min(newSkip, Math.max(0, primaryRows.length - 1)));
    setSkipRows(clamped);
    applyTemplate("__new__", primaryRows[clamped] || []);
  }

  function applyTemplate(templateId: string, headerOverride?: string[]) {
    setMapChoice(templateId);
    if (templateId === "__new__") {
      const guess = guessMapping(headerOverride || headers);
      setMapping((m) => ({
        ...m,
        dateCol: guess.dateCol,
        descCol: guess.descCol,
        amountCol: guess.amountCol,
        debitCol: guess.debitCol,
        creditCol: guess.creditCol,
        categoryCol: guess.categoryCol,
        typeCol: guess.typeCol,
        // guessMapping has no vendor heuristic, so this one field used to
        // survive the re-guess — switching from a saved template back to
        // "Create new mapping…" left vendorCol pointing at whatever column
        // that template used, and the import fed e.g. a reference-number
        // column in as the vendor name, creating one junk vendor per row.
        vendorCol: -1,
      }));
      setTemplateName(selectedCard?.bank?.trim() || selectedCard?.name || "");
      return;
    }
    const t = appState.templates.find((t) => t.id === templateId);
    if (!t) return;
    setSkipRows(t.skipRows ?? 0);
    setMapping({
      dateCol: t.dateCol,
      descCol: t.descCol,
      dateFormat: t.dateFormat as DateFormat,
      amountMode: t.amountMode,
      amountCol: t.amountCol,
      amountConvention: t.amountConvention,
      debitCol: t.debitCol,
      creditCol: t.creditCol,
      vendorCol: t.vendorCol ?? -1,
      categoryCol: t.categoryCol ?? -1,
      typeCol: t.typeCol ?? -1,
    });
  }

  const mappingComplete =
    mapping.dateCol > -1 &&
    mapping.descCol > -1 &&
    (mapping.amountMode === "single" ? mapping.amountCol > -1 : mapping.debitCol > -1 || mapping.creditCol > -1);

  async function continueToStep3() {
    if (savingTemplate) return;
    if (mapChoice === "__new__" && templateName.trim() && selectedCard) {
      setSavingTemplate(true);
      try {
        const created = await addTemplate({
          name: templateName.trim(),
          bank: selectedCard.bank,
          network: selectedCard.network,
          dateCol: mapping.dateCol,
          descCol: mapping.descCol,
          dateFormat: mapping.dateFormat,
          amountMode: mapping.amountMode,
          amountCol: mapping.amountCol,
          amountConvention: mapping.amountConvention,
          debitCol: mapping.debitCol,
          creditCol: mapping.creditCol,
          vendorCol: mapping.vendorCol,
          categoryCol: mapping.categoryCol,
          typeCol: mapping.typeCol,
          skipRows,
          headerSnapshot: headers,
        });
        await onReload();
        // Switch the selection to the template that was just saved. Leaving
        // it on "__new__" meant every Back → Continue round-trip saved
        // another copy of the same mapping, and the next import then
        // auto-applied whichever duplicate sorted first.
        if (created?.id) setMapChoice(created.id);
        pushToast(`Saved import template "${templateName.trim()}"`);
      } catch (err) {
        // Stay on this step so the user can rename the template or clear
        // the name field, instead of silently dropping the mapping they
        // asked to save and moving on as if it succeeded.
        pushToast(err instanceof Error ? err.message : "Failed to save import template");
        return;
      } finally {
        setSavingTemplate(false);
      }
    }
    setStep(3);
  }

  async function confirmImport() {
    if (!cardId || validRows.length === 0 || importing) return;
    setImporting(true);
    const rows: ImportRow[] = validRows.map((r) => ({
      date: r.date as string,
      rawDescription: r.rawDescription,
      amount: r.amount,
      isCharge: r.isCharge,
      vendorOverride: r.vendorOverride,
      categoryText: r.categoryText,
      typeText: r.typeText,
    }));
    try {
      const res = await importTransactions(cardId, rows);
      await onReload();
      setSummary(res.counts);
      setDuplicateRows(res.duplicates);
      const needsReview = res.transactions.filter((t) => t.needsReview);
      // These two must reset for *every* import, not just ones that need
      // review — they were reset inside the branch below, so an import with
      // nothing to review kept the previous import's tally and the completion
      // screen reported "5 resolved in review" for a batch that had none.
      setReviewTotal(needsReview.length);
      setReviewResolvedCount(0);
      if (needsReview.length > 0) {
        setReviewQueue(needsReview);
        seedReviewFields(needsReview);
        setStep(4);
      } else {
        setStep(5);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to import transactions");
    } finally {
      setImporting(false);
    }
  }

  function toggleDuplicateSelected(index: number) {
    setSelectedDuplicates((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function addSelectedDuplicates() {
    if (!cardId || selectedDuplicates.size === 0 || addingDuplicates) return;
    setAddingDuplicates(true);
    const chosen = duplicateRows.filter((_, i) => selectedDuplicates.has(i));
    const rows: ImportRow[] = chosen.map((d) => ({
      date: d.date,
      rawDescription: d.rawDescription,
      amount: d.amount,
      isCharge: d.isCharge,
      vendorOverride: d.vendorOverride,
      categoryText: d.categoryText,
      typeText: d.typeText,
      forceImport: true,
    }));
    try {
      const res = await importTransactions(cardId, rows);
      await onReload();
      setDuplicateRows((prev) => prev.filter((_, i) => !selectedDuplicates.has(i)));
      setSummary((s) => ({
        total: s.total + res.counts.total,
        auto: s.auto + res.counts.auto,
        review: s.review + res.counts.review,
        skipped: s.skipped + res.counts.skipped,
        duplicates: s.duplicates - res.counts.total,
      }));
      pushToast(`Added ${res.counts.total} transaction${res.counts.total === 1 ? "" : "s"} as valid`);
      setSelectedDuplicates(new Set());
      // Same as a fresh import: a forced row can still need review (e.g. no
      // vendor match yet), so route it through the normal review queue
      // rather than silently leaving it unclassified.
      const needsReview = res.transactions.filter((t) => t.needsReview);
      if (needsReview.length > 0) {
        // reviewResolvedCount is deliberately not reset here — it's the
        // running total shown on the completion screen, and this batch is a
        // continuation of the same import, not a new one.
        setReviewQueue(needsReview);
        setReviewTotal(needsReview.length);
        seedReviewFields(needsReview);
        setStep(4);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to add selected transactions");
    } finally {
      setAddingDuplicates(false);
    }
  }

  function seedReviewFields(rest: Transaction[]) {
    if (rest.length > 0) {
      const item = rest[0];
      setReviewType(item.type);
      // A fuzzy vendor match already links childVendorId to a suggested
      // parent (see transactions/import route) but still needs a human to
      // confirm it — default to that parent instead of "create new" so
      // confirming is just Save & Next, not accidentally forking a
      // duplicate vendor.
      const existingParentId = item.childVendorId ? childById.get(item.childVendorId)?.parentId : undefined;
      setReviewParentId(existingParentId ?? "__new__");
      setReviewNewName(cleanVendorName(item.rawDescription));
      setReviewCategory("");
    } else {
      setStep(5);
    }
  }

  function skipReview() {
    const rest = reviewQueue.slice(1);
    setReviewQueue(rest);
    seedReviewFields(rest);
  }

  async function saveAndNextReview() {
    if (savingReview) return;
    const current = reviewQueue[0];
    if (!current) return;
    let rest = reviewQueue.slice(1);
    let resolvedCount = 1;
    setSavingReview(true);
    try {
      if (reviewParentId === "__new__") {
        if (!reviewNewName.trim() || !reviewCategory) return;
        try {
          await updateTransaction(current.id, { type: reviewType, newParentName: reviewNewName.trim(), category: reviewCategory });
        } catch (err) {
          // Parent/vendor names are unique — stay on this item so the user
          // can pick a different name or link to the existing vendor instead.
          pushToast(err instanceof Error ? err.message : "Failed to create vendor");
          return;
        }
      } else {
        try {
          await updateTransaction(current.id, { type: reviewType, parentId: reviewParentId });
        } catch (err) {
          pushToast(err instanceof Error ? err.message : "Failed to link vendor");
          return;
        }
      }

      // A freshly-created (or newly-linked) vendor should immediately catch
      // other occurrences of the same vendor still waiting in this batch
      // (e.g. "Storage ABC 12312" then "Storage ABC 43412"), instead of
      // asking the user to resolve the same vendor over and over in one
      // import. Refetch rather than relying on the appState prop, since it
      // won't reflect this update until the next render.
      if (rest.length > 0) {
        const fresh = await fetchState();
        const stillNeedsReview: Transaction[] = [];
        let autoLinkFailures = 0;
        for (const item of rest) {
          const cleanedName = cleanVendorName(item.rawDescription);
          const match = resolveVendor(cleanedName, fresh.childVendors, fresh.parentVendors);
          try {
            if (match.kind === "exact") {
              // An exact match here is the literal same vendor the user just
              // resolved (or another exact duplicate already on file) — safe
              // to auto-confirm. A "fuzzy" match is only ever a guess, so
              // (like the primary import path) it still needs a human to
              // confirm it and falls through to stillNeedsReview below.
              await updateTransaction(item.id, { childVendorId: match.childVendorId });
              resolvedCount++;
            } else {
              stillNeedsReview.push(item);
            }
          } catch {
            // Don't let one failed auto-link abandon the rest of the batch
            // (and leave the client's queue out of sync with what actually
            // saved) — just leave this one in the review queue instead.
            autoLinkFailures++;
            stillNeedsReview.push(item);
          }
        }
        rest = stillNeedsReview;
        if (autoLinkFailures > 0) {
          pushToast(`${autoLinkFailures} other matching transaction${autoLinkFailures === 1 ? "" : "s"} couldn't be auto-linked and still need review`);
        }
      }

      await onReload();
      setReviewResolvedCount((c) => c + resolvedCount);
      setReviewQueue(rest);
      seedReviewFields(rest);
    } finally {
      setSavingReview(false);
    }
  }

  const currentReview = reviewQueue[0];
  const reviewCanSave = reviewParentId !== "__new__" || (!!reviewNewName.trim() && !!reviewCategory);

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 20px", letterSpacing: "-0.01em" }}>Import Statement</h1>

      <div style={{ display: "flex", gap: 6, marginBottom: 26 }}>
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 20,
              background: step === i + 1 ? "var(--accent)" : "var(--panel)",
              color: step === i + 1 ? "white" : "var(--muted)",
              border: "1px solid var(--border)",
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Which card is this statement for?</div>

          {editingCardId ? (
            <div style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: "12px 14px", background: "var(--panel)", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  placeholder="Card nickname"
                  style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                />
                <input
                  value={editDraft.bank}
                  onChange={(e) => setEditDraft({ ...editDraft, bank: e.target.value })}
                  placeholder="Bank"
                  style={{ ...inputStyle, flex: 1, minWidth: 120 }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {(["Visa", "Mastercard"] as Network[]).map((n) => (
                  <button
                    key={n}
                    onClick={() => setEditDraft({ ...editDraft, network: n })}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      background: editDraft.network === n ? "var(--accent)" : "transparent",
                      color: editDraft.network === n ? "white" : "var(--text)",
                    }}
                  >
                    {n}
                  </button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <SecondaryButton onClick={() => setEditingCardId(null)}>Cancel</SecondaryButton>
                  <PrimaryButton onClick={() => saveCardEdit(editingCardId)}>Save</PrimaryButton>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <select
                value={cardId ?? ""}
                onChange={(e) => setCardId(e.target.value || null)}
                style={{ ...inputStyle, flex: 1, width: "100%" }}
              >
                <option value="" disabled>
                  {appState.cards.length ? "— Select a card —" : "No cards yet — add one on the Cards page first"}
                </option>
                {appState.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.bank} · {c.network} ····{c.last4}
                  </option>
                ))}
              </select>
              {selectedCard && <SecondaryButton onClick={() => startEditCard(selectedCard)}>Edit</SecondaryButton>}
            </div>
          )}

          {cardId && <PrimaryButton onClick={() => setStep(2)}>Continue →</PrimaryButton>}
        </div>
      )}

      {step === 2 && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Upload the statement CSV</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Pick one file, or several statements for this same card (e.g. a run of monthly exports) — they must share the
            same column layout.
          </div>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 18,
              cursor: "pointer",
              background: "var(--panel)",
            }}
          >
            <span
              style={{
                background: "var(--accent)",
                color: "white",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Choose File(s)
            </span>
            <span style={{ fontSize: 13.5, color: fileName ? "var(--text)" : "var(--muted)" }}>{fileName || "No file chosen"}</span>
            <input
              type="file"
              accept=".csv"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) handleFilesChange(Array.from(e.target.files));
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>

          {headers.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
                {fileName} · {dataRows.length} rows detected{fileRows.length > 1 ? ` across ${fileRows.length} files` : ""}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <label style={{ fontSize: 12.5, color: "var(--muted)" }}>Header row</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, primaryRows.length)}
                  value={skipRows + 1}
                  onChange={(e) => handleSkipRowsChange(Number(e.target.value) - 1)}
                  style={{ ...inputStyle, width: 64, padding: "6px 8px", fontSize: 13 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  of {primaryRows.length} rows in {fileRows.length > 1 ? "the first file" : "the file"}
                  {skipRows > 0 ? ` — skipping ${skipRows} row${skipRows === 1 ? "" : "s"} above the header` : ""}
                </span>
              </div>
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 20 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.slice(0, 5).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Column mapping template</div>
                <select
                  value={mapChoice}
                  onChange={(e) => applyTemplate(e.target.value)}
                  style={{ ...inputStyle, padding: "9px 10px", fontSize: 13.5, width: "100%", maxWidth: 360 }}
                >
                  {matchingTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      Use saved: {t.name}
                    </option>
                  ))}
                  <option value="__new__">Create new mapping…</option>
                </select>
              </div>

              {mapChoice === "__new__" && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px", marginBottom: 20 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                    <thead>
                      <tr>
                        <th style={mapTh}>System field</th>
                        <th style={mapTh}>Import file field</th>
                        <th style={mapTh}>Field format</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={mapTdLabel}>Date</td>
                        <td style={mapTdField}>
                          <ColumnSelect value={mapping.dateCol} onChange={(v) => setMapping({ ...mapping, dateCol: v })} headers={headers} placeholder="— Select —" />
                        </td>
                        <td style={mapTdFormat}>
                          <select
                            value={mapping.dateFormat}
                            onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}
                            style={{ ...inputStyle, width: "100%" }}
                          >
                            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                            <option value="Month DD, YYYY">Month DD, YYYY</option>
                            <option value="YYYYMMDD">YYYYMMDD</option>
                          </select>
                        </td>
                      </tr>
                      <tr>
                        <td style={mapTdLabel}>Description</td>
                        <td style={mapTdField}>
                          <ColumnSelect value={mapping.descCol} onChange={(v) => setMapping({ ...mapping, descCol: v })} headers={headers} placeholder="— Select —" />
                        </td>
                        <td style={mapTdFormat} />
                      </tr>
                      <tr>
                        <td style={mapTdLabel}>
                          Vendor
                          <span style={mapOptionalTag}>optional</span>
                        </td>
                        <td style={mapTdField}>
                          <ColumnSelect
                            value={mapping.vendorCol}
                            onChange={(v) => setMapping({ ...mapping, vendorCol: v })}
                            headers={headers}
                            placeholder="Auto-detect from description"
                          />
                        </td>
                        <td style={mapTdFormat} />
                      </tr>
                      <tr>
                        <td style={mapTdLabel}>
                          Category
                          <span style={mapOptionalTag}>optional</span>
                        </td>
                        <td style={mapTdField}>
                          <ColumnSelect
                            value={mapping.categoryCol}
                            onChange={(v) => setMapping({ ...mapping, categoryCol: v })}
                            headers={headers}
                            placeholder="Auto-classify"
                          />
                        </td>
                        <td style={mapTdFormat} />
                      </tr>
                      <tr>
                        <td style={mapTdLabel}>
                          Type
                          <span style={mapOptionalTag}>optional</span>
                        </td>
                        <td style={mapTdField}>
                          <ColumnSelect value={mapping.typeCol} onChange={(v) => setMapping({ ...mapping, typeCol: v })} headers={headers} placeholder="Auto-classify" />
                        </td>
                        <td style={mapTdFormat} />
                      </tr>
                      <tr>
                        <td style={mapTdLabel}>Amount mode</td>
                        <td colSpan={2} style={mapTdField}>
                          <div style={{ display: "flex", gap: 8 }}>
                            {(["single", "split"] as AmountMode[]).map((mode) => (
                              <button
                                key={mode}
                                onClick={() => setMapping({ ...mapping, amountMode: mode })}
                                style={{
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  padding: "8px 14px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  background: mapping.amountMode === mode ? "var(--accent)" : "transparent",
                                  color: mapping.amountMode === mode ? "white" : "var(--text)",
                                }}
                              >
                                {mode === "single" ? "Single amount column" : "Separate debit / credit columns"}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {mapping.amountMode === "single" ? (
                        <tr>
                          <td style={mapTdLabel}>Amount</td>
                          <td style={mapTdField}>
                            <ColumnSelect value={mapping.amountCol} onChange={(v) => setMapping({ ...mapping, amountCol: v })} headers={headers} placeholder="— Select —" />
                          </td>
                          <td style={mapTdFormat}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {(["positive_is_purchase", "negative_is_purchase"] as AmountConvention[]).map((conv) => (
                                <button
                                  key={conv}
                                  onClick={() => setMapping({ ...mapping, amountConvention: conv })}
                                  style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 8,
                                    padding: "8px 12px",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    background: mapping.amountConvention === conv ? "var(--accent)" : "transparent",
                                    color: mapping.amountConvention === conv ? "white" : "var(--text)",
                                  }}
                                >
                                  {conv === "positive_is_purchase" ? "Positive = purchase" : "Negative = purchase"}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <>
                          <tr>
                            <td style={mapTdLabel}>Debit (charge)</td>
                            <td style={mapTdField}>
                              <ColumnSelect value={mapping.debitCol} onChange={(v) => setMapping({ ...mapping, debitCol: v })} headers={headers} placeholder="— Select —" />
                            </td>
                            <td style={mapTdFormat} />
                          </tr>
                          <tr>
                            <td style={mapTdLabel}>Credit (payment)</td>
                            <td style={mapTdField}>
                              <ColumnSelect value={mapping.creditCol} onChange={(v) => setMapping({ ...mapping, creditCol: v })} headers={headers} placeholder="— Select —" />
                            </td>
                            <td style={mapTdFormat} />
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>

                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>
                    Vendor / Category / Type are optional — leave them as auto-detect/auto-classify unless your statement already provides clean values for them.
                  </div>

                  <div>
                    <div style={labelStyle}>Save this mapping as a template named</div>
                    <input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      style={{ ...inputStyle, width: "100%", maxWidth: 340 }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={() => setStep(1)}>← Back</SecondaryButton>
            {headers.length > 0 && (
              <PrimaryButton disabled={!mappingComplete || savingTemplate} onClick={continueToStep3}>
                Continue →
              </PrimaryButton>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ maxWidth: 680 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Review &amp; confirm import</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
            {[
              { label: "Total rows", value: validRows.length },
              { label: "Auto-classified", value: autoCount, color: "var(--positive)" },
              { label: "Needs review", value: reviewCount, color: "var(--attention)" },
            ].map((stat) => (
              <div key={stat.label} style={{ flex: 1, minWidth: 140, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{stat.label}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600, color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>
          {droppedRowCount > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--attention)", marginBottom: 18 }}>
              {droppedRowCount} row{droppedRowCount === 1 ? "" : "s"} in this file couldn&apos;t be read and won&apos;t be imported — usually an
              unrecognized date format or a blank/non-numeric amount. Check the Date format and column mapping on the previous step if that
              looks wrong.
            </div>
          )}
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 20 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Date", "Vendor", "Category", "Type", "Amount"].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 4 ? "right" : "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((p, i) => {
                  const typeMeta = TYPE_META[p.type];
                  return (
                    <tr key={i}>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)" }}>{fmtDateShort(p.date)}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{p.vendorName}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{p.categoryName || "Uncategorized"}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>
                        <Pill color={typeMeta.color}>{typeMeta.label}</Pill>
                      </td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--mono)" }}>{fmtCurrency(p.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={() => setStep(2)}>← Back</SecondaryButton>
            <PrimaryButton onClick={confirmImport} disabled={validRows.length === 0 || importing}>
              {importing ? "Importing…" : `Import ${validRows.length} Transactions`}
            </PrimaryButton>
          </div>
        </div>
      )}

      {step === 4 && currentReview && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
            Reviewing {reviewTotal - reviewQueue.length + 1} of {reviewTotal}
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {selectedCard?.name} · {fmtDateShort(currentReview.date)}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, marginBottom: 6, color: "var(--muted)" }}>{currentReview.rawDescription}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, marginBottom: 18 }}>{fmtCurrency(currentReview.amount)}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Type</div>
              <select value={reviewType} onChange={(e) => setReviewType(e.target.value as TxnType)} style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }}>
                {(Object.keys(TYPE_META) as TxnType[]).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_META[type].label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Parent</div>
              <select
                value={reviewParentId}
                onChange={(e) => setReviewParentId(e.target.value)}
                style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }}
              >
                <option value="__new__">+ Create new parent…</option>
                {sortedParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {reviewParentId === "__new__" ? (
              <>
                <div style={{ marginBottom: 4, fontSize: 12, color: "var(--muted)" }}>
                  Vendor: <span style={{ fontFamily: "var(--mono)" }}>{cleanVendorName(currentReview.rawDescription)}</span> — this exact
                  name must be unique across all parents.
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={labelStyle}>New parent name</div>
                  <input
                    value={reviewNewName}
                    onChange={(e) => setReviewNewName(e.target.value)}
                    style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={labelStyle}>Category</div>
                  <select value={reviewCategory} onChange={(e) => setReviewCategory(e.target.value)} style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }}>
                    <option value="">— Choose a category —</option>
                    {sortedCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div style={{ marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
                Category: {categoryById.get(parentById.get(reviewParentId)?.category || "")?.name || "—"}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={skipReview}>Skip for now</SecondaryButton>
            <PrimaryButton onClick={saveAndNextReview} disabled={!reviewCanSave || savingReview}>
              Save &amp; Next →
            </PrimaryButton>
          </div>
        </div>
      )}

      {step === 5 && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Import complete</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
            Imported {summary.total} transactions. {summary.auto} auto-classified, {reviewResolvedCount} resolved in review.
            {summary.skipped > 0 && (
              <>
                {" "}
                <span style={{ color: "var(--attention)" }}>
                  {summary.skipped} row{summary.skipped === 1 ? "" : "s"} skipped (missing or invalid amount).
                </span>
              </>
            )}
            {summary.duplicates > 0 && (
              <>
                {" "}
                <span style={{ color: "var(--attention)" }}>
                  {summary.duplicates} row{summary.duplicates === 1 ? "" : "s"} skipped as duplicates of transactions already on file.
                </span>
              </>
            )}
          </div>
          {duplicateRows.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                Matched on the same card, date, description, and amount as an existing transaction. If any of these were actually separate
                charges (e.g. two identical purchases on the same day), check them below and add them as valid transactions.
              </div>
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", width: 1 }} />
                      {["Date", "Description", "Amount"].map((h, i) => (
                        <th
                          key={h}
                          style={{ textAlign: i === 2 ? "right" : "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateRows.map((d, i) => (
                      <tr key={i}>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>
                          <input
                            type="checkbox"
                            checked={selectedDuplicates.has(i)}
                            onChange={() => toggleDuplicateSelected(i)}
                            aria-label={`Add ${d.rawDescription} on ${d.date} as a valid transaction`}
                          />
                        </td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)" }}>{fmtDateShort(d.date)}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{d.rawDescription}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--mono)" }}>
                          {fmtCurrency(d.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedDuplicates.size > 0 && (
                <div style={{ marginTop: 12 }}>
                  <SecondaryButton onClick={addSelectedDuplicates} disabled={addingDuplicates}>
                    {addingDuplicates
                      ? "Adding…"
                      : `Add ${selectedDuplicates.size} Selected as Transaction${selectedDuplicates.size === 1 ? "" : "s"}`}
                  </SecondaryButton>
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={resetWizard}>Import another file</SecondaryButton>
            <PrimaryButton onClick={onGoDashboard}>Go to dashboard →</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
