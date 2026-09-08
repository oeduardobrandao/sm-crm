import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { convert, createSupabaseDb, type PageRow, type Db } from '../convert-hub-pages-richtext';

/**
 * Exercises `convert()`'s JS-side re-read guard (`Db.readContent()`) against the real
 * `createSupabaseDb()` implementation with a stubbed `fetch`, the same way
 * `convert-hub-pages-richtext.db.test.ts` drives `updateIfUnchanged()` against the
 * actual request postgrest-js builds rather than a mock of the `Db` interface -- a
 * fake `Db` in the test itself would never exercise the real re-read request shape or
 * the real `jsonDeepEqual()` comparison.
 *
 * `selectPages()` is a fixed in-memory snapshot in all three tests below, exactly like
 * `main()`'s `snapshotDb` wrapper -- only `readContent()` (a GET) and
 * `updateIfUnchanged()` (a PATCH) hit the stubbed network.
 */

function stubClient(fetchImpl: typeof fetch) {
  return createClient('https://example.supabase.co', 'anon-key', {
    auth: { persistSession: false },
    global: { fetch: fetchImpl },
  });
}

function snapshotDb(rows: PageRow[], realDb: Db): Db {
  return {
    selectPages: async () => rows,
    readContent: (id) => realDb.readContent(id),
    updateIfUnchanged: (id, expected, next) => realDb.updateIfUnchanged(id, expected, next),
  };
}

describe('convert() -- re-read guard against a legacy writer (real createSupabaseDb, stubbed fetch)', () => {
  it('lands in raced and never writes when a LEGACY writer changed the row between read and write', async () => {
    const original: PageRow = { id: 'p1', content: [{ type: 'markdown', content: '# A' }] };
    let patchCalled = false;

    const stubFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        patchCalled = true;
        throw new Error(
          'updateIfUnchanged must not be called once the re-read detects a content change',
        );
      }
      // The re-read: someone's pre-deploy browser saved different markdown in the
      // window between selectPages() and this call. Still no richtext block anywhere,
      // so the server-side not.cs guard alone would never have caught this.
      return new Response(
        JSON.stringify({ content: [{ type: 'markdown', content: '# CHANGED BY LEGACY EDITOR' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const realDb = createSupabaseDb(stubClient(stubFetch));
    const report = await convert(snapshotDb([original], realDb), { dryRun: false });

    expect(report.raced).toEqual(['p1']);
    expect(report.converted).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(patchCalled).toBe(false);
  });

  it('still converts an unchanged row even when the re-read serializes object keys in a different order', async () => {
    const original: PageRow = { id: 'p1', content: [{ type: 'markdown', content: '# A' }] };

    const stubFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        return new Response(JSON.stringify([{ id: 'p1' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Same content, deliberately re-serialized with the block's keys in a different
      // order -- this is exactly the case jsonDeepEqual() exists for. A naive
      // `JSON.stringify(a) === JSON.stringify(b)` would misreport this as "changed"
      // and skip a perfectly convertible row.
      return new Response(JSON.stringify({ content: [{ content: '# A', type: 'markdown' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const realDb = createSupabaseDb(stubClient(stubFetch));
    const report = await convert(snapshotDb([original], realDb), { dryRun: false });

    expect(report.converted).toEqual(['p1']);
    expect(report.raced).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('still lands in raced via the server-side not.cs condition when the row becomes richtext right after the re-read', async () => {
    const original: PageRow = { id: 'p1', content: [{ type: 'markdown', content: '# A' }] };

    const stubFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        // The residual window this fix does not close: the row picked up a richtext
        // block after our re-read passed but before this UPDATE's WHERE clause was
        // evaluated. The JS-side compare above could not have seen this -- it already
        // ran and matched. The server-side `not.cs` condition is what catches it here,
        // reporting a zero-row match instead of silently overwriting the new save.
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // The re-read still sees the same legacy content the snapshot has -- the
      // JS-side compare passes, so convert() proceeds to the write above.
      return new Response(JSON.stringify({ content: original.content }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const realDb = createSupabaseDb(stubClient(stubFetch));
    const report = await convert(snapshotDb([original], realDb), { dryRun: false });

    expect(report.raced).toEqual(['p1']);
    expect(report.converted).toEqual([]);
    expect(report.failed).toEqual([]);
  });
});
