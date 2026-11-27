// Browser-side file reading + parser dispatch. Uploaded files NEVER leave the
// browser: only the normalized ImportBundle (and later the commit rows) travel
// to the edge function, which is what keeps a 20 MB Notion zip off the wire.
import {
  ImportParseError,
  parseClickupCsv,
  parseGenericCsv,
  parseNotionExport,
  parseTrelloJson,
  type ImportBundle,
  type ImportCollection,
  type SourceKind,
} from '@mesaas/import-parsers';
import { getIntlLocale, i18n } from '@mesaas/i18n';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 2000;

const tw = (key: string, opts?: Record<string, unknown>) => i18n.t(`importWizard:${key}`, opts);

/** Resolved at call time so it follows the UI language. */
export const unreadableMessage = () => tw('parse.unreadable');

/** Message is already user-facing (translated at throw time). `details` carries bullet-point context. */
export class ParseFilesError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
  }
}

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

type SniffedKind = 'zip' | 'json' | 'text';

function sniffKind(raw: string): SniffedKind {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (trimmed.startsWith('PK')) return 'zip';
  const first = trimmed.trimStart().charAt(0);
  if (first === '{' || first === '[') return 'json';
  return 'text';
}

function unreadableFile(name: string): string {
  return tw('parse.unreadableFile', { name });
}

function checkSourceMismatch(source: SourceKind, kind: SniffedKind, file: File): void {
  const name = file.name;
  const isXlsx = /\.xlsx$/i.test(name);

  if (source === 'trello') {
    if (kind === 'zip') {
      throw new ParseFilesError(tw('parse.zipNotTrello', { name }));
    }
    if (kind === 'text') {
      throw new ParseFilesError(tw('parse.csvNotTrello', { name }));
    }
  }

  if (source === 'clickup' || source === 'csv') {
    if (kind === 'zip' && isXlsx) {
      throw new ParseFilesError(tw('parse.xlsx', { name }));
    }
    if (kind === 'zip') {
      throw new ParseFilesError(tw('parse.zipNotCsv', { name }));
    }
    if (kind === 'json' && source === 'clickup') {
      throw new ParseFilesError(tw('parse.jsonNotCsv', { name }));
    }
  }

  if (source === 'notion' && kind === 'zip' && isXlsx) {
    throw new ParseFilesError(tw('parse.xlsx', { name }));
  }
}

function checkCsvSourceJsonContent(source: SourceKind, text: string, fileName: string): void {
  if (source !== 'csv') return;
  const kind = sniffKind(text);
  if (kind !== 'json') return;
  try {
    JSON.parse(text);
    throw new ParseFilesError(tw('parse.jsonNotCsv', { name: fileName }));
  } catch (err) {
    if (err instanceof ParseFilesError) throw err;
  }
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
  if (files.length === 0) throw new ParseFilesError(tw('parse.selectOne'));
  if (files.length > MAX_FILES) {
    throw new ParseFilesError(tw('parse.tooMany', { max: MAX_FILES }));
  }
  if (files.some((f) => f.size > MAX_FILE_BYTES)) {
    throw new ParseFilesError(tw('parse.tooBig'));
  }

  const collections: ImportCollection[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    try {
      if (source === 'notion') {
        const bytes = await readAsBytes(file);
        const text = new TextDecoder().decode(bytes.slice(0, 4));
        const kind = sniffKind(text);
        if (kind === 'zip' && /\.xlsx$/i.test(file.name)) {
          throw new ParseFilesError(tw('parse.xlsx', { name: file.name }));
        }
        const result = parseNotionExport(file.name, bytes);
        collections.push(...result.collections);
        warnings.push(...result.warnings);
      } else {
        const text = await readAsText(file);
        checkSourceMismatch(source, sniffKind(text), file);
        checkCsvSourceJsonContent(source, text, file.name);

        if (source === 'trello') {
          collections.push(parseTrelloJson(file.name, text));
        } else if (source === 'clickup') {
          collections.push(parseClickupCsv(file.name, text));
        } else {
          collections.push(parseGenericCsv(file.name, text));
        }
      }
    } catch (err) {
      if (err instanceof ParseFilesError) throw err;
      if (err instanceof ImportParseError && err.issue === 'trello-not-a-board') {
        throw new ParseFilesError(tw('parse.notABoard', { name: file.name }));
      }
      throw new ParseFilesError(unreadableFile(file.name));
    }
  }

  const bundle: ImportBundle = { source, collections: dedupeCollectionIds(collections), warnings };
  const rows = totalRows(bundle);
  if (rows === 0) {
    if (warnings.length > 0) {
      throw new ParseFilesError(tw('parse.noTables'), warnings);
    }
    throw new ParseFilesError(unreadableMessage());
  }
  if (rows > MAX_ROWS) {
    throw new ParseFilesError(
      tw('parse.tooManyRows', {
        rows: rows.toLocaleString(getIntlLocale()),
        max: MAX_ROWS.toLocaleString(getIntlLocale()),
      }),
    );
  }
  return bundle;
}
