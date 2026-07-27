import { parseCsv } from './csv';
import type { ImportCollection } from './types';

/**
 * Builds the ordered, de-duplicated set of column names for a CSV grid.
 *
 * Every field index gets a name: header text when present, or a synthesized
 * `Coluna <n>` (1-based) when the header is missing that index entirely
 * (overflow data rows) or the header cell is blank (e.g. a trailing comma).
 * Any repeated name (including a synthesized one colliding with real header
 * text) is suffixed ` (2)`, ` (3)`, ... in order of appearance, so no two
 * columns share a name and no data is dropped.
 */
function buildColumnNames(header: string[], width: number): string[] {
  const raw: string[] = [];
  for (let j = 0; j < width; j++) {
    const h = header[j];
    raw.push(h ? h : `Coluna ${j + 1}`);
  }
  const seen = new Map<string, number>();
  return raw.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

export function parseGenericCsv(fileName: string, text: string): ImportCollection {
  const grid = parseCsv(text);
  const header = grid[0] ?? [];
  const dataRows = grid.slice(1);
  const width = Math.max(header.length, ...dataRows.map((r) => r.length), 0);
  const columns = buildColumnNames(header, width);
  const rows = dataRows.map((r, i) => ({
    key: `${fileName}:${i + 1}`,
    cells: Object.fromEntries(columns.map((c, j) => [c, r[j] ?? ''])),
  }));
  return {
    id: fileName,
    name: fileName.replace(/\.csv$/i, ''),
    source: 'csv',
    columns,
    listNames: [],
    rows,
  };
}
