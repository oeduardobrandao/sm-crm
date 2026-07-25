import { describe, expect, test } from 'vitest';
import { buildSitemapXml } from '../sitemap';
import { PUBLIC_ROUTES } from '../site-meta';

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
