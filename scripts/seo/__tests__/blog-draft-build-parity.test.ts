/** Vitest half of the validator-vs-build drift test. The Deno half
 * (supabase/functions/__tests__/blog-draft-build-parity_test.ts) asserts that
 * validateBlogDraft (zod 3) accepts this same fixture; here the row that
 * approve-blog-post would leave in blog_posts must get through blog-sync's
 * dbPostSchema (zod 4). If the two validators drift, CI fails here instead of
 * every production deploy failing in blog:sync. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { syncBlogPosts } from '../blog-sync';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = resolve(ROOT, 'supabase/functions/__tests__/fixtures/blog-approved-draft.json');

describe('validated draft -> approved row -> build schema', () => {
  test('the shared fixture, as approve leaves it, syncs into the build', async () => {
    const draft = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    const row = {
      ...draft,
      id: '11111111-1111-4111-8111-111111111111',
      // What handleApproveBlogPost writes (approved_at/approved_by/publish_attempt_at are not
      // anon-readable, so blog-sync never sees them).
      status: 'publicando',
      date: '2026-10-23',
      // Column defaults in the blog_posts migration.
      author: 'equipe',
      revision: 1,
      updated: null,
    };
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify([row]), { status: 200 }),
    ) as unknown as typeof fetch;
    const outDir = mkdtempSync(join(tmpdir(), 'blogparity-'));
    const r = await syncBlogPosts({
      url: 'https://x.supabase.co',
      anonKey: 'k',
      env: { VERCEL_ENV: 'production' },
      fetchImpl,
      outDir,
      fileSlugs: [],
    });
    expect(r).toEqual({ written: 1, skipped: false });
    const meta = JSON.parse(readFileSync(join(outDir, `${draft.slug}.json`), 'utf8'));
    expect(meta.featureSlug).toBe(draft.feature_slug);
    expect(meta.cover).toEqual(draft.cover_image);
    expect(readFileSync(join(outDir, `${draft.slug}.body.md`), 'utf8')).toBe(draft.body_md);
  });
});
