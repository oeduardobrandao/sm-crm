/**
 * One-off migration: converts every existing `hub_pages.content` row from the
 * legacy block shapes (`markdown` / `paragraph` / `heading` / `link` / `image`,
 * see `apps/hub/src/types.ts` `HubLegacyBlock`) to the single `richtext`
 * TipTap block introduced by this plan.
 *
 * Runs against PRODUCTION data (a few dozen rows across a couple dozen clients as of
 * writing this script; the editor stays live between now and whenever this actually
 * runs, so treat any row count you see quoted elsewhere as a moment-in-time snapshot,
 * not a target -- the dry run's own "Read N row(s) from hub_pages" line, printed
 * below in `main()`, is the authoritative count at run time), with the editor already
 * live, so it must not lose data and must not clobber a page someone else is editing
 * at the same moment. Safety properties:
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
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts [--apply] [--staging] [--confirm-production]
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --restore <backup-file> [--staging] [--confirm-production]
 *
 * Safety checks before any write (dry run included):
 *
 *   - The resolved SUPABASE_URL is always echoed first, so the operator can
 *     see which database is about to be touched before anything is read or
 *     written.
 *   - `--staging` refuses to run if that resolved URL is not actually the
 *     staging project. This matters because `process.env.SUPABASE_URL`
 *     always outranks the file value (see `connect()` below): a shell that
 *     still has production exported from an earlier `set -a; . ./.env.migration;
 *     set +a` would otherwise let `--staging --apply` run against production
 *     with a service-role key, completely silently -- the RLS-scoped
 *     fallback never engages, because the key really is service role.
 *   - `--apply` and `--restore` refuse to run against the known production
 *     project unless `--confirm-production` is also passed (this check is
 *     skipped once `--staging` has passed its own check above). This is the
 *     symmetric case: it catches forgetting `--staging` entirely, or a stale
 *     production URL left in the shell, from turning into an unintended
 *     production write. It costs one extra flag on the documented, expected
 *     production run below, in exchange for making a real production write
 *     a deliberate, separate step rather than whatever `process.env` happens
 *     to resolve to.
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
 * the same client and reports restored/failed per id (a row the UPDATE
 * matched zero times, e.g. because it was deleted after the backup was taken,
 * is reported as failed, never as restored):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts \
 *     --restore scripts/backups/hub-pages-backup-<timestamp>.json --confirm-production
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

// Known project refs (see CLAUDE.md "Supabase project refs (prod vs
// staging)"). Used only as a fallback when a ref can't be read directly out
// of an env file -- `connect()` prefers the actual file contents so this
// never has to be the single source of truth.
const STAGING_PROJECT_REF = 'wlyzhyfondykzpsiqsce';
const PRODUCTION_PROJECT_REF = 'skjzpekeqefvlojenfsw';

/**
 * Extracts the project ref (the subdomain) from a Supabase URL, e.g.
 * `https://wlyzhyfondykzpsiqsce.supabase.co` -> `wlyzhyfondykzpsiqsce`.
 * Returns null for anything that doesn't parse as a URL, or isn't a
 * `*.supabase.co` host (a local/self-hosted Supabase, for instance) --
 * callers treat that as "not a known project", never as an accidental match.
 */
function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const dot = host.indexOf('.');
    if (dot === -1) return null;
    return host.slice(dot + 1) === 'supabase.co' ? host.slice(0, dot) : null;
  } catch {
    return null;
  }
}

/**
 * Symmetric with the `--staging` guard inside `connect()`: refuses a write
 * (`--apply` or `--restore`) against the known production project unless
 * `--confirm-production` was also passed. `staging` is exempt because
 * `connect()` already proved the resolved URL is genuinely staging or threw.
 * This exists to catch the mirror-image mistake -- forgetting `--staging`
 * entirely, or a stale production URL left exported in the shell -- from
 * turning into a silent production write. See the header comment.
 */
function assertProductionWriteConfirmed(
  url: string,
  opts: { staging: boolean; confirmed: boolean },
): void {
  if (opts.staging) return;
  if (projectRef(url) !== PRODUCTION_PROJECT_REF) return;
  if (opts.confirmed) return;
  throw new Error(
    `Refusing to write: SUPABASE_URL (${url}) resolves to the known production project and ` +
      '--confirm-production was not passed. Passing --confirm-production is the documented, ' +
      'expected way to run the real migration or its rollback -- re-run with it if that is ' +
      'really the intent.',
  );
}

export async function connect(
  envFile: string,
  opts: { staging: boolean },
): Promise<{ client: SupabaseClient; scoped: boolean; url: string }> {
  const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};

  const url = process.env.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
  if (!url) {
    throw new Error(`No Supabase URL found. Set SUPABASE_URL, or VITE_SUPABASE_URL in ${envFile}.`);
  }

  // Echoed before anything is read or written, on every path -- dry run,
  // --apply and --restore alike -- so the operator can see which database is
  // about to be touched. This is the signal that was missing when a
  // `--staging` run silently connected to production: see the guard below.
  console.log(`Connecting to ${url}`);

  if (opts.staging) {
    // `envFile` is always `.env.staging` whenever `opts.staging` is true (see
    // `main()`), so `fileEnv` already holds that file's own URL -- the actual
    // staging project, independent of whatever `process.env.SUPABASE_URL`
    // says. If a shell still has production's URL exported (e.g. left over
    // from an earlier `set -a; . ./.env.migration; set +a`), that wins the
    // `||` above, and without this check `--staging` would silently run
    // against production with a service-role key -- the RLS-scoped fallback
    // never engages, because the key really is service role.
    const stagingUrl = fileEnv.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
    const stagingRef = projectRef(stagingUrl) ?? STAGING_PROJECT_REF;
    if (projectRef(url) !== stagingRef) {
      throw new Error(
        `--staging was passed but the resolved SUPABASE_URL (${url}) is not the staging project ` +
          `(expected ref ${stagingRef}). This is almost always process.env.SUPABASE_URL left over ` +
          'in the shell from a production .env.migration. Unset SUPABASE_URL and ' +
          'SUPABASE_SERVICE_ROLE_KEY, or open a fresh shell, before running with --staging.',
      );
    }
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
      url,
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
  return { client, scoped: true, url };
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

export interface RestoreReport {
  restored: string[];
  failed: { id: string; error: string }[];
}

/**
 * Replays a backup file written by `writeBackup()` back onto `hub_pages`,
 * unconditionally. This is the rollback path (see the header comment): it
 * OVERWRITES `content` for every id in the file, clobbering any legitimate
 * edit made to those pages after the migration ran. Only use it to revert the
 * whole migration, not to fix a single row by hand.
 *
 * The UPDATE carries `.select('id')` specifically so a zero-row match is
 * visible: without it, postgrest-js sends `Prefer: return=minimal` and a
 * request that matches nothing still comes back `{ data: null, error: null,
 * status: 204 }` -- indistinguishable from success. That happens whenever a
 * row named in the backup was deleted (or its id changed) after the backup
 * was taken, which is exactly the kind of thing that can happen between an
 * incident and its rollback. Such a row is reported in `failed`, never in
 * `restored`.
 */
export async function restoreBackup(
  client: SupabaseClient,
  backupFile: string,
): Promise<RestoreReport> {
  const raw = readFileSync(backupFile, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Backup file ${backupFile} is not a JSON array.`);
  }
  console.warn(
    `Restoring ${parsed.length} row(s) from ${backupFile}. This OVERWRITES the current content ` +
      'unconditionally -- any edits made to these pages after the migration ran will be lost.',
  );
  const report: RestoreReport = { restored: [], failed: [] };
  for (const row of parsed as BackupRow[]) {
    if (typeof row?.id !== 'string') {
      report.failed.push({
        id: '<missing id>',
        error: `Malformed backup entry, id is not a string: ${JSON.stringify(row)}`,
      });
      console.error(`Skipping malformed backup entry: ${JSON.stringify(row)}`);
      continue;
    }
    const { data, error } = await client
      .from('hub_pages')
      .update({ content: row.content })
      .eq('id', row.id)
      .select('id');
    if (error) {
      report.failed.push({ id: row.id, error: error.message });
      console.error(`Restore failed for id ${row.id}: ${error.message}`);
      continue;
    }
    if ((data ?? []).length === 0) {
      report.failed.push({
        id: row.id,
        error:
          'UPDATE matched zero rows -- the row may have been deleted (or its id changed) since ' +
          'the backup was taken. Not restored.',
      });
      console.error(`Restore failed for id ${row.id}: matched zero rows, nothing was restored.`);
      continue;
    }
    report.restored.push(row.id);
    console.log(`Restored ${row.id}`);
  }
  if (report.failed.length > 0) {
    console.error(
      `\n${report.failed.length} row(s) failed to restore. See errors above. Restored ` +
        `${report.restored.length}/${parsed.length}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${report.restored.length} row(s) restored successfully.`);
  }
  return report;
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
  const staging = args.includes('--staging');
  const confirmProduction = args.includes('--confirm-production');
  const envFile = staging ? '.env.staging' : '.env';

  const restoreIdx = args.indexOf('--restore');
  if (restoreIdx !== -1) {
    const backupFile = args[restoreIdx + 1];
    if (!backupFile) {
      throw new Error(
        '--restore requires a path to a backup file, e.g. ' +
          '--restore scripts/backups/hub-pages-backup-<timestamp>.json',
      );
    }
    const { client, scoped, url } = await connect(envFile, { staging });
    if (scoped) {
      throw new Error(
        '--restore requires SUPABASE_SERVICE_ROLE_KEY. RLS-scoped mode is read-only.',
      );
    }
    assertProductionWriteConfirmed(url, { staging, confirmed: confirmProduction });
    await restoreBackup(client, backupFile);
    return;
  }

  console.log(apply ? 'LIVE RUN. Rows will be written.' : 'DRY RUN. No writes will occur.');

  const { client, scoped, url } = await connect(envFile, { staging });
  if (apply && scoped) {
    throw new Error('--apply requires SUPABASE_SERVICE_ROLE_KEY. RLS-scoped mode is read-only.');
  }
  if (apply) {
    assertProductionWriteConfirmed(url, { staging, confirmed: confirmProduction });
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
