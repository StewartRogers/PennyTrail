"use client";

import { useMemo, useState } from "react";
import type { AppState, AmountConvention, AmountMode, Network } from "@/lib/types";
import { parseCSV, guessMapping, parseAmount, parseDateFlexible } from "@/lib/csv";
import { classifyTransaction } from "@/lib/classify";
import { addCard, addTemplate, importTransactions, updateTransaction, type ImportRow } from "@/lib/api";
import { fmtCurrency, fmtDateShort } from "@/lib/format";
import { TYPE_META } from "@/lib/categories";
import { PrimaryButton, SecondaryButton, Pill, inputStyle, labelStyle } from "./ui";
import { useToast } from "./ToastContext";
import type { Transaction } from "@/lib/types";

type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

interface Mapping {
  dateCol: number;
  descCol: number;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  amountCol: number;
  amountConvention: AmountConvention;
  debitCol: number;
  creditCol: number;
}

interface ParsedRow {
  date: string | null;
  rawDescription: string;
  amount: number;
  isCharge: boolean;
}

const STEP_LABELS = ["1 · Card", "2 · Upload & Map", "3 · Confirm", "4 · Review", "5 · Done"];

function computeRows(dataRows: string[][], mapping: Mapping): ParsedRow[] {
  return dataRows.map((row) => {
    const date = parseDateFlexible(row[mapping.dateCol], mapping.dateFormat);
    const rawDescription = row[mapping.descCol] || "";
    if (mapping.amountMode === "single") {
      const signed = parseAmount(row[mapping.amountCol]);
      const isCharge = mapping.amountConvention === "negative_is_purchase" ? signed < 0 : signed > 0;
      return { date, rawDescription, amount: Math.abs(signed), isCharge };
    }
    const debit = parseAmount(row[mapping.debitCol]);
    const credit = parseAmount(row[mapping.creditCol]);
    if (!isNaN(debit) && debit !== 0) return { date, rawDescription, amount: Math.abs(debit), isCharge: true };
    return { date, rawDescription, amount: Math.abs(credit), isCharge: false };
  });
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
  const [newCard, setNewCard] = useState({ name: "", bank: "", last4: "", network: "Visa" as Network });

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);

  const [mapChoice, setMapChoice] = useState<string>("__new__");
  const [mapping, setMapping] = useState<Mapping>({
    dateCol: -1,
    descCol: -1,
    dateFormat: "MM/DD/YYYY",
    amountMode: "single",
    amountCol: -1,
    amountConvention: "positive_is_purchase",
    debitCol: -1,
    creditCol: -1,
  });
  const [templateName, setTemplateName] = useState("");

  const [reviewQueue, setReviewQueue] = useState<Transaction[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewVendor, setReviewVendor] = useState("");
  const [reviewCategory, setReviewCategory] = useState("");
  const [reviewRemember, setReviewRemember] = useState(true);
  const [summary, setSummary] = useState({ total: 0, auto: 0, review: 0 });

  const selectedCard = appState.cards.find((c) => c.id === cardId) || null;
  const spendCategories = appState.categories.filter((c) => !c.system);

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
        .map((r) => {
          const c = classifyTransaction(r.rawDescription, r.isCharge, appState.vendorRules);
          return { ...r, ...c };
        }),
    [parsedRows, appState.vendorRules]
  );

  const validRows = useMemo(() => parsedRows.filter((r) => r.date && !isNaN(r.amount)), [parsedRows]);
  const classifiedAll = useMemo(
    () => validRows.map((r) => classifyTransaction(r.rawDescription, r.isCharge, appState.vendorRules)),
    [validRows, appState.vendorRules]
  );
  const autoCount = classifiedAll.filter((c) => !c.needsReview).length;
  const reviewCount = classifiedAll.filter((c) => c.needsReview).length;

  function resetWizard() {
    setStep(1);
    setCardId(null);
    setFileName("");
    setHeaders([]);
    setDataRows([]);
    setMapChoice("__new__");
    setMapping({
      dateCol: -1,
      descCol: -1,
      dateFormat: "MM/DD/YYYY",
      amountMode: "single",
      amountCol: -1,
      amountConvention: "positive_is_purchase",
      debitCol: -1,
      creditCol: -1,
    });
    setTemplateName("");
  }

  async function handleAddCard() {
    const name = newCard.name.trim();
    if (!name) return;
    const card = await addCard({ name, bank: newCard.bank.trim(), last4: newCard.last4.trim(), network: newCard.network });
    setNewCard({ name: "", bank: "", last4: "", network: "Visa" });
    await onReload();
    setCardId(card.id);
    pushToast(`Added card "${name}"`);
  }

  async function handleFileChange(file: File) {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return;
    const [header, ...rest] = rows;
    setFileName(file.name);
    setHeaders(header);
    setDataRows(rest);

    if (matchingTemplates.length > 0) {
      applyTemplate(matchingTemplates[0].id, header);
    } else {
      const guess = guessMapping(header);
      setMapChoice("__new__");
      setMapping((m) => ({
        ...m,
        dateCol: guess.dateCol,
        descCol: guess.descCol,
        amountCol: guess.amountCol,
        debitCol: guess.debitCol,
        creditCol: guess.creditCol,
        amountMode: guess.amountCol > -1 ? "single" : "split",
      }));
    }
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
      }));
      return;
    }
    const t = appState.templates.find((t) => t.id === templateId);
    if (!t) return;
    setMapping({
      dateCol: t.dateCol,
      descCol: t.descCol,
      dateFormat: t.dateFormat as DateFormat,
      amountMode: t.amountMode,
      amountCol: t.amountCol,
      amountConvention: t.amountConvention,
      debitCol: t.debitCol,
      creditCol: t.creditCol,
    });
  }

  const mappingComplete =
    mapping.dateCol > -1 &&
    mapping.descCol > -1 &&
    (mapping.amountMode === "single" ? mapping.amountCol > -1 : mapping.debitCol > -1 || mapping.creditCol > -1);

  async function continueToStep3() {
    if (mapChoice === "__new__" && templateName.trim() && selectedCard) {
      await addTemplate({
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
        headerSnapshot: headers,
      });
      await onReload();
    }
    setStep(3);
  }

  async function confirmImport() {
    if (!cardId) return;
    const rows: ImportRow[] = validRows.map((r) => ({
      date: r.date as string,
      rawDescription: r.rawDescription,
      amount: r.amount,
      isCharge: r.isCharge,
    }));
    const res = await importTransactions(cardId, rows);
    await onReload();
    setSummary(res.counts);
    const needsReview = res.transactions.filter((t) => t.needsReview);
    if (needsReview.length > 0) {
      setReviewQueue(needsReview);
      setReviewIndex(0);
      setReviewVendor(needsReview[0].vendor);
      setReviewCategory("");
      setReviewRemember(true);
      setStep(4);
    } else {
      setStep(5);
    }
  }

  function advanceReview() {
    if (reviewIndex + 1 < reviewQueue.length) {
      const next = reviewQueue[reviewIndex + 1];
      setReviewIndex(reviewIndex + 1);
      setReviewVendor(next.vendor);
      setReviewCategory("");
      setReviewRemember(true);
    } else {
      setStep(5);
    }
  }

  async function skipReview() {
    advanceReview();
  }

  async function saveAndNextReview() {
    const current = reviewQueue[reviewIndex];
    await updateTransaction(current.id, {
      vendor: reviewVendor,
      category: reviewCategory || null,
      needsReview: false,
      rememberVendor: reviewRemember && !!reviewCategory,
    });
    await onReload();
    advanceReview();
  }

  const currentReview = reviewQueue[reviewIndex];

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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {appState.cards.map((c) => (
              <div
                key={c.id}
                onClick={() => setCardId(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: cardId === c.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: cardId === c.id ? "oklch(0.55 0.15 250 / 0.06)" : "var(--panel)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {c.bank} · {c.network} ····{c.last4}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>+ Add a new card</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <input
                value={newCard.name}
                onChange={(e) => setNewCard({ ...newCard, name: e.target.value })}
                placeholder="Card nickname"
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}
              />
              <input
                value={newCard.bank}
                onChange={(e) => setNewCard({ ...newCard, bank: e.target.value })}
                placeholder="Bank"
                style={{ ...inputStyle, flex: 1, minWidth: 120 }}
              />
              <input
                value={newCard.last4}
                onChange={(e) => setNewCard({ ...newCard, last4: e.target.value })}
                placeholder="Last 4"
                style={{ ...inputStyle, width: 70 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {(["Visa", "Mastercard"] as Network[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setNewCard({ ...newCard, network: n })}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: newCard.network === n ? "var(--accent)" : "transparent",
                    color: newCard.network === n ? "white" : "var(--text)",
                  }}
                >
                  {n}
                </button>
              ))}
              <div style={{ marginLeft: "auto" }}>
                <PrimaryButton onClick={handleAddCard}>Add Card</PrimaryButton>
              </div>
            </div>
          </div>

          {cardId && <PrimaryButton onClick={() => setStep(2)}>Continue →</PrimaryButton>}
        </div>
      )}

      {step === 2 && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Upload the statement CSV</div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            style={{ marginBottom: 18, fontSize: 13.5 }}
          />

          {headers.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                {fileName} · {dataRows.length} rows detected
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
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={labelStyle}>Date column</div>
                      <select value={mapping.dateCol} onChange={(e) => setMapping({ ...mapping, dateCol: Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }}>
                        <option value={-1}>— Select —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={labelStyle}>Description column</div>
                      <select value={mapping.descCol} onChange={(e) => setMapping({ ...mapping, descCol: Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }}>
                        <option value={-1}>— Select —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={labelStyle}>Date format</div>
                      <select
                        value={mapping.dateFormat}
                        onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}
                        style={{ ...inputStyle, width: "100%" }}
                      >
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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

                    {mapping.amountMode === "single" ? (
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={labelStyle}>Amount column</div>
                          <select value={mapping.amountCol} onChange={(e) => setMapping({ ...mapping, amountCol: Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }}>
                            <option value={-1}>— Select —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <div style={labelStyle}>Sign convention</div>
                          <div style={{ display: "flex", gap: 8 }}>
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
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={labelStyle}>Debit (charge) column</div>
                          <select value={mapping.debitCol} onChange={(e) => setMapping({ ...mapping, debitCol: Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }}>
                            <option value={-1}>— Select —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={labelStyle}>Credit (payment) column</div>
                          <select value={mapping.creditCol} onChange={(e) => setMapping({ ...mapping, creditCol: Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }}>
                            <option value={-1}>— Select —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
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
              <PrimaryButton disabled={!mappingComplete} onClick={continueToStep3}>
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
                  const cat = appState.categories.find((c) => c.id === p.category);
                  const typeMeta = TYPE_META[p.type];
                  return (
                    <tr key={i}>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)" }}>{fmtDateShort(p.date)}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{p.vendor}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{cat?.name || "Uncategorized"}</td>
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
            <PrimaryButton onClick={confirmImport}>Import {validRows.length} Transactions</PrimaryButton>
          </div>
        </div>
      )}

      {step === 4 && currentReview && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
            Reviewing {reviewIndex + 1} of {reviewQueue.length}
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {selectedCard?.name} · {fmtDateShort(currentReview.date)}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, marginBottom: 6, color: "var(--muted)" }}>{currentReview.rawDescription}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, marginBottom: 18 }}>{fmtCurrency(currentReview.amount)}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Vendor</div>
              <input value={reviewVendor} onChange={(e) => setReviewVendor(e.target.value)} style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Category</div>
              <select value={reviewCategory} onChange={(e) => setReviewCategory(e.target.value)} style={{ ...inputStyle, width: "100%", padding: "9px 10px", fontSize: 14 }}>
                <option value="">— Choose a category —</option>
                {spendCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={reviewRemember} onChange={(e) => setReviewRemember(e.target.checked)} />
              Remember this vendor for future imports
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={skipReview}>Skip for now</SecondaryButton>
            <PrimaryButton onClick={saveAndNextReview}>Save &amp; Next →</PrimaryButton>
          </div>
        </div>
      )}

      {step === 5 && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Import complete</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
            Imported {summary.total} transactions. {summary.auto} auto-classified, {reviewQueue.length} resolved in review.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <SecondaryButton onClick={resetWizard}>Import another file</SecondaryButton>
            <PrimaryButton onClick={onGoDashboard}>Go to dashboard →</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
