/**
 * One-off migration: converts every existing `hub_pages.content` row from the
 * legacy block shapes (`markdown` / `paragraph` / `heading` / `link` / `image`,
 * see `apps/hub/src/types.ts` `HubLegacyBlock`) to the single `richtext`
 * TipTap block introduced by this plan.
 *
 * Runs against PRODUCTION data (29 rows across 21 clients as of 2026-09-07),
 * with the editor already live, so it must not lose data and must not clobber
 * a page someone else is editing at the same moment. Safety properties:
 *
 *   - Dry run by default. Nothing is written unless you pass `--apply`.
 *   - A JSON backup of every row's `id` + `content`, exactly as read, is
 *     written under `scripts/backups/` on every run (dry run included), before
 *     the first UPDATE is issued when `--apply` is passed.
 *   - Every write is a conditional UPDATE (`WHERE id = $1 AND NOT content @> '[{"type":"richtext"}]'`).
 *     This is a deliberate deviation from a literal `content = $2` equality check. postgrest-js
 *     serializes an `.eq()` filter value with a template literal, so a JS array/object argument
 *     stringifies to the literal text `[object Object]`, not JSON -- Postgres then rejects it
 *     against a jsonb column (22P02) and EVERY row fails, turning the whole migration into a silent
 *     no-op. `JSON.stringify()`-ing the full content is not a fix either: some rows serialize past
 *     16 KB of URL once percent-encoded, which Cloudflare rejects with a 414 before the request
 *     reaches Postgres. Instead of full-content equality, this encodes the actual threat model --
 *     the only write the live editor can make to a page is `[{type: "richtext", doc}]` (see
 *     `writePageContent` below) -- so "has this row changed since I read it" reduces to "does it
 *     now contain a richtext block". A row changed between our read and our write (someone opened,
 *     converted and saved it by hand) is never overwritten -- it lands in `raced`, not silently
 *     clobbered, and is left for a second pass. Do not restore the `content = $2` form; it reads as
 *     more literal but never matches a single row.
 *   - A row that already holds a `richtext` block is skipped, not touched. A row that holds a
 *     `richtext` block MIXED with legacy block(s) is a hard failure, not a silent partial
 *     conversion (see the guard in `convert()` below).
 *   - A row whose markdown fails to convert is a hard failure, never a silent
 *     write of the degraded one-paragraph fallback. `readPageDocResult()`
 *     from Task 8's `pageContent.ts` returns `converted: false` for exactly
 *     that case -- a structurally valid one-paragraph doc holding the raw
 *     text, indistinguishable from a real one-paragraph page unless you check
 *     the flag. This script checks it and refuses to write.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts [--apply] [--staging]
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --restore <backup-file> [--staging]
 *
 * Connection:
 *   Preferred, and the only mode that reaches every workspace: set
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running. Service role
 *   bypasses RLS, which this migration needs -- production has rows across
 *   21+ clients, not one workspace. `--apply` and `--restore` both refuse to
 *   run against the RLS-scoped fallback below; they require service role.
 *
 *   NEVER pass the service role key as a literal `KEY=value npx tsx ...` CLI
 *   argument -- it lands in shell history and in `ps` output for as long as
 *   the process runs. Instead put it in a gitignored `.env.migration` file at
 *   the repo root:
 *
 *     SUPABASE_URL=<prod-url>
 *     SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
 *
 *   and source it into the shell before running, with nothing secret on the
 *   command line:
 *
 *     set -a; . ./.env.migration; set +a
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --apply
 *
 *   `connect()` also reads SUPABASE_SERVICE_ROLE_KEY out of the `.env` /
 *   `.env.staging` file it already parses for the RLS-scoped fallback below,
 *   so the same two lines dropped into `.env` work too if you would rather
 *   not source a separate file.
 *
 *   Fallback, RLS-scoped to a single workspace -- useful for a local or
 *   staging dry run, never a substitute for the real migration: with no
 *   SUPABASE_SERVICE_ROLE_KEY set, the script reads VITE_SUPABASE_URL,
 *   VITE_SUPABASE_ANON_KEY, SEED_EMAIL and SEED_PASSWORD from `.env` (or
 *   `.env.staging` with `--staging`) and signs in as that user. RLS then
 *   limits `selectPages()` to that one workspace's hub_pages rows.
 *
 * Rollback: prefer replaying the backup through this same script -- it reuses
 * the same client and reports success/failure per id:
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts \
 *     --restore scripts/backups/hub-pages-backup-<timestamp>.json
 *
 *   This OVERWRITES `content` unconditionally for every id in the backup file --
 *   it clobbers any legitimate edit made to those pages after the migration ran.
 *   Only run it to revert the whole migration, not to fix one row by hand.
 *
 *   Manual SQL fallback, only if the script itself is unavailable. Use dollar
 *   quoting, never a single-quoted string literal: the backed-up `content` is
 *   Portuguese client copy and WILL contain ASCII apostrophes, which break or
 *   silently truncate a hand-pasted `'...'` literal.
 *
 *     UPDATE hub_pages SET content = $bkp$<that row's content from the backup file>$bkp$::jsonb
 *     WHERE id = '<id>';
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  isLegacyContent,
  readPageDocResult,
  writePageContent,
} from '../apps/crm/src/pages/cliente-detalhe/hub/pageContent';

export interface PageRow {
  id: string;
  content: unknown;
}

export interface Db {
  selectPages(): Promise<PageRow[]>;
  /**
   * Conceptually `UPDATE ... SET content = $3 WHERE id = $1 AND content = $2`, i.e.
   * "only write if the row still holds the exact content we read." `expected` carries
   * that intent for callers and for the fake `Db` used in tests. The real
   * (`createSupabaseDb`) implementation cannot do a literal `content = $2` equality
   * check -- see its comment -- and instead checks "the row does not yet contain a
   * richtext block", which is equivalent given the only write the live editor can
   * make. Returns rows affected.
   */
  updateIfUnchanged(
    id: string,
    expected: unknown,
    next: unknown,
  ): Promise<{ rowsAffected: number }>;
}

export interface Report {
  converted: string[];
  skipped: string[];
  raced: string[];
  failed: { id: string; error: string }[];
}

/**
 * True when `content` is an array with at least one `richtext` block. Combined
 * with `isLegacyContent()` (true when ANY block is non-`richtext`), this
 * detects a mixed row like `[{richtext}, {markdown}]`: `isLegacyContent()`
 * alone would let it through into `readPageDocResult()`, which returns just
 * the first richtext block's doc with `converted: true`, silently dropping
 * the markdown block instead of converting it.
 */
function hasRichtextBlock(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (b) => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'richtext',
    )
  );
}

/**
 * Runs with the editor already live, so someone can open, convert and save a
 * page in the window between our read and our write. The UPDATE is
 * conditioned on the exact `content` read for that row: a row that changed in
 * the meantime is never written, it is recorded in `raced` and left for a
 * second pass.
 *
 * A row that fails to convert (`readPageDocResult().converted === false`) is
 * a hard failure, not a silent write of the raw-text fallback.
 */
export async function convert(db: Db, opts: { dryRun: boolean }): Promise<Report> {
  const rows = await db.selectPages();
  const report: Report = { converted: [], skipped: [], raced: [], failed: [] };

  for (const row of rows) {
    if (!isLegacyContent(row.content)) {
      report.skipped.push(row.id);
      continue;
    }
    if (hasRichtextBlock(row.content)) {
      // Production has no such rows today, and the live editor cannot produce
      // one -- `writePageContent()` always returns a single-element array --
      // but refuse to guess rather than risk silently dropping the legacy
      // block(s) if that ever changes.
      report.failed.push({
        id: row.id,
        error:
          'Row mixes a richtext block with legacy block(s). readPageDocResult() would return ' +
          'only the richtext doc, silently dropping the legacy block(s). Not written -- needs a ' +
          'manual look.',
      });
      continue;
    }
    try {
      const { doc, converted } = readPageDocResult(row.content);
      if (!converted) {
        report.failed.push({
          id: row.id,
          error:
            'readPageDocResult returned converted:false -- the legacy markdown failed to ' +
            'convert and the result is the raw-text paragraph fallback, not a real conversion. ' +
            'Not written; needs a manual look.',
        });
        continue;
      }
      const next = writePageContent(doc);
      if (opts.dryRun) {
        report.converted.push(row.id);
        continue;
      }
      const { rowsAffected } = await db.updateIfUnchanged(row.id, row.content, next);
      (rowsAffected === 1 ? report.converted : report.raced).push(row.id);
    } catch (e) {
      report.failed.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI wiring below. The unit tests exercise `convert()` directly against a
// fake `Db` double and never reach any of this.
// ---------------------------------------------------------------------------

function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

async function connect(envFile: string): Promise<{ client: SupabaseClient; scoped: boolean }> {
  const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};

  const url = process.env.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
  if (!url) {
    throw new Error(`No Supabase URL found. Set SUPABASE_URL, or VITE_SUPABASE_URL in ${envFile}.`);
  }

  // Also falls back to fileEnv, like url/anon/email/password below, so an
  // operator can put the service key in a gitignored env file instead of a
  // literal `KEY=value` CLI argument (shell history, `ps` output). See the
  // header comment for the recommended `.env.migration` + `set -a` invocation.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    return {
      client: createClient(url, serviceKey, { auth: { persistSession: false } }),
      scoped: false,
    };
  }

  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY;
  const email = process.env.SEED_EMAIL || fileEnv.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD || fileEnv.SEED_PASSWORD;
  if (!anonKey || !email || !password) {
    throw new Error(
      'No SUPABASE_SERVICE_ROLE_KEY set, and the RLS-scoped fallback needs ' +
        `VITE_SUPABASE_ANON_KEY, SEED_EMAIL and SEED_PASSWORD (environment or ${envFile}).`,
    );
  }
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  console.warn(
    'WARNING: no SUPABASE_SERVICE_ROLE_KEY set. Running RLS-scoped as a single workspace user, ' +
      'which sees only that workspace, not the full hub_pages table. Use this only for a ' +
      'local or staging check, never as the real migration.',
  );
  return { client, scoped: true };
}

export function createSupabaseDb(client: SupabaseClient): Db {
  return {
    async selectPages() {
      const { data, error } = await client.from('hub_pages').select('id, content');
      if (error) throw new Error(`selectPages failed: ${error.message}`);
      return (data ?? []) as PageRow[];
    },
    // `expected` (the Db interface's optimistic-concurrency argument) is
    // intentionally unused here -- see the header comment. A literal
    // `.eq('content', expected)` cannot work: postgrest-js serializes an eq
    // filter value with a template literal, so a JS array/object argument
    // stringifies to `[object Object]`, not JSON, and every row fails against
    // the jsonb column. `JSON.stringify()`-ing it is not a fix either -- some
    // rows exceed the 16 KB URL length Cloudflare allows. Instead this checks
    // the one write the live editor can make (`[{type:"richtext", doc}]`, see
    // `writePageContent`): the row is updated only if it does NOT already
    // contain a richtext block, i.e. nobody converted it since we read it.
    async updateIfUnchanged(id, _expected, next) {
      const { data, error } = await client
        .from('hub_pages')
        .update({ content: next })
        .eq('id', id)
        .not('content', 'cs', '[{"type":"richtext"}]')
        .select('id');
      if (error) throw new Error(`updateIfUnchanged failed for id ${id}: ${error.message}`);
      return { rowsAffected: (data ?? []).length };
    },
  };
}

function writeBackup(rows: PageRow[]): string {
  const dir = path.join(process.cwd(), 'scripts', 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `hub-pages-backup-${stamp}.json`);
  // mode 0o600: this file holds production client content, readable only by
  // the operator running the migration.
  writeFileSync(file, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

interface BackupRow {
  id: string;
  content: unknown;
}

/**
 * Replays a backup file written by `writeBackup()` back onto `hub_pages`,
 * unconditionally. This is the rollback path (see the header comment): it
 * OVERWRITES `content` for every id in the file, clobbering any legitimate
 * edit made to those pages after the migration ran. Only use it to revert the
 * whole migration, not to fix a single row by hand.
 */
async function restoreBackup(client: SupabaseClient, backupFile: string): Promise<void> {
  const raw = readFileSync(backupFile, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Backup file ${backupFile} is not a JSON array.`);
  }
  console.warn(
    `Restoring ${parsed.length} row(s) from ${backupFile}. This OVERWRITES the current content ` +
      'unconditionally -- any edits made to these pages after the migration ran will be lost.',
  );
  let failures = 0;
  for (const row of parsed as BackupRow[]) {
    if (typeof row?.id !== 'string') {
      console.error(`Skipping malformed backup entry: ${JSON.stringify(row)}`);
      failures++;
      continue;
    }
    const { error } = await client
      .from('hub_pages')
      .update({ content: row.content })
      .eq('id', row.id);
    if (error) {
      console.error(`Restore failed for id ${row.id}: ${error.message}`);
      failures++;
      continue;
    }
    console.log(`Restored ${row.id}`);
  }
  if (failures > 0) {
    console.error(`\n${failures} row(s) failed to restore. See errors above.`);
    process.exitCode = 1;
  }
}

function printReport(report: Report): void {
  console.log('\n=== Report ===');
  console.log(`converted (${report.converted.length}): ${JSON.stringify(report.converted)}`);
  console.log(`skipped (${report.skipped.length}): ${JSON.stringify(report.skipped)}`);
  console.log(`raced (${report.raced.length}): ${JSON.stringify(report.raced)}`);
  console.log(`failed (${report.failed.length}):`);
  for (const f of report.failed) console.log(`  - ${f.id}: ${f.error}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const envFile = args.includes('--staging') ? '.env.staging' : '.env';

  const restoreIdx = args.indexOf('--restore');
  if (restoreIdx !== -1) {
    const backupFile = args[restoreIdx + 1];
    if (!backupFile) {
      throw new Error(
        '--restore requires a path to a backup file, e.g. ' +
          '--restore scripts/backups/hub-pages-backup-<timestamp>.json',
      );
    }
    const { client, scoped } = await connect(envFile);
    if (scoped) {
      throw new Error(
        '--restore requires SUPABASE_SERVICE_ROLE_KEY. RLS-scoped mode is read-only.',
      );
    }
    await restoreBackup(client, backupFile);
    return;
  }

  console.log(apply ? 'LIVE RUN. Rows will be written.' : 'DRY RUN. No writes will occur.');

  const { client, scoped } = await connect(envFile);
  if (apply && scoped) {
    throw new Error('--apply requires SUPABASE_SERVICE_ROLE_KEY. RLS-scoped mode is read-only.');
  }
  const db = createSupabaseDb(client);

  // selectPages() runs exactly once here. Its result is the snapshot that
  // both the backup and convert() use, so the backup can never disagree with
  // what the migration is about to act on.
  const rows = await db.selectPages();
  console.log(`Read ${rows.length} row(s) from hub_pages${scoped ? ' (RLS-scoped)' : ''}.`);

  // Written on both dry run and --apply: it costs one line, lets the operator
  // inspect the pre-flight snapshot while still deciding whether to --apply,
  // and keeps the backup off the safety-critical (apply-only) branch.
  const backupFile = writeBackup(rows);
  console.log(`Backup written to ${backupFile}${apply ? ' before any write.' : ' (dry run).'}`);

  const snapshotDb: Db = {
    selectPages: async () => rows,
    updateIfUnchanged: (id, expected, next) => db.updateIfUnchanged(id, expected, next),
  };

  const report = await convert(snapshotDb, { dryRun: !apply });
  printReport(report);

  if (report.failed.length > 0) {
    console.error(
      `\n${report.failed.length} row(s) failed conversion. Not written. See list above.`,
    );
    process.exitCode = 1;
  }
  if (report.raced.length > 0) {
    console.warn(
      `\n${report.raced.length} row(s) raced with a concurrent write. Re-run to retry them.`,
    );
  }
}

const isDirectRun =
  process.argv[1] != null &&
  (process.argv[1].endsWith('convert-hub-pages-richtext.ts') ||
    process.argv[1].endsWith('convert-hub-pages-richtext.js'));

if (isDirectRun) {
  main().catch((e) => {
    console.error('Fatal error:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
