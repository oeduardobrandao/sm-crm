import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { syncBlogPosts } from '../blog-sync';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'id-1',
  slug: 'meu-post',
  status: 'publicado',
  category: 'guia',
  title: 'Como agendar posts no Instagram sem perder tempo hoje',
  h1: 'Como agendar posts no Instagram sem perder tempo na rotina',
  description:
    'Aprenda a agendar posts no Instagram com um fluxo simples, evitando retrabalho e mantendo a consistência da agência com os clientes.',
  lede: 'Um fluxo simples.',
  body_md: 'palavra '.repeat(450),
  cover_image: null,
  images: [],
  sources: [{ title: 'Doc', publisher: 'Meta', url: 'https://example.com/a' }],
  feature_slug: null,
  author: 'equipe',
  date: '2026-10-01',
  updated: null,
  revision: 1,
  ...over,
});

const ok = (rows: unknown[]) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
const tmp = () => mkdtempSync(join(tmpdir(), 'blogsync-'));
const base = { url: 'https://x.supabase.co', anonKey: 'k', fileSlugs: [] as string[] };
const prod = { VERCEL_ENV: 'production' };

describe('syncBlogPosts', () => {
  test('writes json + body for a valid row', async () => {
    const outDir = tmp();
    const r = await syncBlogPosts({ ...base, env: {}, fetchImpl: ok([row()]), outDir });
    expect(r).toEqual({ written: 1, skipped: false });
    const meta = JSON.parse(readFileSync(join(outDir, 'meu-post.json'), 'utf8'));
    expect(meta.readingMinutes).toBe(2);
    expect(meta.featureSlug).toBeNull();
    expect(readFileSync(join(outDir, 'meu-post.body.md'), 'utf8')).toContain('palavra');
  });

  test('production + fetch rejection throws; non-production skips', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(syncBlogPosts({ ...base, env: prod, fetchImpl, outDir: tmp() })).rejects.toThrow(
      /boom/,
    );
    await expect(syncBlogPosts({ ...base, env: {}, fetchImpl, outDir: tmp() })).resolves.toEqual({
      written: 0,
      skipped: true,
    });
  });

  test('production non-2xx throws', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('no', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(syncBlogPosts({ ...base, env: prod, fetchImpl, outDir: tmp() })).rejects.toThrow(
      /500/,
    );
  });

  test('production without URL throws', async () => {
    await expect(
      syncBlogPosts({ fileSlugs: [], env: prod, fetchImpl: ok([]), outDir: tmp() }),
    ).rejects.toThrow(/production/);
  });

  test('placeholder URL outside production skips without fetching', async () => {
    const fetchImpl = ok([]);
    const r = await syncBlogPosts({
      ...base,
      url: 'https://placeholder.supabase.co',
      env: {},
      fetchImpl,
      outDir: tmp(),
    });
    expect(r.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('slug colliding with a file post throws naming the slug', async () => {
    await expect(
      syncBlogPosts({
        ...base,
        env: prod,
        fetchImpl: ok([row()]),
        outDir: tmp(),
        fileSlugs: ['meu-post'],
      }),
    ).rejects.toThrow(/meu-post/);
  });

  test('row with empty sources throws mentioning sources', async () => {
    await expect(
      syncBlogPosts({ ...base, env: prod, fetchImpl: ok([row({ sources: [] })]), outDir: tmp() }),
    ).rejects.toThrow(/sources/);
  });

  test('null date: skipped outside production, throws in production', async () => {
    const outDir = tmp();
    const r = await syncBlogPosts({
      ...base,
      env: {},
      fetchImpl: ok([row({ date: null })]),
      outDir,
    });
    expect(r.written).toBe(0);
    await expect(
      syncBlogPosts({ ...base, env: prod, fetchImpl: ok([row({ date: null })]), outDir }),
    ).rejects.toThrow(/date/);
  });

  test('re-run with zero rows removes stale files', async () => {
    const outDir = tmp();
    await syncBlogPosts({ ...base, env: {}, fetchImpl: ok([row()]), outDir });
    writeFileSync(join(outDir, 'stale.json'), '{}');
    await syncBlogPosts({ ...base, env: {}, fetchImpl: ok([]), outDir });
    expect(readdirSync(outDir)).toEqual([]);
    expect(existsSync(join(outDir, 'meu-post.json'))).toBe(false);
  });
});
