import { strFromU8, unzipSync } from 'fflate';
import { parseGenericCsv } from './generic-csv';
import type { ImportCollection } from './types';

const NOTION_HASH = / [0-9a-f]{32}(?=(_all)?\.\w+$|$)/i;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function displayName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base
    .replace(/(_all)?\.csv$/i, '')
    .replace(NOTION_HASH, '')
    .trim();
}

export function parseNotionExport(
  fileName: string,
  data: Uint8Array,
  maxBytes = DEFAULT_MAX_BYTES,
): { collections: ImportCollection[]; warnings: string[] } {
  const warnings: string[] = [];
  const csvs = new Map<string, { path: string; text: string; isAll: boolean }>();

  const addCsv = (path: string, bytes: Uint8Array) => {
    const name = displayName(path);
    const isAll = /_all\.csv$/i.test(path);
    const existing = csvs.get(name);
    if (!existing || (isAll && !existing.isAll)) {
      csvs.set(name, { path, text: strFromU8(bytes), isAll });
    }
  };

  if (/\.zip$/i.test(fileName)) {
    let total = 0;
    try {
      const entries = unzipSync(data, {
        filter: (f) => {
          total += f.originalSize ?? 0;
          return /\.csv$/i.test(f.name) && total <= maxBytes;
        },
      });
      if (total > maxBytes) {
        warnings.push(
          'Arquivo zip muito grande após descompactação — parte do conteúdo foi ignorada.',
        );
      }
      for (const [path, bytes] of Object.entries(entries)) addCsv(path, bytes);
    } catch {
      warnings.push('Não foi possível ler o arquivo zip.');
    }
  } else {
    addCsv(fileName, data);
  }

  const collections = [...csvs.entries()].map(([name, { path, text }]) => ({
    ...parseGenericCsv(path, text),
    id: path,
    name,
    source: 'notion' as const,
  }));
  if (!collections.length && !warnings.length) {
    warnings.push('Nenhum arquivo CSV encontrado no export do Notion.');
  }
  return { collections, warnings };
}
