import { strFromU8, unzipSync } from 'fflate';
import { buildColumnNames } from './columns';
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

/**
 * Identity for a Notion database export file. Notion filenames carry a
 * 32-hex hash unique per database (`Calendário <hash>.csv` and its sibling
 * `Calendário <hash>_all.csv` share the hash — that's what lets the _all
 * preference below match the right sibling). Two unrelated databases with
 * the same human title (e.g. a "Tarefas" database repeated under every
 * client page) have DIFFERENT hashes and must never collide on this key.
 * A bare user-supplied CSV has no hash, so it falls back to its full path.
 */
function identityKey(path: string): string {
  const base = path.split('/').pop() ?? path;
  const match = base.match(NOTION_HASH);
  return match ? match[0].trim().toLowerCase() : path;
}

export function parseNotionExport(
  fileName: string,
  data: Uint8Array,
  maxBytes = DEFAULT_MAX_BYTES,
): { collections: ImportCollection[]; warnings: string[] } {
  const warnings: string[] = [];
  const csvs = new Map<string, { path: string; text: string; isAll: boolean; name: string }>();

  const addCsv = (path: string, bytes: Uint8Array) => {
    const key = identityKey(path);
    const isAll = /_all\.csv$/i.test(path);
    const existing = csvs.get(key);
    if (!existing || (isAll && !existing.isAll)) {
      csvs.set(key, { path, text: strFromU8(bytes), isAll, name: displayName(path) });
    }
  };

  if (/\.zip$/i.test(fileName)) {
    // `total` sums only the *declared* (zip-header) size of entries that will
    // actually be decompressed (.csv). This is advisory only: it lets us stop
    // feeding the decompressor once the declared budget is already spent, but
    // a corrupt or crafted zip can under-report `originalSize`, so this check
    // alone must never be trusted as the real bound.
    let total = 0;
    const csvNames: string[] = [];
    try {
      const entries = unzipSync(data, {
        filter: (f) => {
          const isCsv = /\.csv$/i.test(f.name);
          if (!isCsv) return false;
          total += f.originalSize ?? 0;
          csvNames.push(displayName(f.name));
          return total <= maxBytes;
        },
      });
      // Real bound: the actual decompressed byte length of what fflate
      // produced. Unlike `originalSize`, this figure cannot be spoofed, so
      // it is what actually decides whether the import is kept. If either
      // the declared or the real total is over budget, discard everything
      // pulled from this zip and warn — never a silent partial import.
      const actualBytes = Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0);
      if (total > maxBytes || actualBytes > maxBytes) {
        warnings.push(
          `Arquivo zip muito grande após descompactação — conteúdo ignorado: ${csvNames.join(', ')}.`,
        );
      } else {
        for (const [path, bytes] of Object.entries(entries)) addCsv(path, bytes);
      }
    } catch {
      warnings.push('Não foi possível ler o arquivo zip.');
    }
  } else {
    addCsv(fileName, data);
  }

  const parsed = [...csvs.values()];
  const names = buildColumnNames(
    parsed.map((p) => p.name),
    parsed.length,
  );
  const collections = parsed.map(({ path, text }, i) => ({
    ...parseGenericCsv(path, text),
    id: path,
    name: names[i],
    source: 'notion' as const,
  }));
  if (!collections.length && !warnings.length) {
    warnings.push('Nenhum arquivo CSV encontrado no export do Notion.');
  }
  return { collections, warnings };
}
