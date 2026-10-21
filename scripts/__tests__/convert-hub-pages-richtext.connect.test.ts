import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { connect } from '../convert-hub-pages-richtext';

/**
 * Covers Finding 1 from the round-2 operational-safety review: `connect()`
 * resolves `process.env.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL`, and
 * `process.env` always wins. The credential rule tells the operator to
 * `set -a; . ./.env.migration; set +a` (production URL + service-role key)
 * into their shell. A subsequent `--staging --apply` in that same shell used
 * to read `.env.staging` for the file value, but `process.env` still won, so
 * it silently connected to production with a service-role key -- the
 * RLS-scoped guard never fires because the key really is service role.
 *
 * These tests never call `.select()`/`.update()`/`signInWithPassword()` --
 * the refusal (or the service-role early return) happens before any network
 * request, so no stubbed fetch is needed here.
 */
describe('connect() -- --staging must refuse a resolved production URL', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tmpFiles: string[] = [];

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    for (const f of tmpFiles.splice(0)) {
      try {
        unlinkSync(f);
      } catch {
        // already removed
      }
    }
  });

  function stagingEnvFile(contents: string): string {
    const file = path.join(
      os.tmpdir(),
      `convert-hub-pages-staging-${Date.now()}-${Math.random()}.env`,
    );
    writeFileSync(file, contents, 'utf8');
    tmpFiles.push(file);
    return file;
  }

  it('throws instead of connecting when a production SUPABASE_URL is exported in process.env', async () => {
    const envFile = stagingEnvFile('VITE_SUPABASE_URL=https://wlyzhyfondykzpsiqsce.supabase.co\n');

    // Simulates a shell that sourced .env.migration (production) earlier and
    // is now re-run with --staging in the same shell -- the exact scenario
    // that used to connect to production silently.
    process.env.SUPABASE_URL = 'https://skjzpekeqefvlojenfsw.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-prod-service-role-key';

    await expect(connect(envFile, { staging: true })).rejects.toThrow(/staging/i);
    await expect(connect(envFile, { staging: true })).rejects.toThrow(/skjzpekeqefvlojenfsw/);
  });

  it('also refuses when .env.staging itself has no URL to compare against (falls back to the known ref)', async () => {
    const envFile = stagingEnvFile('SEED_EMAIL=someone@example.com\n');
    process.env.SUPABASE_URL = 'https://skjzpekeqefvlojenfsw.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-prod-service-role-key';

    await expect(connect(envFile, { staging: true })).rejects.toThrow(/staging/i);
  });

  it('does not throw when the resolved URL genuinely is the staging project', async () => {
    // Service-role branch, so this never reaches signInWithPassword() /
    // network -- createClient() alone makes no request.
    const envFile = stagingEnvFile(
      'VITE_SUPABASE_URL=https://wlyzhyfondykzpsiqsce.supabase.co\n' +
        'SUPABASE_SERVICE_ROLE_KEY=fake-staging-service-role-key\n',
    );
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { scoped, url } = await connect(envFile, { staging: true });
    expect(scoped).toBe(false);
    expect(url).toBe('https://wlyzhyfondykzpsiqsce.supabase.co');
  });

  it('non-staging runs are unaffected by the guard (no --staging, no comparison)', async () => {
    const envFile = stagingEnvFile(
      'VITE_SUPABASE_URL=https://skjzpekeqefvlojenfsw.supabase.co\n' +
        'SUPABASE_SERVICE_ROLE_KEY=fake-prod-service-role-key\n',
    );
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { scoped, url } = await connect(envFile, { staging: false });
    expect(scoped).toBe(false);
    expect(url).toBe('https://skjzpekeqefvlojenfsw.supabase.co');
  });
});
