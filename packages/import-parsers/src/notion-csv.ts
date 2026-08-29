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
    // HONEST LIMITS OF THIS GUARD — read this before trusting either check below:
    //
    // `unzipSync` is SYNCHRONOUS: it fully materializes every entry the
    // `filter` callback accepts into memory before this function gets to look
    // at any real, decompressed bytes. Neither check below runs until that
    // has already happened.
    //
    //   - PRE-FILTER (`total`, inside the callback): advisory only. It sums
    //     the *declared* (zip-header) `originalSize` of accepted .csv entries
    //     so we can stop accepting further entries once the declared budget
    //     is spent — but the declared size is a field the archive itself
    //     controls. A corrupt or crafted zip can under-report it, and a
    //     legitimate high-ratio DEFLATE stream can honestly declare a small
    //     number and still inflate to something huge. Either way, this check
    //     bounds what fflate is TOLD to expect, not what it allocates.
    //   - PER-ENTRY REJECTION (the `originalSize > maxBytes` check just
    //     below): a narrow, cheap special case of the above — an entry whose
    //     OWN declared size already busts the cap, on its own, is skipped
    //     before fflate spends any work on it. This only catches the obvious
    //     case (an honest or over-declared size); it does nothing against an
    //     entry that UNDER-reports its size, which is the actual hole. It
    //     does not close that hole, only cheaply rejects the obvious case.
    //   - POST-CHECK (`actualBytes`, after `unzipSync` returns): bounds what
    //     is RETAINED, not what was allocated. By the time this runs, every
    //     accepted entry — including one that lied about being small — has
    //     already been fully inflated into the tab's heap. This only decides
    //     whether we keep pointing at that memory or drop it and warn.
    //
    // A real fix needs a streaming inflate with a hard abort mid-stream (so
    // decompression itself stops once real output crosses the cap), which is
    // deliberately out of scope here. Until then, the blast radius is the
    // importing user's own tab, on a file they chose to open — not a shared
    // server process or another user's data.
    let total = 0;
    const csvNames: string[] = [];
    let rejectedOversizedEntry = false;
    try {
      const entries = unzipSync(data, {
        filter: (f) => {
          const isCsv = /\.csv$/i.test(f.name);
          if (!isCsv) return false;
          if ((f.originalSize ?? 0) > maxBytes) {
            rejectedOversizedEntry = true;
            csvNames.push(displayName(f.name));
            return false;
          }
          total += f.originalSize ?? 0;
          csvNames.push(displayName(f.name));
          return total <= maxBytes;
        },
      });
      const actualBytes = Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0);
      if (total > maxBytes || actualBytes > maxBytes || rejectedOversizedEntry) {
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
    warnings.push(
      'Este export do Notion contém apenas páginas, sem nenhuma base de dados (CSV). Exporte de novo a partir da página que contém a lista de clientes, no formato "Markdown & CSV" e com "Incluir subpáginas" marcado.',
    );
  }
  return { collections, warnings };
}
