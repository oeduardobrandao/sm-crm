// Browser-side file reading + parser dispatch. Uploaded files NEVER leave the
// browser: only the normalized ImportBundle (and later the commit rows) travel
// to the edge function, which is what keeps a 20 MB Notion zip off the wire.
import {
  parseClickupCsv,
  parseGenericCsv,
  parseNotionExport,
  parseTrelloJson,
  type ImportBundle,
  type ImportCollection,
  type SourceKind,
} from '@mesaas/import-parsers';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 2000;

export const UNREADABLE_MESSAGE =
  'Não conseguimos ler este arquivo — confira o passo a passo de exportação acima.';

/** Message is already user-facing pt-BR. */
export class ParseFilesError extends Error {}

function readAsText(file: File): Promise<string> {
  // FileReader rather than File.text(): the same code path works in every
  // browser we support and under jsdom, where Blob.text() is absent.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

function readAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

export function totalRows(bundle: ImportBundle): number {
  return bundle.collections.reduce((n, c) => n + c.rows.length, 0);
}

/**
 * Individual parsers only ever see their own file, so `generic-csv.ts` and
 * `clickup-csv.ts` both mint `ImportCollection.id = fileName` with no way to
 * know a sibling file shares that name (e.g. two uploads both called
 * `dados.csv`). Every downstream consumer — `proposeMapping`, the
 * `StepMapeamento` card lookup, and `buildCommitRows`'s `Map` keyed by
 * `collectionId` — treats `id` as a genuine unique key, so a collision here
 * silently desyncs which mapping the user reviewed from which mapping
 * actually gets committed. This is the one place that sees every file in the
 * upload, so it's the only place that CAN de-duplicate.
 *
 * `name` (shown to the user) is left untouched; only `id` gets a
 * `" (n)"` suffix, mirroring `buildColumnNames`'s de-dup convention. Row keys
 * that were derived from the same fileName (the `${fileName}:${n}` shape
 * generic-csv/clickup-csv fall back to) are rewritten in lockstep so two
 * same-named files never produce identical `provenance.sourceKey`s either —
 * otherwise the commit RPC's `(job_id, source_row_key, table_name)`
 * idempotency check would silently treat the second file's row as an
 * already-imported duplicate of the first's.
 */
function dedupeCollectionIds(collections: ImportCollection[]): ImportCollection[] {
  // Track the ids actually ALLOCATED, not a count per original id. Counting is
  // the classic dedup bug: with `dados.csv`, `dados.csv (2)` and a second
  // `dados.csv`, the third is renamed to `dados.csv (2)` and collides with the
  // real file of that name — taking its row keys with it, which is what the
  // note above warns is silently destructive.
  const taken = new Set<string>();
  return collections.map((collection) => {
    const oldId = collection.id;
    if (!taken.has(oldId)) {
      taken.add(oldId);
      return collection;
    }
    let n = 2;
    while (taken.has(`${oldId} (${n})`)) n += 1;
    const newId = `${oldId} (${n})`;
    taken.add(newId);
    const prefix = `${oldId}:`;
    return {
      ...collection,
      id: newId,
      rows: collection.rows.map((row) =>
        row.key.startsWith(prefix)
          ? { ...row, key: `${newId}:${row.key.slice(prefix.length)}` }
          : row,
      ),
    };
  });
}

/**
 * Reads and parses the chosen files into one bundle, enforcing the browser-side
 * caps. Throws ParseFilesError with a message meant to be shown as-is.
 */
export async function parseFiles(source: SourceKind, files: File[]): Promise<ImportBundle> {
  if (files.length === 0) throw new ParseFilesError('Selecione pelo menos um arquivo.');
  if (files.length > MAX_FILES) {
    throw new ParseFilesError(`Envie no máximo ${MAX_FILES} arquivos por importação.`);
  }
  if (files.some((f) => f.size > MAX_FILE_BYTES)) {
    throw new ParseFilesError('Cada arquivo pode ter no máximo 20 MB.');
  }

  const collections: ImportCollection[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    try {
      if (source === 'notion') {
        const result = parseNotionExport(file.name, await readAsBytes(file));
        collections.push(...result.collections);
        warnings.push(...result.warnings);
      } else if (source === 'trello') {
        collections.push(parseTrelloJson(file.name, await readAsText(file)));
      } else if (source === 'clickup') {
        collections.push(parseClickupCsv(file.name, await readAsText(file)));
      } else {
        collections.push(parseGenericCsv(file.name, await readAsText(file)));
      }
    } catch {
      // Never surface the parser's own error text: it is developer-facing and
      // the user's next move is always the export guide above.
      throw new ParseFilesError(UNREADABLE_MESSAGE);
    }
  }

  const bundle: ImportBundle = { source, collections: dedupeCollectionIds(collections), warnings };
  const rows = totalRows(bundle);
  if (rows === 0) throw new ParseFilesError(UNREADABLE_MESSAGE);
  if (rows > MAX_ROWS) {
    throw new ParseFilesError(
      `Este envio tem ${rows.toLocaleString('pt-BR')} linhas e o limite por importação é ${MAX_ROWS.toLocaleString('pt-BR')}. Divida o arquivo e importe em partes.`,
    );
  }
  return bundle;
}
