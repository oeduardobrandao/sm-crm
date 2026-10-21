import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseDb } from '../convert-hub-pages-richtext';

/**
 * Drives `createSupabaseDb()` against a real `SupabaseClient` with a stubbed
 * `fetch`, so the assertion is against the actual URL postgrest-js builds --
 * not against a mock of `updateIfUnchanged` itself. This is what would have
 * caught the original bug: `.eq('content', expected as never)` compiled fine
 * and passed every test that mocked the `Db` interface, because none of them
 * ever looked at the request postgrest-js actually sends. `expected` was a JS
 * array, `.eq()` serializes its value with a template literal, and the array
 * stringified to the literal text `[object Object]` -- a value Postgres
 * rejects against a jsonb column on every single row.
 */
describe('createSupabaseDb().updateIfUnchanged -- real request shape', () => {
  it('builds a short URL keyed on "no richtext block yet", never on full content equality', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    const stubFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedMethod = init?.method ?? '';
      return new Response(JSON.stringify([{ id: 'p1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false },
      global: { fetch: stubFetch as unknown as typeof fetch },
    });

    const db = createSupabaseDb(client);

    // `expected` below is exactly the shape that broke `.eq()`: a JS array of
    // objects. If the fix regressed back to `.eq('content', expected)`, this
    // would show up in the URL as `content=eq.%5Bobject+Object%5D`.
    const expected = [{ type: 'markdown', content: '# A' }];
    const next = [{ type: 'richtext', doc: { type: 'doc', content: [] } }];
    const result = await db.updateIfUnchanged('p1', expected, next);

    expect(result.rowsAffected).toBe(1);
    expect(capturedMethod).toBe('PATCH');

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/rest/v1/hub_pages');
    expect(url.searchParams.get('id')).toBe('eq.p1');
    // The real fix: a short "not already richtext" filter, not a full-content
    // equality check.
    expect(url.searchParams.get('content')).toBe('not.cs.[{"type":"richtext"}]');

    // The bug this guards against: `[object Object]` must never appear,
    // decoded or encoded, anywhere in the request URL.
    expect(capturedUrl).not.toContain('object+Object');
    expect(capturedUrl).not.toContain('object%20Object');
    expect(decodeURIComponent(capturedUrl)).not.toContain('[object Object]');

    // And the URL must stay well under any sane length limit -- unlike a
    // JSON.stringify(expected) equality filter, which for some production
    // rows would run past 16 KB once percent-encoded.
    expect(capturedUrl.length).toBeLessThan(500);
  });
});
