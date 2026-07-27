import { parseCsv } from './csv';
import type { ImportCollection } from './types';

export function parseGenericCsv(fileName: string, text: string): ImportCollection {
  const grid = parseCsv(text);
  const columns = grid[0] ?? [];
  const rows = grid.slice(1).map((r, i) => ({
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
