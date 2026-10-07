/**
 * Shared CSV writer. Excel only reads a UTF-8 CSV as UTF-8 when it opens with
 * the byte order mark. Moved from pages/analytics-fluxos/csv.ts so the
 * automation contacts export (`;`-separated) and analytics (`,`) share one
 * formula guard.
 */
export const CSV_BOM = '\uFEFF';

export const CSV_EOL = '\r\n';

/**
 * A field a spreadsheet would evaluate: one of `= + - @` as the first character
 * that is not whitespace or a control character. Excel and Sheets trim the
 * leading run before parsing, so the guard must look past it.
 */
const FORMULA_LEAD = /^[\s\p{Cc}]*[=+\-@]/u;

/**
 * One CSV field: formula-neutralized first, then quoted. The apostrophe must go
 * in BEFORE the quotes, or it ends up outside them and the cell evaluates.
 *
 * Quoting: a field is quoted when it contains any of the common separators (`,`,
 * `;`, tab), a quote, or a line break. This guards against parser differential:
 * a file written with `;` but opened where the list separator is `,` (or vice
 * versa) would split cells, and we must quote to keep them whole.
 *
 * Formula guard: checked after splitting the field on `,`, `;`, or tab. If any
 * segment would evaluate as a formula in a spreadsheet (starts with `=`, `+`,
 * `-`, or `@` after whitespace/control chars), the whole field is prefixed with
 * apostrophe to neutralize it.
 */
export function csvField(value: string | number, _separator = ','): string {
  let out = String(value);

  // Check if any segment (when split by common separators) is a formula lead
  const segments = out.split(/[,;\t]/);
  if (segments.some((seg) => FORMULA_LEAD.test(seg))) {
    out = `'${out}`;
  }

  // Quote if contains any separator, quote, or line break
  if (/[,;\t"\n\r]/.test(out)) {
    out = `"${out.replace(/"/g, '""')}"`;
  }

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
