"use client";

import type { AppState, Template } from "@/lib/types";
import { deleteTemplate } from "@/lib/api";
import { useToast } from "./ToastContext";
import { PageTitle } from "./ui";

function summarize(t: Template): string {
  const col = (i: number) => (i >= 0 && t.headerSnapshot[i] != null ? t.headerSnapshot[i] : "—");
  const parts: string[] = [];
  if (t.skipRows > 0) parts.push(`Header on row ${t.skipRows + 1}`);
  parts.push(`Date: ${col(t.dateCol)}`, `Description: ${col(t.descCol)}`);
  if (t.amountMode === "single") {
    const sign = t.amountConvention === "negative_is_purchase" ? "negative = purchase" : "positive = purchase";
    parts.push(`Amount: ${col(t.amountCol)} (${sign})`);
  } else {
    parts.push(`Debit: ${col(t.debitCol)}`, `Credit: ${col(t.creditCol)}`);
  }
  if (t.vendorCol > -1) parts.push(`Vendor: ${col(t.vendorCol)}`);
  if (t.categoryCol > -1) parts.push(`Category: ${col(t.categoryCol)}`);
  if (t.typeCol > -1) parts.push(`Type: ${col(t.typeCol)}`);
  return parts.join(" · ");
}

export function Templates({ appState, onReload }: { appState: AppState; onReload: () => Promise<void> }) {
  const pushToast = useToast();

  async function handleDelete(t: Template) {
    await deleteTemplate(t.id);
    await onReload();
    pushToast(`Deleted template "${t.name}"`);
  }

  return (
    <div>
      <PageTitle>Import Templates</PageTitle>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 18 }}>
        Templates are created during CSV import and reused automatically for future statements from the same bank.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
        {appState.templates.map((t) => (
          <div key={t.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {t.bank} · {t.network}
                </div>
              </div>
              <button
                onClick={() => handleDelete(t)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                Delete
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, fontFamily: "var(--mono)" }}>{summarize(t)}</div>
          </div>
        ))}
        {appState.templates.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "20px 0" }}>
            No templates saved yet — they&apos;ll appear here after your first import.
          </div>
        )}
      </div>
    </div>
  );
}
