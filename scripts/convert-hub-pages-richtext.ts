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
 *     written under `scripts/backups/` before the first UPDATE is issued.
 *   - Every write is a conditional UPDATE (`WHERE id = $1 AND content = $2`).
 *     A row changed between our read and our write (someone opened, converted
 *     and saved it by hand) is never overwritten -- it lands in `raced`, not
 *     silently clobbered, and is left for a second pass.
 *   - A row that already holds a `richtext` block is skipped, not touched.
 *   - A row whose markdown fails to convert is a hard failure, never a silent
 *     write of the degraded one-paragraph fallback. `readPageDocResult()`
 *     from Task 8's `pageContent.ts` returns `converted: false` for exactly
 *     that case -- a structurally valid one-paragraph doc holding the raw
 *     text, indistinguishable from a real one-paragraph page unless you check
 *     the flag. This script checks it and refuses to write.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts [--apply] [--staging]
 *
 * Connection:
 *   Preferred, and the only mode that reaches every workspace: set
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment before
 *   running. Service role bypasses RLS, which this migration needs -- production
 *   has rows across 21+ clients, not one workspace.
 *
 *   Fallback, RLS-scoped to a single workspace -- useful for a local or
 *   staging dry run, never a substitute for the real migration: with no
 *   SUPABASE_SERVICE_ROLE_KEY set, the script reads VITE_SUPABASE_URL,
 *   VITE_SUPABASE_ANON_KEY, SEED_EMAIL and SEED_PASSWORD from `.env` (or
 *   `.env.staging` with `--staging`) and signs in as that user. RLS then
 *   limits `selectPages()` to that one workspace's hub_pages rows.
 *
 * Rollback: the backup file written under `scripts/backups/` is a JSON array
 * of `{ id, content }` exactly as read before the run. For any id that needs
 * reverting:
 *
 *   UPDATE hub_pages SET content = '<that row's content from the backup file>'::jsonb
 *   WHERE id = '<id>';
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
  /** UPDATE ... SET content = $3 WHERE id = $1 AND content = $2. Returns rows affected. */
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

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function createSupabaseDb(client: SupabaseClient): Db {
  return {
    async selectPages() {
      const { data, error } = await client.from('hub_pages').select('id, content');
      if (error) throw new Error(`selectPages failed: ${error.message}`);
      return (data ?? []) as PageRow[];
    },
    async updateIfUnchanged(id, expected, next) {
      const { data, error } = await client
        .from('hub_pages')
        .update({ content: next })
        .eq('id', id)
        .eq('content', expected as never)
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
  writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
  return file;
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

  console.log(apply ? 'LIVE RUN. Rows will be written.' : 'DRY RUN. No writes will occur.');

  const { client, scoped } = await connect(envFile);
  const db = createSupabaseDb(client);

  // selectPages() runs exactly once here. Its result is the snapshot that
  // both the backup and convert() use, so the backup can never disagree with
  // what the migration is about to act on.
  const rows = await db.selectPages();
  console.log(`Read ${rows.length} row(s) from hub_pages${scoped ? ' (RLS-scoped)' : ''}.`);

  if (apply) {
    const backupFile = writeBackup(rows);
    console.log(`Backup written to ${backupFile} before any write.`);
  }

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
