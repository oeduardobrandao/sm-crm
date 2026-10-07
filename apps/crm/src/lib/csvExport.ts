/**
 * Shared CSV writer. Excel only reads a UTF-8 CSV as UTF-8 when it opens with
 * the byte order mark. Moved from pages/analytics-fluxos/csv.ts so the
 * automation contacts export (`;`-separated) and analytics (`,`) share one
 * formula guard.
 */
export const CSV_BOM = '﻿';

export const CSV_EOL = '\r\n';

/**
 * A field a spreadsheet would evaluate: one of `= + - @` as the first character
 * that is not whitespace or a control character. Excel and Sheets trim the
 * leading run before parsing, so the guard must look past it.
 */
const FORMULA_LEAD = /^[\s\p{Cc}]*[=+\-@]/u;

/**
 * One CSV field: formula-neutralized first, then quoted. The apostrophe must go
 * in BEFORE the quotes, or it ends up outside them and the cell evaluates. A
 * field is quoted when it contains the active separator, a quote or a line
 * break, so `;` output quotes semicolons and `,` output keeps its old shape.
 */
export function csvField(value: string | number, separator = ','): string {
  let out = String(value);
  if (FORMULA_LEAD.test(out)) out = `'${out}`;
  if (out.includes(separator) || /["\n\r]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export function csvRow(cells: (string | number)[], separator = ','): string {
  return cells.map((c) => csvField(c, separator)).join(separator);
}

/** Hands the built CSV to the browser as a download. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
