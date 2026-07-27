import { describe, expect, test } from 'vitest';
import { buildSitemapXml, routesWithDerivedDates, sitemapRoutes } from '../sitemap';
import { PUBLIC_ROUTES, type RouteMeta } from '../site-meta';
import type { BlogPost } from '../blog.schema';
import { blogPostRouteMeta } from '../blog';

describe('buildSitemapXml', () => {
  const xml = buildSitemapXml(PUBLIC_ROUTES);
  test('declares every public route with lastmod', () => {
    for (const r of PUBLIC_ROUTES) {
      const loc =
        r.path === '/' ? 'https://www.mesaas.com.br/' : `https://www.mesaas.com.br${r.path}`;
      expect(xml).toContain(`<loc>${loc}</loc>`);
      expect(xml).toContain(`<lastmod>${r.lastmod}</lastmod>`);
    }
  });
  test('is well-formed enough for Google', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<url>/g)?.length).toBe(PUBLIC_ROUTES.length);
  });
});

function post(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    slug: 'artigo',
    title: 'Título de teste com o tamanho certinho para passar no schema real',
    h1: 'H1 de teste do artigo',
    description:
      'Descrição de teste longa o bastante para simular o texto real de um artigo do blog usado nos testes de sitemap.',
    date: '2026-07-20',
    updated: '2026-07-20',
    category: 'guia',
    body: '',
    readingMinutes: 1,
    ...overrides,
  };
}

// Manifest fixture standing in for PUBLIC_ROUTES: same shape, none of the
// real content, so assertions below aren't coupled to the live manifest.
const manifestRoutes: RouteMeta[] = [
  { path: '/', file: 'index.html', title: 'T', description: 'D', lastmod: '2026-01-01' },
  { path: '/blog', file: 'blog.html', title: 'T', description: 'D', lastmod: '2026-01-01' },
  {
    path: '/novidades',
    file: 'novidades.html',
    title: 'T',
    description: 'D',
    lastmod: '2026-01-01',
  },
];

describe('routesWithDerivedDates', () => {
  test('/novidades takes the release date when one is provided', () => {
    const result = routesWithDerivedDates(manifestRoutes, [], '2026-07-19');
    expect(result.find((r) => r.path === '/novidades')?.lastmod).toBe('2026-07-19');
  });

  test('/blog takes the newest post updated date', () => {
    const posts = [
      post({ slug: 'old', updated: '2026-06-01' }),
      post({ slug: 'new', updated: '2026-07-23' }),
    ];
    const result = routesWithDerivedDates(manifestRoutes, posts, undefined);
    expect(result.find((r) => r.path === '/blog')?.lastmod).toBe('2026-07-23');
  });

  test('with zero posts, /blog keeps its manifest lastmod', () => {
    const result = routesWithDerivedDates(manifestRoutes, [], undefined);
    expect(result.find((r) => r.path === '/blog')?.lastmod).toBe('2026-01-01');
    expect(result.find((r) => r.path === '/novidades')?.lastmod).toBe('2026-01-01');
  });

  test('leaves routes other than /novidades and /blog untouched', () => {
    const result = routesWithDerivedDates(
      manifestRoutes,
      [post({ updated: '2026-07-23' })],
      '2026-07-19',
    );
    expect(result.find((r) => r.path === '/')?.lastmod).toBe('2026-01-01');
  });
});

describe('sitemapRoutes', () => {
  test('posts appear in the output, one route per post', () => {
    const posts = [post({ slug: 'a' }), post({ slug: 'b', updated: '2026-07-22' })];
    const result = sitemapRoutes(manifestRoutes, posts, undefined);
    expect(result).toContainEqual(blogPostRouteMeta(posts[0]));
    expect(result).toContainEqual(blogPostRouteMeta(posts[1]));
    expect(result).toHaveLength(manifestRoutes.length + posts.length);
  });

  test('with zero posts, no post entries are appended', () => {
    const result = sitemapRoutes(manifestRoutes, [], undefined);
    expect(result).toHaveLength(manifestRoutes.length);
    expect(result.some((r) => r.path.startsWith('/blog/'))).toBe(false);
  });

  test('feeds buildSitemapXml a real post route end to end', () => {
    const p = post({ slug: 'artigo-real', updated: '2026-07-26' });
    const xml = buildSitemapXml(sitemapRoutes(manifestRoutes, [p], undefined));
    expect(xml).toContain('<loc>https://www.mesaas.com.br/blog/artigo-real</loc>');
    expect(xml).toContain('<lastmod>2026-07-26</lastmod>');
  });
});
