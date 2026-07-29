import { parseCsv } from './csv';
import { buildColumnNames } from './columns';
import type { ImportCollection } from './types';

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
