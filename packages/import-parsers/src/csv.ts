/**
 * Delimiter candidates, in the order ties are broken. Comma is first and wins
 * every tie, so a comma file can never be re-read as something else.
 *
 * `;` is the one that actually matters: Excel writes CSV using the OS list
 * separator, which on a pt-BR (or any European-locale) machine is a semicolon —
 * and the wizard's own upload guide tells users that export is supported. Tab
 * is included because "Save as CSV" from some tools produces TSV in a .csv
 * wrapper; it is harmless here since it can only win by appearing MORE often
 * than commas in the header.
 */
const DELIMITERS = [',', ';', '\t'] as const;

/**
 * Sniffs the field delimiter from the header line.
 *
 * WHY THE HEADER LINE ONLY: it is the one line whose shape is guaranteed to be
 * one cell per column with no free text, so counting separators there cannot be
 * skewed by a caption that happens to contain semicolons.
 *
 * WHY IT IS QUOTE-AWARE: a candidate character inside a quoted field is part of
 * the DATA, not a separator. `"Silva, Ana";"Rua A, 10"` is two SEMICOLON-
 * separated fields, but a naive count sees two commas against one semicolon and
 * picks comma — shredding both fields. So this walks the text with the same
 * quote state machine `parseCsv` uses and only counts characters appearing
 * outside quotes. It stops at the first UNQUOTED line break, so a quoted field
 * containing a newline does not drag the next record into the sample.
 *
 * WHY COMMA IS THE DEFAULT: only a STRICTLY higher count displaces it. A file
 * with no delimiter at all (single column), or one where commas merely tie,
 * parses exactly as it did before this function existed — which is what keeps
 * the existing comma contract intact.
 */
function detectDelimiter(src: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === '\n' || c === '\r') break;
    const seen = counts.get(c);
    if (seen !== undefined) counts.set(c, seen + 1);
  }
  let best: string = DELIMITERS[0];
  for (const d of DELIMITERS) {
    if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  }
  return best;
}

/**
 * Minimal RFC4180 parser (quoted fields, escaped quotes, CRLF); no deps.
 *
 * The delimiter is sniffed from the header line (see `detectDelimiter`) rather
 * than hard-coded, so a semicolon-separated export from a pt-BR Excel parses
 * into real columns instead of one giant column per line.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
