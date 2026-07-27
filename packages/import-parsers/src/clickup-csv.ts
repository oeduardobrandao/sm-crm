import { parseCsv } from './csv';
import { buildColumnNames } from './columns';
import type { ImportCollection, ImportRow } from './types';

function toIso(v: string): string | null {
  if (!v.trim()) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && v.trim().length >= 12 ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseClickupCsv(fileName: string, text: string): ImportCollection {
  const grid = parseCsv(text);
  const headers = grid[0] ?? [];
  const dataRows = grid.slice(1);
  const idx = (h: string) => headers.findIndex((x) => x.toLowerCase() === h.toLowerCase());
  const iId = idx('Task ID');
  const iStatus = idx('Status');
  const iDue = idx('Due Date');
  const iContent = idx('Task Content');
  // Excluded by INDEX, not by name: a custom field can legitimately share a
  // name with one of the built-in columns (e.g. a "Status" custom field
  // alongside the kanban Status column) and must not be excluded too.
  const special = new Set([iId, iStatus, iDue, iContent].filter((i) => i >= 0));

  const width = Math.max(headers.length, ...dataRows.map((r) => r.length), 0);
  const allNames = buildColumnNames(headers, width);
  const cellIndices = allNames.map((_, i) => i).filter((i) => !special.has(i));
  const columns = cellIndices.map((i) => allNames[i]);

  const listNames: string[] = [];
  const rows: ImportRow[] = dataRows.map((r, n) => {
    const status = iStatus >= 0 ? (r[iStatus] ?? '') : '';
    if (status && !listNames.includes(status)) listNames.push(status);
    return {
      key: iId >= 0 && r[iId] ? r[iId] : `${fileName}:${n + 1}`,
      cells: Object.fromEntries(cellIndices.map((i) => [allNames[i], r[i] ?? ''])),
      listName: status || undefined,
      dueDate: iDue >= 0 ? toIso(r[iDue] ?? '') : null,
      description: iContent >= 0 ? (r[iContent] ?? '') : '',
    };
  });

  return {
    id: fileName,
    name: fileName.replace(/\.csv$/i, ''),
    source: 'clickup',
    columns,
    listNames,
    rows,
  };
}
