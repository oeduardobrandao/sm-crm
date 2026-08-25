/**
 * CSV export helpers for the Admin app: serialization, formula-injection
 * neutralization, download, and the shared cents -> monthly-cents rule for
 * annual subscriptions. Mirrors, without importing (the two apps don't share
 * a CSV module), the parsing conventions in apps/crm/src/lib/csv.ts and the
 * csvCell() formula-injection mitigation in
 * apps/crm/src/pages/importar/components/StepCommit.tsx.
 */

export interface CsvColumn {
  key: string;
  label: string;
}

/**
 * Neutralizes CSV formula injection: a cell opened in Excel/Sheets that starts
 * with =, +, -, @, a tab, or a carriage return can be interpreted as a formula.
 * Prefixing a leading ' forces the cell to be read as literal text without
 * changing how it displays -- the convention StepCommit.tsx's csvCell() already
 * uses in this repo (that one covers =/+/-/@; this adds tab/CR too, per the
 * broader OWASP CSV-injection character set).
 */
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function quoteField(value: string): string {
  const safe = sanitizeCell(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Serializes rows to RFC 4180 CSV text with a UTF-8 BOM, ready for Excel. */
export function toCSV(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map((c) => quoteField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => quoteField(formatCell(row[c.key]))).join(','),
  );
  return '﻿' + [header, ...lines].join('\r\n');
}

/** Triggers a browser download of `csvText` as `filename`. */
export function downloadCSV(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Normalizes a per-interval charge to a monthly figure -- annual subscriptions
 * divided by 12, rounded on integer cents (not on decimal reais). Mirrors
 * toMonthlyCents in supabase/functions/_shared/billing-logic.ts, duplicated
 * here because that module is a Deno edge-function file and can't be imported
 * into the Vite-built admin frontend.
 */
export function toMonthlyCents(
  interval: string | null | undefined,
  amountCents: number | null | undefined,
): number | null {
  if (amountCents == null || amountCents <= 0) return null;
  return interval === 'year' ? Math.round(amountCents / 12) : amountCents;
}

/** cents -> decimal reais, e.g. 180001 -> 1800.01. Returns '' for null/undefined. */
export function centsToReais(cents: number | null | undefined): number | string {
  return cents == null ? '' : cents / 100;
}

/** ISO-8601 timestamp -> plain YYYY-MM-DD, for spreadsheet-sortable date columns. */
export function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}
