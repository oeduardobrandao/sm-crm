import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { restoreBackup } from '../convert-hub-pages-richtext';

/**
 * Covers Finding 2 from the round-2 operational-safety review:
 * `restoreBackup()`'s `.update({ content }).eq('id', row.id)` had no
 * `.select()`. Verified against a stubbed fetch, a zero-row match returns
 * `{ data: null, error: null, status: 204 }` -- postgrest-js's
 * `Prefer: return=minimal` default -- and the old code logged `Restored
 * <id>` and counted no failure for it. A backup replayed after some rows
 * were deleted would report a fully successful rollback while having
 * restored fewer rows than it claimed, during an incident, which is the
 * worst time to be lied to.
 *
 * Drives `restoreBackup()` against a real `SupabaseClient` with a stubbed
 * `fetch`, so the assertion is against the request postgrest-js actually
 * builds (mirrors convert-hub-pages-richtext.db.test.ts for the same
 * reason: a mock of the `Db`/client interface would never have caught
 * either bug).
 */
describe('restoreBackup() -- a zero-row update must be reported as failed, not restored', () => {
  const originalExitCode = process.exitCode;
  const tmpFiles: string[] = [];

  afterEach(() => {
    process.exitCode = originalExitCode;
    for (const f of tmpFiles.splice(0)) {
      try {
        unlinkSync(f);
      } catch {
        // already removed
      }
    }
  });

  function backupFile(rows: { id: string; content: unknown }[]): string {
    const file = path.join(
      os.tmpdir(),
      `convert-hub-pages-restore-${Date.now()}-${Math.random()}.json`,
    );
    writeFileSync(file, JSON.stringify(rows), 'utf8');
    tmpFiles.push(file);
    return file;
  }

  it('requests select=id, and reports a zero-row match as failed', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedPrefer = '';

    const stubFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedMethod = init?.method ?? '';
      const headers = new Headers(init?.headers);
      capturedPrefer = headers.get('prefer') ?? '';
      // No rows matched -- e.g. the row was deleted after the backup was
      // taken. With `.select('id')` postgrest-js asks for
      // `Prefer: return=representation`, so a zero-row match comes back 200
      // with an empty array, not the 204/null the old unconditional update
      // would have returned.
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false },
      global: { fetch: stubFetch as unknown as typeof fetch },
    });

    const file = backupFile([{ id: 'deleted-row', content: [{ type: 'richtext', doc: {} }] }]);
    const report = await restoreBackup(client, file);

    expect(capturedMethod).toBe('PATCH');
    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/rest/v1/hub_pages');
    expect(url.searchParams.get('id')).toBe('eq.deleted-row');
    expect(url.searchParams.get('select')).toBe('id');
    expect(capturedPrefer).toContain('return=representation');

    // The bug this guards against: a zero-row match must never be reported
    // as restored.
    expect(report.restored).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe('deleted-row');
    expect(report.failed[0].error).toMatch(/zero rows/i);
    expect(process.exitCode).toBe(1);
  });

  it('reports a genuinely matched row as restored, not failed', async () => {
    const stubFetch = async () =>
      new Response(JSON.stringify([{ id: 'p1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false },
      global: { fetch: stubFetch as unknown as typeof fetch },
    });

    const file = backupFile([{ id: 'p1', content: [{ type: 'richtext', doc: {} }] }]);
    const report = await restoreBackup(client, file);

    expect(report.restored).toEqual(['p1']);
    expect(report.failed).toEqual([]);
    expect(process.exitCode).not.toBe(1);
  });

  it('reports a mix of matched and zero-row rows with separate restored/failed counts and ids', async () => {
    const stubFetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const matched = url.includes('eq.ok-row');
      return new Response(JSON.stringify(matched ? [{ id: 'ok-row' }] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false },
      global: { fetch: stubFetch as unknown as typeof fetch },
    });

    const file = backupFile([
      { id: 'ok-row', content: [{ type: 'richtext', doc: {} }] },
      { id: 'gone-row', content: [{ type: 'richtext', doc: {} }] },
    ]);
    const report = await restoreBackup(client, file);

    expect(report.restored).toEqual(['ok-row']);
    expect(report.failed.map((f) => f.id)).toEqual(['gone-row']);
    expect(process.exitCode).toBe(1);
  });
});
